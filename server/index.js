/**
 * index.js — OKSBDC Chatbot API Server
 *
 * This file is the thin entry point that wires together Express middleware,
 * static file serving, and the route modules. All business logic lives in:
 *
 *   lib/
 *     state.js       — Shared mutable state (systemPrompt) and path constants.
 *     ban.js         — Temporary ban store and violation-rate tracking.
 *
 *   util/
 *     logger.js      — JSONL audit-log helpers.
 *     helpers.js     — Shared pure-utility functions.
 *
 *   routes/
 *     auth.js        — POST /chatbot/api/auth/login
 *     chat.js        — POST /chatbot/api/chat
 *     dashboard.js   — GET/PUT /chatbot/api/system-prompt, /chatbot/api/dashboard/*
 *     feedback.js    — POST /chatbot/api/feedback
 *
 * Required environment variables (configure in .env):
 *   GEMINI_API_KEY     — Google Gemini API key.
 *   JWT_SECRET         — Secret used to sign and verify dashboard session tokens.
 *
 * Dashboard accounts are stored in server/data/dashboard-accounts.json by default.
 * Use `npm run dashboard:create-user -- --username <name>` from server/ to create one.
 *
 * Optional environment variables:
 *   GEMINI_MODEL           — Primary Gemini model name (default: gemini-3.5-flash-lite).
 *   GEMINI_SECONDARY_MODEL — Fallback model used for recoverable generation failures.
 *   PORT                   — Port to listen on (default: 3001).
 *   SYSTEM_PROMPT          — Overrides the system prompt from the environment.
 *   AI_RESPONSE_LOG_PATH   — Overrides the base path used for daily JSONL log files.
 */

const express = require('express');
const cors    = require('cors');
const dotenv  = require('dotenv');
const path    = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const {
  createCorsOriginCallback,
  createLivenessPayload,
  isTruthyValue,
  mountStaticSpa,
  parseDelimitedList,
  setNoStoreHeaders,
} = require('server-kit');

dotenv.config();

// ─── Route modules ────────────────────────────────────────────────────────────

const authRouter        = require('./routes/auth');
const chatRouter        = require('./routes/chat');
const dashboardRouter   = require('./routes/dashboard');
const feedbackRouter    = require('./routes/feedback');
const { createDocsRouter } = require('./routes/docs');
const rag               = require('./rag');
const { appendAiResponseLog } = require('./util/logger');
const { getOperationalDataPaths } = require('./lib/operational-data-cleanup');
const { startLogRetention } = require('./lib/log-retention');
const { workTracker } = require('./lib/work-tracker');
const { createShutdownHandler } = require('./lib/graceful-shutdown');
const { closeRedisClient, disconnectRedisClient } = require('./lib/redis-client');
const {
  BAN_ENFORCEMENT_ENABLED,
  BAN_THRESHOLD,
  applyTempBan,
  getBanEnforcementDecision,
  getActiveBanForRequest,
  getRequestBanIdentity,
  isBanExempt,
  recordViolation,
} = require('./lib/ban');

// ─── App setup ────────────────────────────────────────────────────────────────

let shuttingDown = false;

const app = express();
const serverRouter = express.Router();
const { createChatErrorAlertMiddleware } = require('./lib/chat-error-alert');
serverRouter.use((req, res, next) => {
  if (!shuttingDown || req.path === '/api/health/live') {
    return next();
  }

  res.setHeader('Connection', 'close');
  res.setHeader('Retry-After', '5');
  res.setHeader('Cache-Control', 'no-store');

  return res.status(503).json({
    error: 'Server is restarting. Please try again shortly.',
    retryable: true,
  });
});
serverRouter.use(workTracker.requestMiddleware);
serverRouter.use('/api/chat', createChatErrorAlertMiddleware());
const SERVER_ROUTE_PREFIX = '/chatbot';
const port = process.env.PORT || 3001;
serverRouter.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://fontawesome.com/'],
      styleSrc: ["'self'", 'https://fontawesome.com/', 'https://fonts.googleapis.com/'],
      fontSrc: ["'self'", 'https://fontawesome.com/', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'https://fontawesome.com/'],
    },
  },
}));

