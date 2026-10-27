/**
 * routes/dashboard.js — Dashboard management routes.
 *
 * All routes in this file require a valid JWT (see routes/auth.js).
 *
 * Mounted at /chatbot/api in index.js, so paths here are relative to that prefix:
 *   GET  /chatbot/api/system-prompt
 *   PUT  /chatbot/api/system-prompt
 *   GET  /chatbot/api/dashboard/blocked-responses
 *   GET  /chatbot/api/dashboard/blocked-responses/history
 *   POST /chatbot/api/dashboard/blocked-responses/review
 *   POST /chatbot/api/dashboard/hide-entry
 *   GET  /chatbot/api/dashboard/conversation-context
 *   GET  /chatbot/api/dashboard/conversations
 *   GET  /chatbot/api/dashboard/feedback-summary
 *   GET  /chatbot/api/dashboard/temp-bans
 *   POST /chatbot/api/dashboard/temp-bans/unban
 *   POST /chatbot/api/dashboard/temp-bans/clear
 *   POST /chatbot/api/dashboard/temp-bans/exempt
 *   GET  /chatbot/api/dashboard/temp-bans/exemptions
 *   POST /chatbot/api/dashboard/temp-bans/exempt/revoke
 */

'use strict';

const { workTracker } = require('../lib/work-tracker');
const { translateConversation } = require('../lib/conversation-translation');

const { notifyUsageLimit } = require('../lib/gemini-usage-alert');

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const { requireAuth }                              = require('./auth');
const crypto = require('crypto');
const { appendAiResponseLog, readAiResponseLogLines, appendDashboardAuditLog, readDashboardAuditLogLines } = require('../util/logger');
const {
  getBans,
  deleteBan,
  clearAllBans,
  grantBanExemption,
  listBanExemptions,
  revokeBanExemption,
}                                                  = require('../lib/ban');
const {
  sanitizeConversationId,
  redactSensitiveText,
  parseJsonLogLine,
  getEntryConversationId,
  getEntryMessageText,
  isEntryBlocked,
  isEntryPredefined,
  getEntryRuleId,
  isEntryUnsureResponse,
  getEntryUnsureCategory,
  getEntryConfidenceScore,
  getEntryConfidenceReason,
  getEntryFeedback,
  getConversationTurnKey,
  buildBlockedReviewMap,
  BLOCKED_REVIEW_STATUSES,
}                                                  = require('../util/helpers');
const { systemPromptPath, state }                    = require('../lib/state');
const { getReleaseVersion, saveVersionedPrompt } = require('../lib/prompt-version');
const { readArchivedConversationIds, archiveConversation, restoreConversation } = require('../lib/conversation-archive');
const {
  getMessageFilterRulesPath,
  readMessageFilterRuleStore,
  writeMessageFilterRuleStore,
  summarizeMessageFilterRule,
} = require('../lib/message-filter-rules');

const router = express.Router();
const { buildMonthlyAnalytics, linkClickKind } = require('../lib/monthly-analytics');
const { parseConversationFilters, normalizeWebsitePage, conversationSearchSummary, matchesConversationFilters } = require('../lib/conversation-search');
const { REVIEW_STATUSES, emptyReview, readConversationReviews, saveConversationReview } = require('../lib/conversation-review');
const { rememberConversationVisit, conversationVisitReference, groupConversationsByVisit } = require('../lib/conversation-visits');

const CLASSIFICATION_LABELS = Object.freeze({
  starting_business: 'Starting a business',
  funding: 'Funding',
  marketing: 'Marketing',
  legal: 'Legal and licensing',
  location: 'Location assistance',
  training: 'Training',
  nonprofit: 'Nonprofit',
  technology: 'Technology',
  government_contracting: 'Government contracting',
  human_help: 'Advisor help',
  feedback: 'Feedback',
  greeting: 'Greeting',
  out_of_scope: 'Out of scope',
  general: 'General',
  loans_vs_grants: 'Loans Vs. Grants',
});

const UNSURE_CATEGORY_LABELS = Object.freeze({
  insufficient_user_details: 'Needs more business details',
  ambiguous_user_intent: 'Ambiguous user intent',
  missing_oklahoma_specific_context: 'Missing Oklahoma-specific context',
  external_current_info_needed: 'Current external information needed',
  conflicting_or_incomplete_context: 'Conflicting or incomplete context',
  complex_professional_judgment: 'Complex professional judgment',
  outside_available_context: 'Outside available context',
  uncategorized: 'Uncategorized',
  other: 'Other',
});

const RESPONSE_TYPE_LABELS = Object.freeze({
  ai_generated: 'AI generated',
  predefined: 'Predefined response',
  blocked: 'Blocked response',
  degraded: 'Degraded service reply',
  expired: 'Conversation expired',
  error: 'Error response',
  unknown: 'Unknown response type',
});

function assertUniqueIds(ids) {
  return new Set(ids).size === ids.length;
}

const { buildKeywordPattern } = require('rules-kit');

function buildEffectiveRulePattern(regexPattern, keywordListRaw) {
  if (regexPattern) return regexPattern;

  return buildKeywordPattern(keywordListRaw);
}

const { normalizeResponseLanguage } = require('../lib/response-language');

function normalizeRuleDraftInput(body = {}) {
  return {
    displayName: body.displayName,
    regexPattern: typeof body.regexPattern === 'string' ? body.regexPattern.trim() : '',
    keywordListRaw: typeof body.keywords === 'string' ? body.keywords.trim() : '',
    reply: typeof body.reply === 'string' ? body.reply.trim() : '',
    action: body.action === 'block' ? 'block' : 'respond',
    language: body.language,
    intents: body.intents,
    prevIntents: body.prevIntents,
    userIntents: body.userIntents,
  };
}

function buildDashboardRule({ id, displayName, regexPattern, keywordListRaw, reply, action, language, intents, prevIntents, userIntents }) {
  const effectivePattern = buildEffectiveRulePattern(regexPattern, keywordListRaw);
  if (!effectivePattern) {
    throw new Error('No valid keywords were provided.');
  }

  // Validate before persisting the rule.
  // eslint-disable-next-line no-new
  new RegExp(effectivePattern, 'i');

  const rule = {
    id,
    pattern: effectivePattern,
    flags: 'i',
    action,
  };
  if (displayName !== undefined) {
    if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 120) {
      throw new Error('Rule name must be between 1 and 120 characters.');
    }
    rule.displayName = displayName.trim();
  }
  if (language !== undefined) rule.language = normalizeResponseLanguage(language);
  for (const [field, tags] of Object.entries({ intents, prevIntents, userIntents })) {
    if (tags === undefined) continue;
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) {
      throw new Error(`${field} must be an array of category names.`);
    }
    rule[field] = [...new Set(tags.map((tag) => tag.trim().toLowerCase().replace(/[\s-]+/g, '_')).filter(Boolean))];
  }

  if (action === 'block') {
    rule.message = reply;
    rule.reply = reply;
  } else {
    rule.reply = reply;
  }

  return rule;
}

function loadRuleStore() {
  return readMessageFilterRuleStore(getMessageFilterPath());
}

function saveRuleStore(store) {
  return writeMessageFilterRuleStore(store, getMessageFilterPath());
}

function getPromptSandboxModelName() {
  return process.env.GEMINI_SANDBOX_MODEL || process.env.GEMINI_MODEL || 'gemini-2.0-flash';
}

function getMessageFilterPath() {
  return getMessageFilterRulesPath();
}

const ROLLBACK_TARGETS = Object.freeze({
  SYSTEM_PROMPT: 'system_prompt',
  MESSAGE_FILTER: 'message_filter',
});

function getRollbackRootPath() {
  return process.env.DASHBOARD_ROLLBACK_DIR || path.join(__dirname, '..', 'data', 'rollback');
}

function normalizeRollbackTargetType(value) {
  return Object.values(ROLLBACK_TARGETS).includes(value) ? value : null;
}

function getRollbackTargetPath(targetType) {
  if (targetType === ROLLBACK_TARGETS.SYSTEM_PROMPT) return systemPromptPath;
  if (targetType === ROLLBACK_TARGETS.MESSAGE_FILTER) return getMessageFilterPath();
  throw new Error('Unsupported rollback target type.');
}

function sanitizeSnapshotSegment(value) {
  return String(value || 'change')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'change';
}

