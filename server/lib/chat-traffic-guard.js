'use strict';

const path = require('node:path');
const { getRedisClient } = require('./redis-client');
const { createUsageLimitNotifier } = require('./gemini-usage-alert');
const { listDashboardAccounts } = require('./dashboard-accounts');
const { workTracker } = require('./work-tracker');

const positiveInteger = (value, fallback) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

function createTrafficAlertNotifier({ env = process.env, accounts = listDashboardAccounts, ...options } = {}) {
  return createUsageLimitNotifier({
    ...options,
    env: { ...env,
      GEMINI_ALERT_REDIS_KEY: env.CHAT_TRAFFIC_ALERT_REDIS_KEY || 'oksbdc:chat-traffic:alert',
      GEMINI_ALERT_STATE_PATH: env.CHAT_TRAFFIC_ALERT_STATE_PATH || path.join(__dirname, '../data/chat-traffic-alert.json'),
    },
    accounts: () => accounts().filter(account => account.role === 'admin' && account.active !== false),
    chatErrors: true,
    cooldownMs: 60 * 60_000,
    subject: 'OKSBDC Chatbot: Possible DDoS activity — lite mode enabled',
    describe: (details, timestamp) => [
      'Unusually high chat request volume may indicate a DDoS attack or a legitimate traffic surge.',
      `Time: ${new Date(timestamp).toISOString()}`,
      `Observed: ${details.count} requests in a ${details.windowMs / 1000}-second counting window.`,
      `Lite mode allows only saved responses; AI generation, translation, and retrieval are skipped.`,
      `Automatic recovery follows ${details.holdMs / 60_000} minutes without another threshold breach.`,
      'Check reverse-proxy/CDN and server logs. Further traffic email alerts are suppressed for one hour.',
    ].join('\n'),
  });
}

// Atomic, expiring counters share protection across instances when Redis is configured.
const OBSERVE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local activated = 0
if count >= tonumber(ARGV[2]) then
  if redis.call('EXISTS', KEYS[2]) == 0 then activated = 1 end
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
end
return {count, redis.call('PTTL', KEYS[2]), activated}
`;

function createChatTrafficGuard({ env = process.env, now = Date.now, redis = getRedisClient,
  notify = createTrafficAlertNotifier({ env }), logger = console } = {}) {
  const windowMs = positiveInteger(env.CHAT_TRAFFIC_WINDOW_MS, 60_000);
  const maxRequests = positiveInteger(env.CHAT_TRAFFIC_MAX_REQUESTS, 300);
  const holdMs = positiveInteger(env.CHAT_LITE_MODE_HOLD_MS, 10 * 60_000);
  const prefix = env.CHAT_TRAFFIC_REDIS_PREFIX || 'oksbdc:chat-traffic';
  let windowEndsAt = 0;
  let count = 0;
  let liteUntil = 0;
  let redisWarningAt = -Infinity;

  const status = () => ({ liteMode: liteUntil > now(), reason: liteUntil > now() ? 'high_traffic' : null });
  const warnRedis = () => {
    if (now() - redisWarningAt < 60_000) return;
    redisWarningAt = now();
    logger.error('Chat traffic protection: Redis unavailable; using per-process protection.');
  };
  async function getStatus() {
    try {
      const client = redis();
      if (client) {
        const remaining = await client.pttl(`${prefix}:lite`);
        if (remaining > 0) liteUntil = Math.max(liteUntil, now() + remaining);
      }
    } catch { warnRedis(); }
    return status();
  }

  async function observe() {
    const timestamp = now();
    if (timestamp >= windowEndsAt) { windowEndsAt = timestamp + windowMs; count = 0; }
    count++;
    let observedCount = count;
    let activated = false;
    const observeLocally = () => {
      if (count < maxRequests) return;
      activated = liteUntil <= timestamp;
      liteUntil = timestamp + holdMs;
    };
    try {
      const client = redis();
      if (client) {
        const result = await client.eval(OBSERVE_SCRIPT, 2, `${prefix}:count`, `${prefix}:lite`, windowMs, maxRequests, holdMs);
        observedCount = Number(result[0]);
        if (Number(result[1]) > 0) liteUntil = Math.max(liteUntil, now() + Number(result[1]));
        activated = Number(result[2]) === 1;
      } else observeLocally();
    } catch { warnRedis(); observeLocally(); }
    if (activated) {
      const details = { count: observedCount, windowMs, holdMs };
      logger.warn(JSON.stringify({ event: 'possible_ddos_lite_mode_enabled', ...details, timestamp: new Date(timestamp).toISOString() }));
      void workTracker.trackBackgroundTask(() => Promise.resolve().then(() => notify(details))).catch(() => {
        logger.error('Chat traffic administrator notification failed.');
      });
    }
    return status();
  }

  const middleware = workTracker.trackHandler(async (req, res, next) => {
    if (req.method === 'POST' && req.path === '/') {
      req.chatTrafficMode = req.liveChatTest ? await getStatus() : await observe();
    }
    next();
  });
  return { middleware, getStatus, observe };
}

const chatTrafficGuard = createChatTrafficGuard();
module.exports = { createChatTrafficGuard, createTrafficAlertNotifier, chatTrafficGuard };