// Bind to all interfaces so the server is reachable inside Docker / behind a
// reverse proxy. Do not expose port 3001 directly to the public internet.
const ip = '0.0.0.0';

const { version } = require('../release.json');
console.log(`Starting OKSBDC Chatbot API Server (version: ${version})`);
if (!BAN_ENFORCEMENT_ENABLED) {
  console.warn('RELEASE BLOCKER: temporary ban enforcement is disabled; violations are still counted and logged.');
}

// Check critical environment variables at startup and exit with an error if they are not set.

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.error('JWT_SECRET is not set or is too short. Please set a secret with at least 16 characters.');
  process.exit(1);
}

// Trust only the single reverse-proxy hop directly in front of the server.
// Express will ignore any additional client-supplied X-Forwarded-For entries.
app.set('trust proxy', 1);

// ─── CORS setup ───────────────────────────────────────────────────────────────

// For simplicity, this server uses a single system prompt for all conversations.
// lib/state.js loads the persisted prompt from disk. SYSTEM_PROMPT can still
// override it for deployments that need environment-driven configuration.
const { state } = require('./lib/state');
if (process.env.SYSTEM_PROMPT) {
  state.systemPrompt = process.env.SYSTEM_PROMPT;
}

// Build an explicit allowlist from CORS_ALLOWED_ORIGINS (comma-separated).
// In local/internal testing, allow common localhost/private-network origins to
// avoid "Failed to fetch" errors from browser CORS blocks. When EMBEDDED=true,
// also allow origins listed in EMBED_ALLOWED_ORIGINS and EMBED_CLIENT_URL so a
// hosted widget can call this API from another website.
const defaultCorsAllowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3001',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3001',
];
const configuredCorsOrigins = parseDelimitedList(process.env.CORS_ALLOWED_ORIGINS);
const embeddedModeEnabled = isTruthyValue(process.env.EMBEDDED);
const embeddedAllowedOrigins = embeddedModeEnabled
  ? [
      ...parseDelimitedList(process.env.EMBED_ALLOWED_ORIGINS),
      ...parseDelimitedList(process.env.EMBED_CLIENT_URL),
    ]
  : [];
const allowAnyEmbeddedOrigin = embeddedAllowedOrigins.includes('*');
const corsAllowedOrigins = [
  ...(configuredCorsOrigins.length ? configuredCorsOrigins : defaultCorsAllowedOrigins),
  ...embeddedAllowedOrigins.filter((origin) => origin !== '*'),
];

serverRouter.use(cors({
  origin: createCorsOriginCallback({
    allowedOrigins: corsAllowedOrigins,
    allowAnyOrigin: embeddedModeEnabled && allowAnyEmbeddedOrigin,
    onBlocked: (origin) => console.warn(`Blocked CORS origin: ${origin}`),
  }),
  credentials: true,
}));

// Bypass the ngrok browser-warning interstitial page so the widget loads
// correctly inside an iframe. The header tells ngrok to skip its own
// warning and serve the content directly.
serverRouter.use((_req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

serverRouter.use(express.json({ limit: '1mb' }));

// Explicitly answer CORS preflight requests for chat so OPTIONS
// /chatbot/api/chat does not fall through to authenticated dashboard routes.
serverRouter.options('/api/chat', (_req, res) => {
  res.sendStatus(204);
});

const chatRateLimitDisabled = isTruthyValue(process.env.CHAT_RATE_LIMIT_DISABLED);

// Use express-rate-limit's validated req.ip default for every HTTP limiter.
// The separate ban identity includes User-Agent and must not key these counters.
const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait a minute before trying again.' },
});

const dashboardRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many dashboard requests. Please wait a minute before trying again.' },
});

const chatRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages. Please wait a minute before trying again.' },
  handler: workTracker.trackHandler(async (req, res, _next, options) => {
    try {
      const activeBan = BAN_ENFORCEMENT_ENABLED
        ? await getActiveBanForRequest(req)
        : null;

      if (activeBan) {
        return res.status(403).json({
          error: `Access is temporarily blocked for 24 hours due to prior policy violations. You can try again after ${new Date(activeBan.expiresAt).toLocaleString()}.`,
          bannedUntil: new Date(activeBan.expiresAt).toISOString(),
        });
      }

      const { banKey, sourceIp } = getRequestBanIdentity(req);
      const violationCount = await recordViolation(banKey);
      const banDecision = getBanEnforcementDecision(
        violationCount,
        await isBanExempt(banKey),
      );
      const rateLimitedMessage = typeof req.body?.message === 'string'
        ? req.body.message
        : 'rate limit exceeded';

      let bannedUntil = null;
      if (banDecision.shouldApplyBan) {
        const banEntry = await applyTempBan(req, {
          conversationId: 'rate-limit',
          turn: 0,
          blockedByRule: 'rate_limit',
          message: rateLimitedMessage,
        });
        bannedUntil = new Date(banEntry.expiresAt).toISOString();
      }

      appendAiResponseLog({
        timestamp: new Date().toISOString(),
        event: 'rate_limit_violation',
        message: rateLimitedMessage,
        source_ip: sourceIp,
        ban_key: banKey,
        violation_count: violationCount,
        ban_threshold: BAN_THRESHOLD,
        ban_threshold_incremented: true,
        ban_threshold_reached: banDecision.thresholdReached,
        ban_enforcement_enabled: banDecision.enforcementEnabled,
        temp_ban_would_apply: banDecision.wouldApplyBan,
        temp_ban_applied: banDecision.shouldApplyBan,
        ...(banDecision.shouldApplyBan ? { temp_ban_expires_at: bannedUntil } : {}),
      });

      if (banDecision.shouldApplyBan) {
        return res.status(403).json({
          error: `Access is temporarily blocked for 24 hours due to repeated rate-limit violations. You can try again after ${new Date(bannedUntil).toLocaleString()}.`,
          bannedUntil,
        });
      }

      return res.status(options.statusCode).json(options.message);
    } catch (error) {
      console.error('Rate-limit handler failed:', error);
      return res.status(options.statusCode).json(options.message);
    }
  }),
});

const feedbackRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many feedback submissions. Please wait a minute before trying again.' },
});

// Serve the generated documentation publicly under the same chatbot prefix.
// express.static redirects /docs to /docs/ so relative page and asset URLs work.
serverRouter.use('/docs', createDocsRouter());

// If the frontend has been built, serve it from the shared server router so
// /chatbot and /chatbot/dashboard work on the backend host.
const clientDistPath  = path.join(__dirname, '..', 'client', 'dist');
const clientIndexPath = path.join(clientDistPath, 'index.html');
mountStaticSpa({
  app: serverRouter,
  staticMiddleware: express.static,
  distPath: clientDistPath,
  indexPath: clientIndexPath,
  routes: ['/', '/dashboard', '/dashboard/'],
});

// ─── API routes ───────────────────────────────────────────────────────────────

function getReadinessStatus() {
  const ragStatus = rag.getStatus();
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
  const ragReady = (
    ragStatus.ready === true &&
    ragStatus.hasEmbeddingModel === true &&
    Number(ragStatus.chunkCount) > 0
  );

  return {
    ready: geminiConfigured && ragReady,
    checks: {
      gemini: {
        configured: geminiConfigured,
      },
      rag: {
        ready: ragReady,
        chunkCount: Number(ragStatus.chunkCount) || 0,
        hasEmbeddingModel: ragStatus.hasEmbeddingModel === true,
        lastInitError: ragStatus.lastInitError || null,
      },
    },
  };
}