function createRollbackSnapshot(targetType, action, metadata = {}) {
  const normalizedTargetType = normalizeRollbackTargetType(targetType);
  if (!normalizedTargetType) throw new Error('Unsupported rollback target type.');

  const sourcePath = getRollbackTargetPath(normalizedTargetType);
  const content = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : '';
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[:.]/g, '-')}-${sanitizeSnapshotSegment(action)}-${Math.random().toString(36).slice(2, 8)}`;
  const snapshotDir = path.join(getRollbackRootPath(), normalizedTargetType);
  const snapshot = {
    id,
    targetType: normalizedTargetType,
    action,
    createdAt,
    sourcePath,
    metadata,
    content,
  };

  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.writeFileSync(path.join(snapshotDir, `${id}.json`), JSON.stringify(snapshot, null, 2), 'utf8');
  return snapshot;
}

function readRollbackSnapshot(targetType, snapshotId) {
  const normalizedTargetType = normalizeRollbackTargetType(targetType);
  const safeSnapshotId = typeof snapshotId === 'string' && /^[a-zA-Z0-9_.-]+$/.test(snapshotId)
    ? snapshotId
    : '';

  if (!normalizedTargetType || !safeSnapshotId) return null;

  const snapshotPath = path.join(getRollbackRootPath(), normalizedTargetType, `${safeSnapshotId}.json`);
  if (!fs.existsSync(snapshotPath)) return null;

  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  if (snapshot?.targetType !== normalizedTargetType || snapshot?.id !== safeSnapshotId) return null;
  return snapshot;
}

function listRollbackSnapshots(limit = 50) {
  const snapshots = [];

  for (const targetType of Object.values(ROLLBACK_TARGETS)) {
    const snapshotDir = path.join(getRollbackRootPath(), targetType);
    if (!fs.existsSync(snapshotDir)) continue;

    for (const filename of fs.readdirSync(snapshotDir)) {
      if (!filename.endsWith('.json')) continue;
      try {
        const snapshot = JSON.parse(fs.readFileSync(path.join(snapshotDir, filename), 'utf8'));
        if (!snapshot?.id || snapshot.targetType !== targetType) continue;
        snapshots.push({
          id: snapshot.id,
          targetType: snapshot.targetType,
          action: snapshot.action || 'unknown',
          createdAt: snapshot.createdAt || null,
          metadata: snapshot.metadata || {},
          contentLength: typeof snapshot.content === 'string' ? snapshot.content.length : 0,
        });
      } catch {
        // Ignore malformed rollback files; they should not break the dashboard.
      }
    }
  }

  return snapshots
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, limit);
}

function restoreRollbackSnapshot(snapshot) {
  if (!snapshot || typeof snapshot.content !== 'string') {
    throw new Error('Rollback snapshot is invalid.');
  }

  if (snapshot.targetType === ROLLBACK_TARGETS.SYSTEM_PROMPT) {
    const restoredPrompt = snapshot.content.trim();
    if (!restoredPrompt) throw new Error('Cannot restore an empty system prompt snapshot.');
    return saveVersionedPrompt(restoredPrompt);
  }

  if (snapshot.targetType === ROLLBACK_TARGETS.MESSAGE_FILTER) {
    fs.writeFileSync(getMessageFilterPath(), snapshot.content, 'utf8');
    return { ok: true };
  }

  throw new Error('Unsupported rollback target type.');
}

/**
 * Truncates text for readable debug summaries.
 *
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncateText(text, max = 220) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) {
    return '';
  }

  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

const DASHBOARD_HIDE_TARGET_TYPES = new Set([
  'blocked_response',
  'unsure_response',
  'feedback_detail',
  'context_turn',
  'conversation_message',
]);

function buildDashboardEntryKey(targetType, parts = []) {
  return [targetType, ...parts.map((part) => (part === null || part === undefined ? '' : String(part)))]
    .join('::');
}

function buildDashboardHiddenKeySet(lines) {
  const hiddenKeys = new Set();

  for (const line of lines) {
    const entry = parseJsonLogLine(line);
    const details = entry?.details && typeof entry.details === 'object' ? entry.details : {};
    const hideFromDashboard = entry?.hide_from_dashboard === true || details.hide_from_dashboard === true;
    const targetKey = typeof entry?.target_key === 'string' ? entry.target_key : details.target_key;
    if (!entry || entry.event !== 'dashboard_hide_entry' || hideFromDashboard !== true) continue;
    if (typeof targetKey === 'string' && targetKey.trim()) {
      hiddenKeys.add(targetKey.trim());
    }
  }

  return hiddenKeys;
}

function getBlockedDashboardKey(entry) {
  return buildDashboardEntryKey('blocked_response', [
    getEntryConversationId(entry),
    Number.isFinite(entry?.turn) ? entry.turn : '',
    entry?.timestamp || '',
  ]);
}

function getUnsureDashboardKey(entry) {
  return buildDashboardEntryKey('unsure_response', [
    getEntryConversationId(entry) || '',
    Number.isFinite(entry?.turn) ? entry.turn : '',
    entry?.timestamp || '',
  ]);
}

function getFeedbackDashboardKey(entry) {
  const feedback = getEntryFeedback(entry);
  return buildDashboardEntryKey('feedback_detail', [
    getEntryConversationId(entry) || '',
    Number.isFinite(entry?.turn) ? entry.turn : '',
    feedback.scope || '',
    feedback.value || '',
    entry?.timestamp || '',
  ]);
}

function getContextTurnDashboardKey(conversationId, turn) {
  return buildDashboardEntryKey('context_turn', [conversationId, Number.isFinite(turn) ? turn : '']);
}

function getConversationMessageDashboardKey(conversationId, turn, role) {
  return buildDashboardEntryKey('conversation_message', [conversationId, Number.isFinite(turn) ? turn : '', role || '']);
}

function buildConversationContextSummary(turns) {
  if (!Array.isArray(turns) || turns.length === 0) {
    return 'No turns found for this conversation.';
  }
  const turnNumbers = turns.map((t) => t.turn).filter(Number.isFinite);
  const minTurn = Math.min(...turnNumbers);
  const maxTurn = Math.max(...turnNumbers);
  return `Showing ${turns.length} turn${turns.length === 1 ? '' : 's'} from turn ${minTurn} through ${maxTurn}`;
}

function buildConversationTurnMap(lines) {
  const conversations = new Map();

  for (const line of lines) {
    const entry = parseJsonLogLine(line);
    if (!entry || (!getEntryMessageText(entry, 'user') && !getEntryMessageText(entry, 'assistant'))) continue;

    const conversationId = getEntryConversationId(entry);
    const turn = Number.isFinite(entry.turn) ? entry.turn : null;
    if (!conversationId || !turn) continue;

    if (!conversations.has(conversationId)) {
      conversations.set(conversationId, new Map());
    }

    const turns = conversations.get(conversationId);
    const current = turns.get(turn) || {
      turn,
      timestamp: null,
      userMessage: '',
      assistantReply: '',
    };

    if (!current.timestamp && entry.timestamp) current.timestamp = entry.timestamp;

    const userMessage = redactSensitiveText(getEntryMessageText(entry, 'user'));
    const assistantReply = redactSensitiveText(getEntryMessageText(entry, 'assistant'));

    if (userMessage) current.userMessage = userMessage;
    if (assistantReply) current.assistantReply = assistantReply;

    turns.set(turn, current);
  }

  return conversations;
}

function getOrderedConversationMessages(conversationTurns) {
  if (!conversationTurns) return [];

  return [...conversationTurns.values()]
    .sort((a, b) => a.turn - b.turn)
    .flatMap((turn) => {
      const messages = [];
      if (turn.userMessage) {
        messages.push({ role: 'user', turn: turn.turn, content: turn.userMessage, timestamp: turn.timestamp });
      }
      if (turn.assistantReply) {
        messages.push({ role: 'assistant', turn: turn.turn, content: turn.assistantReply, timestamp: turn.timestamp });
      }
      return messages;
    });
}

// All dashboard routes require authentication.
router.use(requireAuth);
// Enforce read-only access before any handler can change state or run a test.
router.use((req, res, next) => {
  if (req.dashboardUser.role === 'readonly' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return res.status(403).json({ error: 'This dashboard account is read-only.' });
  }
  return next();
});
router.use('/dashboard/users', require('./dashboard-users'));

router.post('/dashboard/live-chat-test', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json(require('../lib/live-chat-test').createLiveChatTestSession(req.dashboardUser));
});

// Aggregate retained logs only; raw session identifiers and message text never
// leave this endpoint. A bounded range keeps the response small.
router.get('/dashboard/monthly-analytics', (req, res) => {
  const { startMonth, endMonth } = req.query;
  const validMonth = (value) => typeof value === 'string' && /^(20\d{2})-(0[1-9]|1[0-2])$/.test(value);
  if ((startMonth !== undefined && !validMonth(startMonth)) || (endMonth !== undefined && !validMonth(endMonth))) {
    return res.status(400).json({ error: 'Use YYYY-MM months.' });
  }
  const end = endMonth || new Date().toISOString().slice(0, 7);
  const monthIndex = (value) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5));
  if (startMonth && (startMonth > end || monthIndex(end) - monthIndex(startMonth) >= 60)) {
    return res.status(400).json({ error: 'Choose an ordered date range of at most 60 months.' });
  }
  try {
    res.set('Cache-Control', 'no-store');
    return res.json(buildMonthlyAnalytics(readAiResponseLogLines(), { startMonth, endMonth: end }));
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Unable to build monthly analytics.' });
  }
});

// ─── System prompt ─────────────────────────────────────────────────────────────

// Returns the current active system prompt. Used by the dashboard editor.
router.get('/system-prompt', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ systemPrompt: state.systemPrompt, version: getReleaseVersion() });
});

router.post('/dashboard/system-prompt/test', workTracker.trackHandler(async (req, res) => {
  const nextPrompt = req.body?.systemPrompt;
  const testMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

  if (typeof nextPrompt !== 'string') {
    return res.status(400).json({ error: 'systemPrompt must be a string.' });
  }

  const trimmedPrompt = nextPrompt.trim();
  if (!trimmedPrompt) {
    return res.status(400).json({ error: 'systemPrompt cannot be empty.' });
  }

  if (trimmedPrompt.length > 10000) {
    return res.status(400).json({ error: 'systemPrompt is too long. Max 8000 characters.' });
  }

  if (!testMessage) {
    return res.status(400).json({ error: 'message is required.' });
  }

  if (testMessage.length > 400) {
    return res.status(400).json({ error: 'message is too long. Max 400 characters.' });
  }

  const modelName = getPromptSandboxModelName();

  if (!process.env.GEMINI_API_KEY) {
    return res.json({
      ok: true,
      persisted: false,
      aiGenerated: false,
      model: modelName,
      reply: 'Prompt sandbox validation passed, but GEMINI_API_KEY is not configured, so no AI preview was generated.',
    });
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: trimmedPrompt,
    });
    const result = await model.generateContent(redactSensitiveText(testMessage, { maxLength: null }));
    const reply = typeof result?.response?.text === 'function' ? result.response.text() : '';

    return res.json({
      ok: true,
      persisted: false,
      aiGenerated: true,
      model: modelName,
      reply: reply || 'The model returned an empty response.',
    });
  } catch (error) {
    void notifyUsageLimit(error, 'Dashboard prompt sandbox');
    return res.status(502).json({ error: error?.message || 'Unable to run prompt sandbox.' });
  }
}));

// Updates the system prompt in memory AND writes it to system-prompt.txt so
// the change survives a server restart. Takes effect immediately.
// Enforces a max length of 8000 characters.
router.put('/system-prompt', (req, res) => {
  const nextPrompt = req.body?.systemPrompt;

  if (typeof nextPrompt !== 'string') {
    return res.status(400).json({ error: 'systemPrompt must be a string.' });
  }

  const trimmedPrompt = nextPrompt.trim();
  if (!trimmedPrompt) {
    return res.status(400).json({ error: 'systemPrompt cannot be empty.' });
  }

  if (trimmedPrompt.length > 10000) {
    return res.status(400).json({ error: 'systemPrompt is too long. Max 8000 characters.' });
  }

  try {
    const rollbackSnapshot = trimmedPrompt !== state.systemPrompt.trim()
      ? createRollbackSnapshot(ROLLBACK_TARGETS.SYSTEM_PROMPT, 'system_prompt_update') : null;
    const saved = saveVersionedPrompt(trimmedPrompt);
    return res.json({ ...saved, rollbackSnapshotId: rollbackSnapshot?.id || null });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Unable to save system prompt and version.' });
  }
});

router.get('/dashboard/rollback-snapshots', (req, res) => {
  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
  return res.json({ items: listRollbackSnapshots(limit) });
});

router.post('/dashboard/rollback-snapshots/restore', (req, res) => {
  const targetType = normalizeRollbackTargetType(req.body?.targetType);
  const snapshotId = typeof req.body?.snapshotId === 'string' ? req.body.snapshotId.trim() : '';

  if (!targetType || !snapshotId) {
    return res.status(400).json({ error: 'targetType and snapshotId are required.' });
  }

  try {
    const snapshot = readRollbackSnapshot(targetType, snapshotId);
    if (!snapshot) return res.status(404).json({ error: 'Rollback snapshot not found.' });

    const preRestoreSnapshot = createRollbackSnapshot(targetType, `pre_restore_${snapshot.action || 'snapshot'}`, { restoringSnapshotId: snapshot.id });
    const restored = restoreRollbackSnapshot(snapshot);

    appendAiResponseLog({
      timestamp: new Date().toISOString(),
      event: 'dashboard_rollback_restored',
      target_type: targetType,
      snapshot_id: snapshot.id,
      pre_restore_snapshot_id: preRestoreSnapshot.id,
      original_action: snapshot.action || null,
    });

    return res.json({ ok: true, targetType, snapshotId: snapshot.id, preRestoreSnapshotId: preRestoreSnapshot.id, ...restored });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Unable to restore rollback snapshot.' });
  }
});

router.post('/dashboard/message-filter/rules/test', (req, res) => {
  const { regexPattern, keywordListRaw, reply, action } = normalizeRuleDraftInput(req.body);
  const testMessage = typeof req.body?.testMessage === 'string' ? req.body.testMessage.trim() : '';

  if (!regexPattern && !keywordListRaw) {
    return res.status(400).json({ error: 'Provide regexPattern or keywords.' });
  }
  if (!reply) {
    return res.status(400).json({ error: 'reply is required.' });
  }
  if (!testMessage) {
    return res.status(400).json({ error: 'testMessage is required.' });
  }
  if (testMessage.length > 400) {
    return res.status(400).json({ error: 'testMessage is too long. Max 400 characters.' });
  }

  try {
    const effectivePattern = buildEffectiveRulePattern(regexPattern, keywordListRaw);
    if (!effectivePattern) {
      return res.status(400).json({ error: 'No valid keywords were provided.' });
    }

    const pattern = new RegExp(effectivePattern, 'i');
    const matched = pattern.test(testMessage);

    appendDashboardAuditLog({
      timestamp: new Date().toISOString(),
      action: 'message_filter_rule_tested',
      actor: {
        username: req.dashboardUser?.username || null,
        role: req.dashboardUser?.role || null,
        subject: req.dashboardUser?.sub || null,
      },
      request: {
        method: req.method,
        request_id: req.headers['x-request-id'] || null,
        path: req.originalUrl || req.path,
      },
      details: {
        matched,
        action,
        test_message: {
          redacted_preview: redactSensitiveText(testMessage).slice(0, 200),
        },
      },
    });

    return res.json({
      ok: true,
      persisted: false,
      matched,
      action,
      source: regexPattern ? 'regex' : 'keywords',
      effectivePattern,
      testMessage,
      reply: matched ? reply : null,
    });
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'Unable to test rule draft.' });
  }
});

// Adds a new regex rule to the JSON-backed message-filter rule store.
router.post('/dashboard/message-filter/rules', (req, res) => {
  const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
  const draft = normalizeRuleDraftInput(req.body);
  const { regexPattern, keywordListRaw, reply, action } = draft;

  if (!id || !/^[a-z0-9_]+$/i.test(id)) {
    return res.status(400).json({ error: 'id is required and must be alphanumeric/underscore.' });
  }
  if (!regexPattern && !keywordListRaw) {
    return res.status(400).json({ error: 'Provide regexPattern or keywords.' });
  }
  if (!reply) {
    return res.status(400).json({ error: 'reply is required.' });
  }

  try {
    const store = loadRuleStore();
    if (store.rules.some((rule) => rule.id === id)) {
      return res.status(409).json({ error: `Rule id '${id}' already exists.` });
    }

    const newRule = buildDashboardRule({ id, ...draft, displayName: id, language: draft.language === undefined ? 'en' : draft.language });
    const rollbackSnapshot = createRollbackSnapshot(ROLLBACK_TARGETS.MESSAGE_FILTER, 'message_filter_rule_add', { rule_id: id, displayName: newRule.displayName, action });
    store.rules.push(newRule);
    saveRuleStore(store);

    appendAiResponseLog({
      timestamp: new Date().toISOString(),
      event: 'dashboard_rule_added',
      conversation_id: null,
      rule_id: id,
      action,
      source: regexPattern ? 'regex' : 'keywords',
      rollback_snapshot_id: rollbackSnapshot.id,
    });

    appendDashboardAuditLog({
      timestamp: new Date().toISOString(),
      action: 'message_filter_rule_added',
      actor: {
        username: req.dashboardUser?.username || null,
        role: req.dashboardUser?.role || null,
        subject: req.dashboardUser?.sub || null,
      },
      request: {
        method: req.method,
        request_id: req.headers['x-request-id'] || null,
        path: req.originalUrl || req.path,
      },
      target: {
        type: 'message_filter_rule',
        id,
        displayName: newRule.displayName,
      },
      rollback_snapshot_id: rollbackSnapshot.id,
      details: {
        rule: {
          reply: {
            length: reply.length,
            sha256: crypto.createHash('sha256').update(reply).digest('hex'),
          },
        },
        action,
        source: regexPattern ? 'regex' : 'keywords',
      },
    });

    return res.json({ ok: true, id, displayName: newRule.displayName, action, source: regexPattern ? 'regex' : 'keywords', rollbackSnapshotId: rollbackSnapshot.id });
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'Unable to add rule.' });
  }
});

router.get('/dashboard/message-filter/rules', (_req, res) => {
  try {
    const store = loadRuleStore();
    const items = store.rules.map(summarizeMessageFilterRule);
    return res.json({ items, totalRules: items.length });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Unable to load rules.' });
  }
});

router.put('/dashboard/message-filter/rules/order', (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)
    : [];

  if (!ids.length) {
    return res.status(400).json({ error: 'ids must be a non-empty array.' });
  }

  if (!assertUniqueIds(ids)) {
    return res.status(400).json({ error: 'ids must not contain duplicates.' });
  }

  try {
    const store = loadRuleStore();
    const ruleById = new Map(store.rules.map((rule) => [rule.id, rule]));
    const existingIds = store.rules.map((rule) => rule.id);

    if (ids.length !== existingIds.length || ids.some((id) => !ruleById.has(id))) {
      return res.status(400).json({ error: 'ids must include every existing rule exactly once.' });
    }

    const rollbackSnapshot = createRollbackSnapshot(ROLLBACK_TARGETS.MESSAGE_FILTER, 'message_filter_rule_reorder', { rule_count: ids.length });
    store.rules = ids.map((id) => ruleById.get(id));
    saveRuleStore(store);

    appendAiResponseLog({
      timestamp: new Date().toISOString(),
      event: 'dashboard_rule_order_updated',
      conversation_id: null,
      rule_count: ids.length,
      first_rule_id: ids[0] || null,
      last_rule_id: ids[ids.length - 1] || null,
      rollback_snapshot_id: rollbackSnapshot.id,
    });

    return res.json({ ok: true, rollbackSnapshotId: rollbackSnapshot.id, items: ids.map((id, index) => ({ id, order: index + 1 })) });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Unable to reorder rules.' });
  }
});

router.put('/dashboard/message-filter/rules/:id', (req, res) => {
  const id = typeof req.params?.id === 'string' ? req.params.id.trim() : '';
  const draft = normalizeRuleDraftInput(req.body);
  const { regexPattern, keywordListRaw, reply, action } = draft;
  if (!id) return res.status(400).json({ error: 'id is required.' });
  if (!regexPattern && !keywordListRaw) return res.status(400).json({ error: 'Provide regexPattern or keywords.' });
  if (!reply) return res.status(400).json({ error: 'reply is required.' });

  try {
    const store = loadRuleStore();
    const ruleIndex = store.rules.findIndex((rule) => rule.id === id);
    if (ruleIndex === -1) return res.status(404).json({ error: `Rule '${id}' not found.` });

    const existing = store.rules[ruleIndex];
    const updated = { ...existing, ...buildDashboardRule({ id, ...draft }), flags: existing.flags || 'i' };
    if (action === 'respond' && existing.action === 'block') delete updated.message;
    const rollbackSnapshot = createRollbackSnapshot(ROLLBACK_TARGETS.MESSAGE_FILTER, 'message_filter_rule_update', { rule_id: id, displayName: updated.displayName, action });
    store.rules[ruleIndex] = updated;
    saveRuleStore(store);

    if (existing.displayName !== updated.displayName) appendDashboardAuditLog({
      timestamp: new Date().toISOString(), action: 'message_filter_rule_renamed',
      actor: { username: req.dashboardUser?.username || null, role: req.dashboardUser?.role || null, subject: req.dashboardUser?.sub || null },
      target: { type: 'message_filter_rule', id, displayName: updated.displayName },
      details: { previousDisplayName: existing.displayName, displayName: updated.displayName },
      rollback_snapshot_id: rollbackSnapshot.id,
    });

    appendAiResponseLog({
      timestamp: new Date().toISOString(),
      event: 'dashboard_rule_updated',
      rule_id: id,
      action,
      rollback_snapshot_id: rollbackSnapshot.id,
    });
    return res.json({ ok: true, id, displayName: updated.displayName, action, rollbackSnapshotId: rollbackSnapshot.id });
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'Unable to update rule.' });
  }
});

router.delete('/dashboard/message-filter/rules/:id', (req, res) => {
  const id = typeof req.params?.id === 'string' ? req.params.id.trim() : '';
  if (!id) return res.status(400).json({ error: 'id is required.' });
  try {
    const store = loadRuleStore();
    const ruleIndex = store.rules.findIndex((rule) => rule.id === id);
    if (ruleIndex === -1) return res.status(404).json({ error: `Rule '${id}' not found.` });

    const rollbackSnapshot = createRollbackSnapshot(ROLLBACK_TARGETS.MESSAGE_FILTER, 'message_filter_rule_delete', { rule_id: id, displayName: store.rules[ruleIndex].displayName });
    store.rules.splice(ruleIndex, 1);
    saveRuleStore(store);

    appendAiResponseLog({
      timestamp: new Date().toISOString(),
      event: 'dashboard_rule_deleted',
      rule_id: id,
      rollback_snapshot_id: rollbackSnapshot.id,
    });
    return res.json({ ok: true, id, rollbackSnapshotId: rollbackSnapshot.id });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Unable to delete rule.' });
  }
});

// ─── Blocked responses ────────────────────────────────────────────────────────

// Returns recent chat turns blocked by regex rules. Used by the dashboard to
// review blocked activity and matched rule IDs.
router.get('/dashboard/blocked-responses', (req, res) => {
  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const limit    = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

  if (readAiResponseLogLines().length === 0) {
    return res.json({ items: [], totalBlocked: 0 });
  }

  try {
    const lines        = readAiResponseLogLines();
    const reviewMap    = buildBlockedReviewMap(lines);
    const hiddenKeys   = buildDashboardHiddenKeySet(lines);
    const items        = [];
    let totalBlocked   = 0;

    // Iterate newest-first so the dashboard shows the most recent blocked turns.
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const entry = parseJsonLogLine(lines[index]);
      if (!entry || !isEntryBlocked(entry)) continue;

      const dashboardKey = getBlockedDashboardKey(entry);
      if (hiddenKeys.has(dashboardKey)) continue;

      totalBlocked += 1;
      if (items.length >= limit) continue;

      const reviewKey = getConversationTurnKey(
        getEntryConversationId(entry),
        Number.isFinite(entry.turn) ? entry.turn : null,
      );
      const review = reviewKey ? reviewMap.get(reviewKey) : null;

      items.push({
        timestamp:      entry.timestamp                                    || null,
        conversationId: getEntryConversationId(entry),
        turn:           Number.isFinite(entry.turn) ? entry.turn           : null,
        userMessage:    redactSensitiveText(getEntryMessageText(entry, 'user')),
        blockedReply:   redactSensitiveText(getEntryMessageText(entry, 'assistant')),
        regexCategory:  getEntryRuleId(entry) || 'unknown',
        reviewStatus:   review?.status                                     || null,
        dashboard_key:  dashboardKey,
      });
    }

    return res.json({ items, totalBlocked });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Unable to load blocked responses.' });
  }
});

// Returns the full chat timeline for one conversation for detailed inspection.
router.get('/dashboard/blocked-responses/history', (req, res) => {
  const rawConversationId = typeof req.query.conversationId === 'string'
    ? req.query.conversationId.trim()
    : '';
  const rawTurn    = Number.parseInt(String(req.query.turn || ''), 10);
  const flaggedTurn = Number.isFinite(rawTurn) && rawTurn > 0 ? rawTurn : null;

  if (!rawConversationId) {
    return res.status(400).json({ error: 'conversationId query parameter is required.' });
  }

  if (readAiResponseLogLines().length === 0) {
    return res.json({ conversationId: rawConversationId, flaggedTurn, messages: [], flaggedCategory: null });
  }

  try {
    const lines        = readAiResponseLogLines();
    const reviewMap    = buildBlockedReviewMap(lines);
    const hiddenKeys   = buildDashboardHiddenKeySet(lines);
    const turns        = new Map();
    let flaggedCategory = null;

    for (const line of lines) {
      const entry = parseJsonLogLine(line);
      if (!entry || (!getEntryMessageText(entry, 'user') && !getEntryMessageText(entry, 'assistant'))) continue;

      const conversationId = getEntryConversationId(entry);
      if (conversationId !== rawConversationId) continue;

      const turn = Number.isFinite(entry.turn) ? entry.turn : null;
      if (!turn) continue;

      const current = turns.get(turn) || {
        turn,
        timestamp:     entry.timestamp || null,
        userMessage:   '',
        assistantReply: '',
      };

      if (!current.timestamp && entry.timestamp) current.timestamp = entry.timestamp;

      const userMessage    = redactSensitiveText(getEntryMessageText(entry, 'user'));
      const assistantReply = redactSensitiveText(getEntryMessageText(entry, 'assistant'));

      if (userMessage)    current.userMessage    = userMessage;
      if (assistantReply) current.assistantReply = assistantReply;

      if (isEntryBlocked(entry) && turn === flaggedTurn) {
        flaggedCategory = getEntryRuleId(entry) || flaggedCategory || 'unknown';
      }

      turns.set(turn, current);
    }

    const orderedTurns = [...turns.values()].sort((a, b) => a.turn - b.turn);
    const messages     = [];
    const reviewKey    = getConversationTurnKey(rawConversationId, flaggedTurn);
    const review       = reviewKey ? reviewMap.get(reviewKey) : null;

    for (const item of orderedTurns) {
      if (item.userMessage) {
        const dashboardKey = getConversationMessageDashboardKey(rawConversationId, item.turn, 'user');
        if (!hiddenKeys.has(dashboardKey)) {
          messages.push({
            role:      'user',
            turn:      item.turn,
            content:   item.userMessage,
            timestamp: item.timestamp,
            flagged:   flaggedTurn === item.turn,
            dashboard_key: dashboardKey,
          });
        }
      }
      if (item.assistantReply) {
        const dashboardKey = getConversationMessageDashboardKey(rawConversationId, item.turn, 'assistant');
        if (!hiddenKeys.has(dashboardKey)) {
          messages.push({
            role:      'assistant',
            turn:      item.turn,
            content:   item.assistantReply,
            timestamp: item.timestamp,
            flagged:   false,
            dashboard_key: dashboardKey,
          });
        }
      }
    }

    return res.json({
      conversationId: rawConversationId,
      flaggedTurn,
      flaggedCategory,
      reviewStatus: review?.status || null,
      messages,
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Unable to load blocked conversation history.' });
  }
});

// Records an admin review choice for a blocked response. Append-only log event.
router.post('/dashboard/blocked-responses/review', (req, res) => {
  const conversationId = sanitizeConversationId(req.body?.conversationId);
  const rawTurn        = Number.parseInt(String(req.body?.turn || ''), 10);
  const turn           = Number.isFinite(rawTurn) && rawTurn > 0 ? rawTurn : null;
  const reviewStatus   = typeof req.body?.reviewStatus === 'string' ? req.body.reviewStatus.trim() : '';
  const regexCategory  = typeof req.body?.regexCategory === 'string' ? req.body.regexCategory.trim() : '';

  if (!conversationId) {
    return res.status(400).json({ error: 'conversationId is required.' });
  }
  if (!turn) {
    return res.status(400).json({ error: 'turn must be a positive integer.' });
  }
  if (!BLOCKED_REVIEW_STATUSES.has(reviewStatus)) {
    return res.status(400).json({ error: 'reviewStatus is invalid.' });
  }

  appendAiResponseLog({
    timestamp:      new Date().toISOString(),
    event:          'blocked_response_review',
    conversation_id: conversationId,
    turn,
    reviewStatus,
    regexCategory:  regexCategory || null,
  });

  return res.json({ conversationId, turn, reviewStatus });
});

// Append-only hide marker: preserves original logs but removes entries from dashboard views.
router.post('/dashboard/hide-entry', (req, res) => {
  const targetType = typeof req.body?.target_type === 'string' ? req.body.target_type.trim() : '';
  const targetKey = typeof req.body?.target_key === 'string' ? req.body.target_key.trim() : '';
  const rawTurn = Number.parseInt(String(req.body?.turn || ''), 10);
  const turn = Number.isFinite(rawTurn) && rawTurn > 0 ? rawTurn : null;

  if (!DASHBOARD_HIDE_TARGET_TYPES.has(targetType)) {
    return res.status(400).json({ error: 'target_type is invalid.' });
  }

  if (!targetKey) {
    return res.status(400).json({ error: 'target_key is required.' });
  }

  appendAiResponseLog({
    timestamp: new Date().toISOString(),
    event: 'dashboard_hide_entry',
    hide_from_dashboard: true,
    target_type: targetType,
    target_key: targetKey,
    conversation_id: sanitizeConversationId(req.body?.conversation_id) || null,
    turn,
  });

  return res.json({ hidden: true, target_type: targetType, target_key: targetKey });
});

// Archive visibility is stored separately from retained conversation logs.
router.post('/dashboard/conversations/archive', (req, res) => {
  const rawId = req.body?.conversationId;
  const conversationId = sanitizeConversationId(rawId);
  if (typeof rawId !== 'string' || !conversationId || conversationId !== rawId.trim()) {
    return res.status(400).json({ error: 'A valid conversationId is required.' });
  }
  try {
    if (!readArchivedConversationIds().has(conversationId)
      && !readAiResponseLogLines().some((line) => getEntryConversationId(parseJsonLogLine(line)) === conversationId)) {
      return res.status(404).json({ error: 'Conversation not found in retained logs.' });
    }
    archiveConversation(conversationId);
    return res.json({ conversationId, archived: true });
  } catch {
    return res.status(500).json({ error: 'Unable to archive conversation. Please try again.' });
  }
});

router.post('/dashboard/conversations/restore', (req, res) => {
  const rawId = req.body?.conversationId;
  const conversationId = sanitizeConversationId(rawId);
  if (typeof rawId !== 'string' || !conversationId || conversationId !== rawId.trim()) {
    return res.status(400).json({ error: 'A valid conversationId is required.' });
  }
  try {
    if (!readAiResponseLogLines().some((line) => getEntryConversationId(parseJsonLogLine(line)) === conversationId)) {
      return res.status(404).json({ error: 'Conversation not found in retained logs.' });
    }
    restoreConversation(conversationId);
    return res.json({ conversationId, archived: false });
  } catch {
    return res.status(500).json({ error: 'Unable to restore conversation. Please try again.' });
  }
});

router.post('/dashboard/conversations/review', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { conversationId: rawId, status, note = '', expectedVersion } = req.body || {};
  const conversationId = sanitizeConversationId(rawId);
  if (typeof rawId !== 'string' || !conversationId || conversationId !== rawId.trim()) {
    return res.status(400).json({ error: 'A valid conversation reference is required.' });
  }
  if (!REVIEW_STATUSES.has(status) || typeof note !== 'string' || note.length > 4000
    || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    return res.status(400).json({ error: 'Choose a review status and enter a note of up to 4,000 characters.' });
  }
  try {
    if (!readAiResponseLogLines().some((line) => getEntryConversationId(parseJsonLogLine(line)) === conversationId)) {
      return res.status(404).json({ error: 'Conversation not found in retained logs.' });
    }
    const review = saveConversationReview(conversationId, { status, note: note.trim(), expectedVersion,
      updatedBy: req.dashboardUser?.username || req.dashboardUser?.sub || 'Dashboard staff' });
    return res.json({ conversationId, review });
  } catch (error) {
    if (error.status === 409) return res.status(409).json({ error: error.message, review: error.review });
    return res.status(500).json({ error: 'Unable to save the review. Please try again.' });
  }
});

// Returns searchable active or archived conversation histories.
router.get('/dashboard/conversations', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.query.groupBy !== undefined && req.query.groupBy !== 'visit') {
    return res.status(400).json({ error: 'Choose a supported conversation grouping.' });
  }
  let filters;
  try { filters = parseConversationFilters(req.query); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  try {
    const lines = readAiResponseLogLines();
    const hiddenKeys = buildDashboardHiddenKeySet(lines);
    const archivedIds = readArchivedConversationIds();
    const reviews = readConversationReviews();
    const showArchived = req.query.archived === 'true';
    const includeArchived = req.query.archived === 'all';
    const conversations = new Map();
    const visitIdentities = new Map();
    const requestedId = typeof req.query.conversationId === 'string' ? req.query.conversationId : '';

    lines.forEach((line, index) => {
      const entry = parseJsonLogLine(line);
      const id = getEntryConversationId(entry);
      if (!id || (!includeArchived && archivedIds.has(id) !== showArchived) || (requestedId && id !== requestedId)) return;
      rememberConversationVisit(visitIdentities, id, entry);
      const turn = Number.isFinite(entry.turn) ? entry.turn : null;
      const timestamp = Number.isFinite(Date.parse(entry.timestamp)) ? entry.timestamp : null;
      const base = { turn, timestamp, order: index * 2 };
      const conversation = conversations.get(id) || { conversationId: id, messages: new Map(), feedback: [], referralClicks: [], metadata: new Map() };
      if (entry.event === 'advising_link_clicked') {
        if (turn && (hiddenKeys.has(getContextTurnDashboardKey(id, turn)) ||
          hiddenKeys.has(getConversationMessageDashboardKey(id, turn, 'assistant')))) return;
        const url = entry.details?.url || entry.url;
        if (linkClickKind(url) !== 'advising') return;
        conversation.referralClicks.push({ timestamp, turn, url: redactSensitiveText(url, { maxLength: null }) });
        conversations.set(id, conversation);
      } else if (entry.event === 'chat_feedback') {
        if (hiddenKeys.has(getFeedbackDashboardKey(entry))) return;
        const feedback = getEntryFeedback(entry);
        conversation.feedback.push({ ...base, id: `feedback-${index}`, kind: 'feedback',
          scope: feedback.scope, rating: feedback.value,
          content: redactSensitiveText(feedback.comment || '') });
      } else if (turn && !hiddenKeys.has(getContextTurnDashboardKey(id, turn))) {
        const metadata = conversation.metadata.get(turn) || { topics: new Set(), pages: new Set() };
        const topic = getDashboardMessageIntent(entry);
        const page = normalizeWebsitePage(entry.page_url);
        if (topic) metadata.topics.add(topic);
        if (page) metadata.pages.add(redactSensitiveText(page, { maxLength: null }));
        conversation.metadata.set(turn, metadata);
        // Classification records may precede the message that makes this conversation visible.
        conversations.set(id, conversation);
        for (const role of ['user', 'assistant']) {
          if (hiddenKeys.has(getConversationMessageDashboardKey(id, turn, role))) continue;
          const content = getEntryMessageText(entry, role);
          if (!content) continue;
          const key = `${turn}-${role}`;
          const current = conversation.messages.get(key);
          // Receipt records preserve the user's actual submission time; older logs
          // can only reconstruct the user message from the response record.
          if (current && (role === 'assistant' || current.received || entry.event !== 'chat_turn_received')) continue;
          conversation.messages.set(key, { ...base, id: key, kind: role,
            order: base.order + (role === 'assistant' ? 1 : 0),
            received: role === 'user' && entry.event === 'chat_turn_received',
            reconstructed: role === 'user' && entry.event !== 'chat_turn_received',
            content: redactSensitiveText(content, { maxLength: null }), blocked: isEntryBlocked(entry) || getDashboardResponseType(entry) === 'blocked',
            predefined: isEntryPredefined(entry), ruleId: getEntryRuleId(entry) });
        }
      }
      if (conversation.messages.size || conversation.feedback.length) conversations.set(id, conversation);
    });

    const histories = [...conversations.values()].filter((conversation) => conversation.messages.size || conversation.feedback.length).map((conversation) => {
      const events = [...conversation.messages.values(), ...conversation.feedback]
        .sort((a, b) => a.order - b.order);
      // Without timestamps, retain log order rather than inventing event times.
      if (events.every((event) => event.timestamp)) {
        events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.order - b.order);
      }
      const times = events.map((event) => event.timestamp).filter(Boolean).sort();
      return { conversationId: conversation.conversationId, archived: archivedIds.has(conversation.conversationId), events,
        visitReference: conversationVisitReference(visitIdentities.get(conversation.conversationId)),
        referralClicks: conversation.referralClicks,
        referralClickCount: conversation.referralClicks.length,
        ...conversationSearchSummary(conversation.metadata, events),
        review: reviews.get(conversation.conversationId) || emptyReview(),
        reviewStatus: reviews.get(conversation.conversationId)?.status || 'to_review',
        startedAt: times[0] || null, updatedAt: times.at(-1) || null,
        messageCount: events.filter((event) => event.kind === 'user').length,
        responseCount: events.filter((event) => event.kind === 'assistant').length,
        feedbackCount: conversation.feedback.length,
        preview: events.find((event) => event.kind === 'user')?.content || 'Feedback only' };
    });
    if (requestedId) {
      const conversation = histories[0];
      if (!conversation) return res.status(404).json({ error: 'Conversation not found in retained logs.' });
      if (req.query.translate === 'true') Object.assign(conversation, await translateConversation(conversation.events));
      return res.json(conversation);
    }
    const filterOptions = {
      topics: [...new Set(histories.flatMap((item) => item.topics))].sort(),
      pages: [...new Set(histories.flatMap((item) => item.pages))].sort(),
    };
    const qualityIds = filters.quality ? buildMonthlyAnalytics(lines, {
      startMonth: filters.dateFrom ? filters.dateFrom.slice(0, 7) : '0001-01',
      endMonth: filters.dateTo ? filters.dateTo.slice(0, 7) : '9999-12',
      conversationFilter: filters.quality, dateFrom: filters.dateFrom, dateTo: filters.dateTo,
    }) : null;
    const matches = histories.filter((item) => (!qualityIds || qualityIds.has(item.conversationId)) && matchesConversationFilters(item, filters))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const limit = 25;
    const summarize = ({ events, review, referralClicks, ...summary }) => ({ ...summary, reviewUpdateCount: review.version });
    if (req.query.groupBy === 'visit') {
      const summaries = matches.map(summarize);
      const visits = groupConversationsByVisit(summaries);
      return res.json({ total: visits.length, conversationTotal: summaries.length, offset, limit, filterOptions,
        unlinkedConversationCount: summaries.filter((item) => !item.visitReference).length,
        visits: visits.slice(offset, offset + limit) });
    }
    return res.json({ total: matches.length, offset, limit, filterOptions,
      conversations: matches.slice(offset, offset + limit).map(summarize) });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Unable to load conversation history.' });
  }
});

router.get('/dashboard/conversation-context', (req, res) => {
  const rawConversationId = typeof req.query.conversationId === 'string'
    ? req.query.conversationId.trim()
    : '';
  const rawTurnLimit = Number.parseInt(String(req.query.turn || ''), 10);
  const turnLimit = Number.isFinite(rawTurnLimit) && rawTurnLimit > 0 ? rawTurnLimit : null;

  if (!rawConversationId) {
    return res.status(400).json({ error: 'conversationId query parameter is required.' });
  }

  if (readAiResponseLogLines().length === 0) {
    return res.json({
      conversationId: rawConversationId,
      uptoTurn: turnLimit,
      summary: 'No audit log found yet, so no conversation context is available.',
      turns: [],
    });
  }

  try {
    const lines = readAiResponseLogLines();
    const hiddenKeys = buildDashboardHiddenKeySet(lines);
    const turnsMap = new Map();

    for (const line of lines) {
      const entry = parseJsonLogLine(line);
      if (!entry || (!getEntryMessageText(entry, 'user') && !getEntryMessageText(entry, 'assistant'))) {
        continue;
      }

      const conversationId = getEntryConversationId(entry);
      if (conversationId !== rawConversationId) {
        continue;
      }

      const turn = Number.isFinite(entry.turn) ? entry.turn : null;
      if (!turn || (turnLimit && turn > turnLimit)) {
        continue;
      }

      const current = turnsMap.get(turn) || {
        turn,
        timestamp: null,
        userMessage: '',
        assistantReply: '',
        blocked: false,
        predefined: false,
        ruleId: null,
      };

      current.timestamp = current.timestamp || entry.timestamp || null;
      current.userMessage = redactSensitiveText(getEntryMessageText(entry, 'user') || current.userMessage || '');
      current.assistantReply = redactSensitiveText(getEntryMessageText(entry, 'assistant') || current.assistantReply || '');
      current.blocked = isEntryBlocked(entry) || current.blocked;
      current.predefined = isEntryPredefined(entry) || current.predefined;
      current.ruleId = getEntryRuleId(entry) || current.ruleId || null;

      turnsMap.set(turn, current);
    }

    const turns = [...turnsMap.values()]
      .filter((turn) => !hiddenKeys.has(getContextTurnDashboardKey(rawConversationId, turn.turn)))
      .map((turn) => ({
        ...turn,
        dashboard_key: getContextTurnDashboardKey(rawConversationId, turn.turn),
      }))
      .sort((a, b) => a.turn - b.turn);
    const summary = buildConversationContextSummary(turns);

    return res.json({
      conversationId: rawConversationId,
      uptoTurn: turnLimit,
      summary,
      notes: [
        'This is reconstructed from logged turn history for debugging.',
        'It does not represent long-term memory across unrelated conversations.',
      ],
      turns,
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || 'Unable to build conversation context snapshot.',
    });
  }
});


function firstDashboardString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function getDashboardNestedObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function humanizeDashboardKey(value, labelMap = {}) {
  const normalized = typeof value === 'string' && value.trim() ? value.trim() : 'unknown';
  if (labelMap[normalized]) return labelMap[normalized];

  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\bllc\b/gi, 'LLC')
    .replace(/\bsba\b/gi, 'SBA')
    .replace(/\bai\b/gi, 'AI')
    .replace(/\bvs\b/gi, 'Vs.')
    .replace(/\boklahoma\b/gi, 'Oklahoma')
    .replace(/\w\S*/g, (word) => (/^(LLC|SBA|AI|Vs\.|Oklahoma)$/i.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()));
}

function incrementDashboardCount(target, key) {
  if (!key) return;
  target[key] = (target[key] || 0) + 1;
}

function buildRankedDashboardCounts(counts, labelMap = {}) {
  return Object.entries(counts)
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .map(([key, count]) => ({ key, label: humanizeDashboardKey(key, labelMap), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildDashboardMetricExtremes(counts, labelMap = {}, limit = 5) {
  const ranked = buildRankedDashboardCounts(counts, labelMap);
  const least = [...ranked].sort((a, b) => a.count - b.count || a.label.localeCompare(b.label));

  return {
    most: ranked.slice(0, limit),
    least: least.slice(0, limit),
  };
}

function getDashboardMessageIntent(entry) {
  const classification = getDashboardNestedObject(entry?.classification);
  return firstDashboardString(
    classification.message_intent,
    classification.intent,
    entry?.message_intent,
    entry?.intent,
  );
}

function getDashboardResponseType(entry) {
  const routing = getDashboardNestedObject(entry?.routing);
  const explicit = firstDashboardString(routing.response_type, entry?.responseKind);
  if (explicit) return explicit;
  if (isEntryBlocked(entry)) return 'blocked';
  if (isEntryPredefined(entry)) return 'predefined';
  if (entry?.event === 'conversation_expired_response') return 'expired';
  if (entry?.event === 'model_call_degraded_response') return 'degraded';
  if (entry?.event === 'chat_error_response') return 'error';
  if (entry?.event === 'chat_response' || getEntryMessageText(entry, 'assistant')) return 'ai_generated';
  return null;
}

function buildClassificationSummary({ intentCounts, categoryCounts, responseTypeCounts }) {
  return {
    intents: buildDashboardMetricExtremes(intentCounts, CLASSIFICATION_LABELS),
    categories: buildDashboardMetricExtremes(categoryCounts, UNSURE_CATEGORY_LABELS),
    responseTypes: buildDashboardMetricExtremes(responseTypeCounts, RESPONSE_TYPE_LABELS),
  };
}

// Returns lightweight dashboard metrics to prioritize rule/prompt tuning work.
router.get('/dashboard/feedback-summary', (_req, res) => {
  if (readAiResponseLogLines().length === 0) {
    return res.json({
      totals: { feedbackEvents: 0, blockedEvents: 0, reviewEvents: 0, unsureResponses: 0 },
      feedbackByType: {},
      feedbackTotals: { up: 0, down: 0, happy: 0, neutral: 0, sad: 0 },
      blockedByRule: {},
      blockedReviewByStatus: {},
      unsureByCategory: {},
      classificationSummary: buildClassificationSummary({ intentCounts: {}, categoryCounts: {}, responseTypeCounts: {} }),
      feedbackDetails: [],
      unsureMessages: [],
    });
  }

  try {
    const lines = readAiResponseLogLines();
    const conversationTurnsById = buildConversationTurnMap(lines);
    const hiddenKeys = buildDashboardHiddenKeySet(lines);
    const feedbackByType = {};
    const feedbackTotals = { up: 0, down: 0, happy: 0, neutral: 0, sad: 0 };
    const blockedByRule = {};
    const blockedReviewByStatus = {};
    const unsureByCategory = {};
    const intentCounts = {};
    const categoryCounts = {};
    const responseTypeCounts = {};
    let feedbackEvents = 0;
    let blockedEvents = 0;
    let reviewEvents = 0;
    let unsureResponses = 0;
    const feedbackDetails = [];
    const unsureMessages = [];

    for (const line of lines) {
      const entry = parseJsonLogLine(line);
      if (!entry) continue;

      const dashboardMessageIntent = getDashboardMessageIntent(entry);
      const dashboardResponseType = getDashboardResponseType(entry);
      incrementDashboardCount(intentCounts, dashboardMessageIntent);
      incrementDashboardCount(responseTypeCounts, dashboardResponseType);
      if (entry.event === 'chat_feedback') {
        const feedbackEntry = getEntryFeedback(entry);
        const dashboardKey = getFeedbackDashboardKey(entry);
        if (hiddenKeys.has(dashboardKey)) continue;

        feedbackEvents += 1;
        const key = feedbackEntry.value || 'unknown';
        feedbackByType[key] = (feedbackByType[key] || 0) + 1;
        if (Object.prototype.hasOwnProperty.call(feedbackTotals, key)) {
          feedbackTotals[key] += 1;
        }

        if (feedbackDetails.length < 100) {
          const conversationId = getEntryConversationId(entry);
          const detail = {
            timestamp: entry.timestamp || null,
            scope: feedbackEntry.scope,
            feedback: key,
            conversation_id: conversationId,
            turn: Number.isFinite(entry.turn) ? entry.turn : null,
            comment: feedbackEntry.comment ? redactSensitiveText(feedbackEntry.comment) : null,
            dashboard_key: dashboardKey,
          };

          if (detail.scope === 'response' && conversationId && detail.turn) {
            const turn = conversationTurnsById.get(conversationId)?.get(detail.turn);
            detail.user_message = turn?.userMessage || '';
            detail.assistant_reply = turn?.assistantReply || '';
          }

          if (detail.scope === 'session' && ['happy', 'neutral', 'sad'].includes(key) && conversationId) {
            detail.conversation = getOrderedConversationMessages(conversationTurnsById.get(conversationId));
          }

          feedbackDetails.push(detail);
        }
      }

      if (isEntryBlocked(entry)) {
        if (hiddenKeys.has(getBlockedDashboardKey(entry))) continue;

        blockedEvents += 1;
        const rule = getEntryRuleId(entry) || 'unknown';
        blockedByRule[rule] = (blockedByRule[rule] || 0) + 1;
      }

      if (entry.event === 'blocked_response_review') {
        reviewEvents += 1;
        const status = typeof entry.review?.status === 'string' && entry.review.status.trim()
          ? entry.review.status.trim()
          : (typeof entry.reviewStatus === 'string' && entry.reviewStatus.trim() ? entry.reviewStatus.trim() : 'unknown');
        blockedReviewByStatus[status] = (blockedReviewByStatus[status] || 0) + 1;
      }

      if (isEntryUnsureResponse(entry)) {
        const dashboardKey = getUnsureDashboardKey(entry);
        if (hiddenKeys.has(dashboardKey)) continue;

        unsureResponses += 1;
        const unsureCategory = getEntryUnsureCategory(entry) || 'uncategorized';
        unsureByCategory[unsureCategory] = (unsureByCategory[unsureCategory] || 0) + 1;
        incrementDashboardCount(categoryCounts, unsureCategory);
        if (unsureMessages.length < 100) {
          unsureMessages.push({
            timestamp: entry.timestamp || null,
            conversation_id: getEntryConversationId(entry),
            turn: Number.isFinite(entry.turn) ? entry.turn : null,
            user_message: redactSensitiveText(getEntryMessageText(entry, 'user')),
            assistant_reply: redactSensitiveText(getEntryMessageText(entry, 'assistant')),
            confidence_level: getEntryConfidenceScore(entry),
            confidence_reason: getEntryConfidenceReason(entry),
            unsure_category: unsureCategory,
            event: entry.event || null,
            dashboard_key: dashboardKey,
          });
        }
      }
    }

    return res.json({
      totals: { feedbackEvents, blockedEvents, reviewEvents, unsureResponses },
      feedbackByType,
      feedbackTotals,
      feedbackDetails,
      blockedByRule,
      blockedReviewByStatus,
      unsureByCategory,
      classificationSummary: buildClassificationSummary({ intentCounts, categoryCounts, responseTypeCounts }),
      unsureMessages,
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Unable to build feedback summary.' });
  }
});

// ─── Temporary bans ───────────────────────────────────────────────────────────

// Returns currently active temporary bans for admin review.
router.get('/dashboard/temp-bans', workTracker.trackHandler(async (_req, res) => {
  const bans = (await getBans()).map((entry) => ({
    banKey:        entry.banKey,
    sourceIp:      entry.sourceIp,
    createdAt:     new Date(entry.createdAt).toISOString(),
    expiresAt:     new Date(entry.expiresAt).toISOString(),
    conversationId: entry.conversationId || null,
    turn:          Number.isFinite(entry.turn) ? entry.turn : null,
    blockedByRule: entry.blockedByRule || null,
  }));

  return res.json({ bans });
}));

// Removes one temporary ban by key.
router.post('/dashboard/temp-bans/unban', workTracker.trackHandler(async (req, res) => {
  const banKey = typeof req.body?.banKey === 'string' ? req.body.banKey.trim() : '';

  if (!banKey) {
    return res.status(400).json({ error: 'banKey is required.' });
  }

  const removed = await deleteBan(banKey);

  appendAiResponseLog({
    timestamp: new Date().toISOString(),
    event:     'temp_ban_unban',
    banKey,
    removed,
  });

  return res.json({ removed });
}));

// Clears all temporary bans.
router.post('/dashboard/temp-bans/clear', workTracker.trackHandler(async (_req, res) => {
  const clearedCount = await clearAllBans();

  appendAiResponseLog({
    timestamp: new Date().toISOString(),
    event:     'temp_ban_clear_all',
    clearedCount,
  });

  return res.json({ clearedCount });
}));

// ─── Temporary ban exemptions ─────────────────────────────────────────────────
//
// Grants the calling client's own ban identity (IP + user-agent fingerprint,
// the same one ban enforcement keys on) a short-lived immunity from ban
// escalation, and clears any existing ban for that identity. Intended for a
// known QA/load-test client hitting staging or production directly, so a
// burst of requests doesn't trip the temp-ban system, without needing to
// disable ban enforcement globally for every other client.

// Grants the exemption. Call this from the machine that will run the burst
// or load test, authenticated as a dashboard operator.
router.post('/dashboard/temp-bans/exempt', workTracker.trackHandler(async (req, res) => {
  const requestedDurationMs = Number(req.body?.durationMs);
  const exemption = await grantBanExemption(
    req,
    Number.isFinite(requestedDurationMs) && requestedDurationMs > 0 ? requestedDurationMs : undefined,
  );

  appendAiResponseLog({
    timestamp:  new Date().toISOString(),
    event:      'temp_ban_exemption_granted',
    banKey:     exemption.banKey,
    source_ip:  exemption.sourceIp,
    expires_at: new Date(exemption.expiresAt).toISOString(),
    granted_by: req.dashboardUser?.username || null,
  });

  return res.json({
    banKey:    exemption.banKey,
    sourceIp:  exemption.sourceIp,
    expiresAt: new Date(exemption.expiresAt).toISOString(),
  });
}));

router.get('/dashboard/temp-bans/exemptions', workTracker.trackHandler(async (_req, res) => {
  const exemptions = (await listBanExemptions()).map((entry) => ({
    banKey:    entry.banKey,
    expiresAt: new Date(entry.expiresAt).toISOString(),
  }));

  return res.json({ exemptions });
}));

router.post('/dashboard/temp-bans/exempt/revoke', workTracker.trackHandler(async (req, res) => {
  const banKey = typeof req.body?.banKey === 'string' ? req.body.banKey.trim() : '';

  if (!banKey) {
    return res.status(400).json({ error: 'banKey is required.' });
  }

  const revoked = await revokeBanExemption(banKey);

  appendAiResponseLog({
    timestamp: new Date().toISOString(),
    event:     'temp_ban_exemption_revoked',
    banKey,
    revoked,
  });

  return res.json({ revoked });
}));

// ─── Embedded page usage ──────────────────────────────────────────────────────

// Returns which pages the chatbot has been used from (via page_url in log
// entries), aggregated by unique conversation count and total message count,
// sorted most-used first.
router.get('/dashboard/page-usage', requireAuth, (_req, res) => {
  try {
    const lines = readAiResponseLogLines();
    // Track unique conversations per page and total message turns.
    const pageMap = new Map(); // url → { conversations: Set<conversationId>, messages: number }

    for (const line of lines) {
      const entry = parseJsonLogLine(line);
      if (!entry || typeof entry.page_url !== 'string') continue;

      const url = entry.page_url.trim();
      if (!url) continue;

      const conversationId = entry.conversation_id || null;

      if (!pageMap.has(url)) {
        pageMap.set(url, { conversations: new Set(), messages: 0 });
      }

      const record = pageMap.get(url);
      if (conversationId) record.conversations.add(conversationId);

      // Count only user-facing turns to avoid inflating with internal events.
      const countableEvents = new Set(['chat_turn_received', undefined, null]);
      if (countableEvents.has(entry.event)) {
        record.messages += 1;
      }
    }

    const pages = Array.from(pageMap.entries())
      .map(([url, record]) => ({
        url,
        conversations: record.conversations.size,
        messages: record.messages,
      }))
      .sort((a, b) => b.conversations - a.conversations || b.messages - a.messages);

    return res.json({ pages });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Unable to build page usage summary.' });
  }
});

router.get('/dashboard/audit-log', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.dashboardUser.role !== 'admin' || !req.dashboardUser.sub) {
    return res.status(403).json({ error: 'Only administrators can view the dashboard audit log.' });
  }
  const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
  const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
  const query = req.query.q === undefined ? '' : req.query.q;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 ||
    typeof query !== 'string' || query.length > 200) {
    return res.status(400).json({ error: 'Use a limit of 1–100, a nonnegative offset, and a search of at most 200 characters.' });
  }
  try {
    const search = query.trim().toLowerCase();
    let ruleNames = new Map();
    try { ruleNames = new Map(loadRuleStore().rules.map(rule => [rule.id, rule.displayName])); } catch { /* Audit history remains available if rules cannot be loaded. */ }
    const items = readDashboardAuditLogLines()
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
      .map(entry => entry.target?.type === 'message_filter_rule' ? {
        ...entry, target: { ...entry.target, displayName: ruleNames.get(entry.target.id) || entry.target.displayName || entry.target.id },
      } : entry)
      .reverse()
      .filter((entry) => !search || [entry.action, entry.actor?.username, entry.actor?.subject, entry.target?.type, entry.target?.id, entry.target?.displayName, entry.details?.username]
        .some((value) => typeof value === 'string' && value.toLowerCase().includes(search)));
    return res.json({ items: items.slice(offset, offset + limit), total: items.length, limit, offset });
  } catch {
    return res.status(500).json({ error: 'Unable to load the dashboard audit log.' });
  }
});

module.exports = router;
