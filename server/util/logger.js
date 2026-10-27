/**
 * util/logger.js — JSONL audit-log helpers.
 *
 * All chat interactions, errors, and admin events are written here as
 * newline-delimited JSON so they can be streamed or tailed without parsing
 * a full JSON array.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  appendJsonLine,
  getDailyLogPath,
  listDailyLogPaths,
  readDailyJsonLines,
} = require('server-kit');
const {
  aiResponseLogPath,
  humanReadableLogPath,
  conversationStatusLogPath,
} = require('../lib/state');
const { redactSensitiveText } = require('./helpers');


const { getLiveChatTestContext } = require('../lib/live-chat-test');

const LOG_SCHEMA_VERSION = 2;

const NORMALIZED_TOP_LEVEL_KEYS = new Set([
  'schema_version', 'timestamp', 'event', 'conversation_id', 'turn', 'trace_id',
  'is_test', 'page_url', 'message', 'routing', 'classification', 'model', 'rag',
  'feedback', 'review', 'status', 'error', 'details',
]);

const LEGACY_FIELDS_TO_NORMALIZE = new Set([
  'timestamp', 'event', 'conversation_id', 'conversationId', 'turn', 'trace_id',
  'is_test', 'test_mode', 'page_url', 'user_message_redacted', 'message_redacted',
  'message', 'userMessage', 'user_message', 'bot_reply_redacted', 'reply',
  'botReply', 'bot_reply', 'predefined_response', 'blocked', 'blockedByRule',
  'predefinedByRule', 'llm_fallback', 'responseKind', 'message_intent',
  'user_intent', 'intent', 'confidence_score', 'confidence_level',
  'confidence_reason', 'unsure_category', 'unsure_response', 'was_referred',
  'allowed_links_used', 'model', 'primary_model', 'secondary_model',
  'finish_reason', 'token_total', 'fallbackAttempted', 'rag_ready',
  'rag_last_init_error', 'statusCode', 'status', 'apiResponse', 'error',
  'error_primary', 'error_secondary', 'scope', 'feedback', 'comment',
  'commentLength', 'assistantIndex', 'conversationTurnKey', 'reviewStatus',
]);

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function normalizeMaybeRedactedText(value, options) {
  return typeof value === 'string' && value.trim()
    ? redactSensitiveText(value, options)
    : null;
}

function inferLogEvent(entry) {
  if (typeof entry.event === 'string' && entry.event.trim()) return entry.event.trim();
  if (entry.blocked === true) return 'chat_response_blocked';
  if (entry.predefined_response === true) return 'chat_response_predefined';
  if (entry.bot_reply_redacted || entry.reply || entry.botReply || entry.bot_reply) return 'chat_response';
  return 'log_event';
}

function buildMessageLog(entry) {
  const nested = entry.message && typeof entry.message === 'object' ? entry.message : {};
  const user = normalizeMaybeRedactedText(firstString(
    nested.user_redacted,
    nested.user,
    entry.user_message_redacted,
    entry.message_redacted,
    typeof entry.message === 'string' ? entry.message : null,
    entry.userMessage,
    entry.user_message,
  ));
  const assistant = normalizeMaybeRedactedText(firstString(
    nested.assistant_redacted,
    nested.assistant,
    entry.bot_reply_redacted,
    entry.reply,
    entry.botReply,
    entry.bot_reply,
  ), { maxLength: null });

  return user || assistant
    ? {
        ...(user ? { user_redacted: user } : {}),
        ...(assistant ? { assistant_redacted: assistant } : {}),
      }
    : null;
}

function buildRoutingLog(entry, event) {
  const routing = entry.routing && typeof entry.routing === 'object' ? { ...entry.routing } : {};
  const blocked = entry.blocked === true || routing.blocked === true || event === 'chat_response_blocked';
  const predefined = entry.predefined_response === true || routing.predefined === true || event === 'chat_response_predefined';
  const ruleId = firstString(routing.rule_id, entry.blockedByRule, entry.predefinedByRule);
  const responseType = firstString(routing.response_type, entry.responseKind)
    || (blocked ? 'blocked' : predefined ? 'predefined' : event === 'model_call_degraded_response' ? 'degraded' : null);

  const hasRoutingDetails = Object.keys(routing).length > 0 || responseType || ruleId || blocked || predefined || typeof entry.llm_fallback === 'boolean';
  if (!hasRoutingDetails) return null;

  return {
    ...routing,
    ...(responseType ? { response_type: responseType } : {}),
    blocked,
    predefined,
    ...(ruleId ? { rule_id: ruleId } : {}),
    ...(typeof entry.llm_fallback === 'boolean' ? { llm_fallback: entry.llm_fallback } : {}),
  };
}

function buildClassificationLog(entry) {
  const classification = entry.classification && typeof entry.classification === 'object'
    ? { ...entry.classification }
    : {};

  const confidenceScore = firstFiniteNumber(entry.confidence_score, entry.confidence_level, classification.confidence_score);
  return {
    ...(firstString(classification.message_intent, entry.message_intent) ? { message_intent: firstString(classification.message_intent, entry.message_intent) } : {}),
    ...(firstString(classification.user_intent, entry.user_intent) ? { user_intent: firstString(classification.user_intent, entry.user_intent) } : {}),
    ...(firstString(classification.intent, entry.intent) ? { intent: firstString(classification.intent, entry.intent) } : {}),
    ...(confidenceScore !== null ? { confidence_score: confidenceScore } : {}),
    ...(firstString(classification.confidence_reason, entry.confidence_reason) ? { confidence_reason: firstString(classification.confidence_reason, entry.confidence_reason) } : {}),
    ...(firstString(classification.unsure_category, entry.unsure_category) ? { unsure_category: firstString(classification.unsure_category, entry.unsure_category) } : {}),
    ...(typeof entry.unsure_response === 'boolean' ? { unsure_response: entry.unsure_response } : {}),
    ...(typeof entry.was_referred === 'boolean' ? { was_referred: entry.was_referred } : {}),
    ...(Array.isArray(entry.allowed_links_used) ? { allowed_links_used: entry.allowed_links_used } : {}),
  };
}

function buildModelLog(entry) {
  const model = entry.model && typeof entry.model === 'object' ? { ...entry.model } : {};
  const name = typeof entry.model === 'string' ? entry.model : model.name;
  const result = {
    ...(firstString(name) ? { name: firstString(name) } : {}),
    ...(firstString(model.primary, entry.primary_model) ? { primary: firstString(model.primary, entry.primary_model) } : {}),
    ...(firstString(model.secondary, entry.secondary_model) ? { secondary: firstString(model.secondary, entry.secondary_model) } : {}),
    ...(firstString(model.finish_reason, entry.finish_reason) ? { finish_reason: firstString(model.finish_reason, entry.finish_reason) } : {}),
    ...(firstFiniteNumber(model.token_total, entry.token_total) !== null ? { token_total: firstFiniteNumber(model.token_total, entry.token_total) } : {}),
    ...(typeof entry.fallbackAttempted === 'boolean' ? { fallback_attempted: entry.fallbackAttempted } : {}),
  };
  return Object.keys(result).length > 0 ? result : null;
}

function buildRagLog(entry) {
  const rag = entry.rag && typeof entry.rag === 'object' ? { ...entry.rag } : {};
  const result = {
    ...rag,
    ...(typeof entry.rag_ready === 'boolean' ? { ready: entry.rag_ready } : {}),
    ...(firstString(entry.rag_last_init_error) ? { last_init_error: firstString(entry.rag_last_init_error) } : {}),
  };
  return Object.keys(result).length > 0 ? result : null;
}

function buildFeedbackLog(entry) {
  const feedback = entry.feedback && typeof entry.feedback === 'object' ? { ...entry.feedback } : {};
  const value = typeof entry.feedback === 'string' ? entry.feedback : feedback.value;
  const result = {
    ...(firstString(feedback.scope, entry.scope) ? { scope: firstString(feedback.scope, entry.scope) } : {}),
    ...(firstString(value) ? { value: firstString(value) } : {}),
    ...(normalizeMaybeRedactedText(feedback.comment_redacted || entry.comment) ? { comment_redacted: normalizeMaybeRedactedText(feedback.comment_redacted || entry.comment) } : {}),
    ...(firstFiniteNumber(feedback.comment_length, entry.commentLength) !== null ? { comment_length: firstFiniteNumber(feedback.comment_length, entry.commentLength) } : {}),
    ...(firstFiniteNumber(feedback.assistant_index, entry.assistantIndex) !== null ? { assistant_index: firstFiniteNumber(feedback.assistant_index, entry.assistantIndex) } : {}),
    ...(firstString(feedback.conversation_turn_key, entry.conversationTurnKey) ? { conversation_turn_key: firstString(feedback.conversation_turn_key, entry.conversationTurnKey) } : {}),
  };
  return Object.keys(result).length > 0 ? result : null;
}

function buildStatusLog(entry) {
  const status = entry.status && typeof entry.status === 'object' ? { ...entry.status } : {};
  const httpStatus = firstFiniteNumber(status.http_status_code, entry.statusCode, entry.status);
  const result = {
    ...status,
    ...(httpStatus !== null ? { http_status_code: httpStatus } : {}),
    ...(entry.apiResponse ? { api_response: entry.apiResponse } : {}),
  };
  return Object.keys(result).length > 0 ? result : null;
}

function buildErrorLog(entry) {
  const result = {
    ...(entry.error ? { current: entry.error } : {}),
    ...(entry.error_primary ? { primary: entry.error_primary } : {}),
    ...(entry.error_secondary ? { secondary: entry.error_secondary } : {}),
  };
  return Object.keys(result).length > 0 ? result : null;
}

function buildDetailsLog(entry) {
  const details = entry.details && typeof entry.details === 'object' ? { ...entry.details } : {};

  for (const [key, value] of Object.entries(entry)) {
    if (NORMALIZED_TOP_LEVEL_KEYS.has(key) || LEGACY_FIELDS_TO_NORMALIZE.has(key)) continue;
    details[key] = value;
  }

  return Object.keys(details).length > 0 ? details : null;
}

function normalizeAiResponseLogEntry(entry = {}) {
  if (entry.schema_version === LOG_SCHEMA_VERSION) return entry;

  const event = inferLogEvent(entry);
  const classification = buildClassificationLog(entry);
  const normalized = {
    schema_version: LOG_SCHEMA_VERSION,
    timestamp: firstString(entry.timestamp) || new Date().toISOString(),
    event,
    conversation_id: firstString(entry.conversation_id, entry.conversationId),
    turn: Number.isFinite(entry.turn) ? entry.turn : null,
    ...(firstString(entry.trace_id) ? { trace_id: firstString(entry.trace_id) } : {}),
    ...(entry.is_test || entry.test_mode ? { is_test: true } : {}),
    ...(firstString(entry.page_url) ? { page_url: firstString(entry.page_url) } : {}),
  };

  const message = buildMessageLog(entry);
  const routing = buildRoutingLog(entry, event);
  const model = buildModelLog(entry);
  const rag = buildRagLog(entry);
  const feedback = buildFeedbackLog(entry);
  const status = buildStatusLog(entry);
  const error = buildErrorLog(entry);
  const details = buildDetailsLog(entry);

  if (message) normalized.message = message;
  if (routing) normalized.routing = routing;
  if (Object.keys(classification).length > 0) normalized.classification = classification;
  if (model) normalized.model = model;
  if (rag) normalized.rag = rag;
  if (feedback) normalized.feedback = feedback;
  if (firstString(entry.reviewStatus)) normalized.review = { status: firstString(entry.reviewStatus) };
  if (status) normalized.status = status;
  if (error) normalized.error = error;
  if (details) normalized.details = details;

  return normalized;
}

function getDailyAiResponseLogPath(date = new Date()) {
  return getDailyLogPath(aiResponseLogPath, date);
}

function getDailyHumanReadableLogPath(date = new Date()) {
  return getDailyLogPath(humanReadableLogPath, date, '.md');
}

function getDailyConversationStatusLogPath(date = new Date()) {
  return getDailyLogPath(conversationStatusLogPath, date);
}

function listAiResponseLogPaths() {
  return listDailyLogPaths(aiResponseLogPath);
}

function readAiResponseLogLines() {
  return readDailyJsonLines(aiResponseLogPath);
}

/**
 * Appends a single structured entry to the JSONL audit log.
 * Logging failures are non-fatal — the server continues even if the log
 * directory is not writable.
 *
 * @param {object} entry
 */