// Liveness is intentionally dependency-free. If this handler responds, the
// Node process and Express event loop are alive.
serverRouter.get('/api/health/live', (_req, res) => {
  setNoStoreHeaders(res);
  return res.status(200).json(createLivenessPayload({ version: state.releaseVersion || version }));
});

// Readiness verifies the local configuration and initialized RAG resources
// needed for normal AI-backed chat traffic. It does not make a paid/networked
// Gemini probe on every request.
serverRouter.get('/api/health/ready', (_req, res) => {
  setNoStoreHeaders(res);
  const readiness = getReadinessStatus();
  return res.status(readiness.ready ? 200 : 503).json({
    ok: readiness.ready,
    status: readiness.ready ? 'ready' : 'not_ready',
    checks: readiness.checks,
    timestamp: new Date().toISOString(),
  });
});

serverRouter.use('/api/auth', loginRateLimiter, authRouter);
serverRouter.use(['/api/chat', '/api/feedback'], require('./lib/live-chat-test').liveChatTestMiddleware);
serverRouter.use('/api/chat', require('./lib/chat-traffic-guard').chatTrafficGuard.middleware);
// Mode checks must remain available when the per-IP message limit is reached.
serverRouter.get('/api/chat/mode', workTracker.trackHandler(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await require('./lib/chat-traffic-guard').chatTrafficGuard.getStatus());
}));
if (chatRateLimitDisabled) {
  console.warn('CHAT_RATE_LIMIT_DISABLED is enabled; /chatbot/api/chat rate limiting is bypassed. Use this only for controlled load tests.');
  serverRouter.use('/api/chat', chatRouter);
} else {
  serverRouter.use('/api/chat', chatRateLimiter, chatRouter);
}
serverRouter.use('/api/feedback', feedbackRateLimiter, feedbackRouter);
serverRouter.use('/api', dashboardRateLimiter, dashboardRouter);

// Every server-owned route is exposed through this single prefix.
app.use(SERVER_ROUTE_PREFIX, serverRouter);

// ─── Start ────────────────────────────────────────────────────────────────────

function initializeRagAtStartup() {
  const ragStartupStatus = rag.init(process.env.GEMINI_API_KEY);
  if (ragStartupStatus.ready) {
    console.log(`RAG: initialization verified at startup with ${ragStartupStatus.chunkCount} chunks.`);
  } else {
    console.warn(`RAG: startup verification did not find a ready vector store (${ragStartupStatus.lastInitError || 'not_ready'}).`);
  }
}

const server = app.listen(port, ip, () => {
  const address = server.address();
  const actualPort = address && typeof address === 'object' ? address.port : port;
  console.log(`Server listening on http://${ip}:${actualPort}`);

  // Resolve relative overrides exactly as the runtime log writers do.
  const logEnv = { ...process.env };
  for (const key of ['AI_RESPONSE_LOG_PATH', 'HUMAN_READABLE_LOG_PATH', 'CONVERSATION_STATUS_LOG_PATH', 'DASHBOARD_AUDIT_LOG_PATH']) {
    if (logEnv[key]) logEnv[key] = path.resolve(logEnv[key]);
  }
  const retentionTimer = startLogRetention(getOperationalDataPaths(logEnv));
  server.once('close', () => clearInterval(retentionTimer));

  // Bind the port before the synchronous vector-store load so Vite/dev clients
  // do not see ECONNREFUSED while RAG warms up during startup or nodemon restarts.
  initializeRagAtStartup();
});

// One deadline covers HTTP draining, post-response work, and Redis cleanup.
const configuredShutdownTimeout = Number(process.env.SHUTDOWN_TIMEOUT_MS);
const shutdown = createShutdownHandler({
  server,
  tracker: workTracker,
  timeoutMs: Number.isSafeInteger(configuredShutdownTimeout) && configuredShutdownTimeout > 0 && configuredShutdownTimeout <= 2147483647
    ? configuredShutdownTimeout : 90000,
  beginShutdown: () => { shuttingDown = true; },
  cleanup: closeRedisClient,
  forceCleanup: disconnectRedisClient,
});
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