function appendJsonlLog(logPath, entry, errorLabel) {
  return appendJsonLine(logPath, entry, {
    onError: (logError) => console.error(errorLabel, logError),
  });
}

function humanizeLogLabel(value) {
  const label = String(value || 'log event')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : 'Log event';
}

function formatReadableTimestamp(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value || 'Unknown time');

  return parsed.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}

function formatMarkdownInlineCode(value) {
  const safeValue = String(value ?? '')
    .replace(/`/g, '\u00b4')
    .replace(/\r?\n/g, ' ')
    .trim();
  return safeValue ? `\`${safeValue}\`` : '\u2014';
}

function formatMarkdownBlockquote(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function formatReadableMetadataValue(value) {
  if (value === null || value === undefined || value === '') return '\u2014';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return formatMarkdownInlineCode(value);
  if (typeof value === 'string') return formatMarkdownInlineCode(value);
  if (Array.isArray(value) && value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
    return value.length > 0 ? formatMarkdownInlineCode(value.join(', ')) : '\u2014';
  }
  return null;
}

function appendReadableMetadataSection(lines, title, metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return;
  const entries = Object.entries(metadata);
  if (entries.length === 0) return;

  lines.push('', `### ${title}`, '');
  for (const [key, value] of entries) {
    const readableValue = formatReadableMetadataValue(value);
    if (readableValue !== null) {
      lines.push(`- **${humanizeLogLabel(key)}:** ${readableValue}`);
      continue;
    }

    lines.push(`- **${humanizeLogLabel(key)}:**`);
    const serialized = JSON.stringify(value, null, 2) || String(value);
    lines.push('', ...serialized.split('\n').map((line) => `    ${line}`), '');
  }
}

function renderHumanReadableLogEntry(entry) {
  const event = firstString(entry?.event) || 'log_event';
  const lines = [
    '',
    '---',
    '',
    `## ${humanizeLogLabel(event)}`,
    '',
    `- **Time:** ${formatMarkdownInlineCode(formatReadableTimestamp(entry?.timestamp))}`,
    `- **Event:** ${formatMarkdownInlineCode(event)}`,
  ];

  if (entry?.conversation_id) {
    lines.push(`- **Conversation:** ${formatMarkdownInlineCode(entry.conversation_id)}`);
  }
  if (Number.isFinite(entry?.turn)) {
    lines.push(`- **Turn:** ${formatMarkdownInlineCode(entry.turn)}`);
  }
  if (entry?.trace_id) {
    lines.push(`- **Trace:** ${formatMarkdownInlineCode(entry.trace_id)}`);
  }
  if (entry?.page_url) {
    lines.push(`- **Page:** ${formatMarkdownInlineCode(entry.page_url)}`);
  }
  if (entry?.is_test === true) {
    lines.push('- **Test traffic:** Yes');
  }

  const message = entry?.message && typeof entry.message === 'object' ? entry.message : {};
  if (typeof message.user_redacted === 'string' && message.user_redacted.trim()) {
    lines.push('', '### User', '', formatMarkdownBlockquote(message.user_redacted));
  }
  if (typeof message.assistant_redacted === 'string' && message.assistant_redacted.trim()) {
    lines.push('', '### Assistant', '', formatMarkdownBlockquote(message.assistant_redacted));
  }

  appendReadableMetadataSection(lines, 'Routing', entry?.routing);
  appendReadableMetadataSection(lines, 'Classification', entry?.classification);
  appendReadableMetadataSection(lines, 'Model', entry?.model);
  appendReadableMetadataSection(lines, 'Retrieval', entry?.rag);
  appendReadableMetadataSection(lines, 'Feedback', entry?.feedback);
  appendReadableMetadataSection(lines, 'Review', entry?.review);
  appendReadableMetadataSection(lines, 'Status', entry?.status);
  appendReadableMetadataSection(lines, 'Error', entry?.error);
  appendReadableMetadataSection(lines, 'Additional details', entry?.details);

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function buildHumanReadableLogHeader(date = new Date()) {
  return [
    `# Chat Audit Log \u2014 ${date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })}`,
    '',
    '> Human-readable companion to the canonical JSONL audit log. Message content uses the same redacted values as the JSONL record.',
    '',
  ].join('\n');
}

function appendHumanReadableLog(logPath, entry, date = new Date()) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const needsHeader = !fs.existsSync(logPath) || fs.statSync(logPath).size === 0;
    const content = `${needsHeader ? buildHumanReadableLogHeader(date) : ''}${renderHumanReadableLogEntry(entry)}`;
    fs.appendFileSync(logPath, content, 'utf8');
  } catch (logError) {
    console.error('Unable to write human-readable AI response log:', logError);
  }
}

function appendAiResponseLog(entry) {
  if (getLiveChatTestContext()) {
    // Test diagnostics deliberately omit messages, upstream payloads and stacks.
    if (/error|fail|degraded|rate_limit|ban/.test(entry.event || '')) {
      appendJsonlLog(getDailyAiResponseLogPath(), {
        schema_version: LOG_SCHEMA_VERSION,
        timestamp: new Date().toISOString(),
        event: 'live_chat_test_failure',
        is_test: true,
        details: { source_event: entry.event, trace_id: entry.trace_id || null, duration_ms: Date.now() - getLiveChatTestContext().startedAt },
      }, 'Unable to write live test diagnostic:');
    }
    return;
  }
  const logDate = new Date();
  const normalizedEntry = normalizeAiResponseLogEntry(entry);
  const jsonlWritten = appendJsonlLog(
    getDailyAiResponseLogPath(logDate),
    normalizedEntry,
    'Unable to write AI response log:',
  );

  if (jsonlWritten) {
    appendHumanReadableLog(
      getDailyHumanReadableLogPath(logDate),
      normalizedEntry,
      logDate,
    );
  }
}

function normalizeConversationStatusLogEntry(entry = {}) {
  return {
    schema_version: 1,
    timestamp: firstString(entry.timestamp) || new Date().toISOString(),
    event: firstString(entry.event) || 'conversation_status',
    conversation_id: firstString(entry.conversation_id, entry.conversationId),
    active: entry.active === true,
    reason: firstString(entry.reason) || null,
    last_message_at: firstString(entry.last_message_at, entry.lastMessageAt),
    invalidated_at: firstString(entry.invalidated_at, entry.invalidatedAt),
    turn: Number.isFinite(entry.turn) ? entry.turn : null,
    source: firstString(entry.source) || null,
    details: entry.details && typeof entry.details === 'object' ? entry.details : null,
  };
}

function appendConversationStatusLog(entry) {
  if (getLiveChatTestContext() || String(entry.conversation_id || '').startsWith('live-test-')) return;
  appendJsonlLog(
    getDailyConversationStatusLogPath(),
    normalizeConversationStatusLogEntry(entry),
    'Unable to write conversation status log:',
  );
}

/**
 * Extracts a safe, serialisable subset of an Error for log entries.
 *
 * @param {unknown} error
 * @returns {{ name: string|null, message: string|null, status: number|null, stack: string|null }}
 */
function extractErrorDetails(error) {
  return {
    name:    error?.name    || null,
    message: error?.message || null,
    status:  error?.status  || error?.statusCode || error?.response?.status || null,
    stack:   error?.stack   || null,
  };
}

/**
 * Logs a chat error and sends an HTTP error response in a single call.
 *
 * @param {import('express').Response} res
 * @param {number} statusCode
 * @param {object} payload
 * @param {object} logEntry
 * @returns {import('express').Response}
 */
function sendLoggedChatError(res, statusCode, payload, logEntry) {
  appendAiResponseLog({
    timestamp:   new Date().toISOString(),
    event:       'chat_error_response',
    status: { http_status_code: statusCode, api_response: payload },
    ...logEntry,
  });
  return res.status(statusCode).json(payload);
}

function getDashboardAuditLogPath() {
  return process.env.DASHBOARD_AUDIT_LOG_PATH
    || path.join(path.dirname(aiResponseLogPath), 'dashboard-audit.jsonl');
}

function appendDashboardAuditLog(entry) {
  appendJsonlLog(getDashboardAuditLogPath(), entry, 'Unable to write dashboard audit log:');
}

function readDashboardAuditLogLines() {
  const logPath = getDashboardAuditLogPath();
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8').split('\n');
}

module.exports = {
  appendAiResponseLog,
  normalizeAiResponseLogEntry,
  extractErrorDetails,
  appendConversationStatusLog,
  getDailyAiResponseLogPath,
  getDailyHumanReadableLogPath,
  getDailyConversationStatusLogPath,
  listAiResponseLogPaths,
  readAiResponseLogLines,
  appendDashboardAuditLog,
  readDashboardAuditLogLines,
  sendLoggedChatError,
};
