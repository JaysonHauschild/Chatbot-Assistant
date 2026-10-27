/**
 * Chat-specific log and conversation helpers.
 *
 * Generic redaction, URL validation, flag parsing, and JSON parsing live in
 * server-kit and are re-exported here for backward compatibility.
 */

'use strict';

const {
  isExactFlagEnabled,
  parseJsonLine,
  redactSensitiveText,
  sanitizeHttpUrl,
} = require('server-kit');

const BLOCKED_REVIEW_STATUSES = new Set([
  'correct_block',
  'false_positive',
  'needs_new_rule',
  'needs_response_update',
]);

const RESPONSE_FEEDBACK_VALUES = new Set(['up', 'down']);
const SESSION_FEEDBACK_VALUES = new Set([
  'happy',
  'neutral',
  'sad',
  'written',
]);

function sanitizeConversationId(rawConversationId) {
  if (typeof rawConversationId !== 'string') return null;
  const trimmed = rawConversationId.trim();
  if (!trimmed || trimmed.length > 120) return null;
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, '_');
}

const sanitizePageUrl = sanitizeHttpUrl;
const parseJsonLogLine = parseJsonLine;

function isTestModeEnabled(rawTestMode) {
  return isExactFlagEnabled(rawTestMode);
}

function getNestedObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function getEntryMessageText(entry, role) {
  if (!entry || typeof entry !== 'object') return '';
  const message = getNestedObject(entry.message);

  if (role === 'assistant') {
    return (
      firstNonEmptyString(
        message.assistant_redacted,
        message.assistant,
        entry.bot_reply_redacted,
        entry.reply,
        entry.botReply,
        entry.bot_reply,
      ) || ''
    );
  }

  return (
    firstNonEmptyString(
      message.user_redacted,
      message.user,
      entry.user_message_redacted,
      entry.message_redacted,
      typeof entry.message === 'string' ? entry.message : null,
      entry.userMessage,
      entry.user_message,
    ) || ''
  );
}

function getEntryRouting(entry) {
  return getNestedObject(entry?.routing);
}

function isEntryBlocked(entry) {
  return (
    entry?.blocked === true ||
    getEntryRouting(entry).blocked === true ||
    entry?.event === 'chat_response_blocked'
  );
}

function isEntryPredefined(entry) {
  return (
    entry?.predefined_response === true ||
    getEntryRouting(entry).predefined === true ||
    entry?.event === 'chat_response_predefined'
  );
}

function getEntryRuleId(entry) {
  const routing = getEntryRouting(entry);
  return firstNonEmptyString(
    routing.rule_id,
    entry?.blockedByRule,
    entry?.predefinedByRule,
  );
}

function getEntryClassification(entry) {
  return getNestedObject(entry?.classification);
}

function isEntryUnsureResponse(entry) {
  return (
    entry?.unsure_response === true ||
    getEntryClassification(entry).unsure_response === true
  );
}

function getEntryUnsureCategory(entry) {
  const classification = getEntryClassification(entry);
  return firstNonEmptyString(
    classification.unsure_category,
    entry?.unsure_category,
  );
}

function getEntryConfidenceScore(entry) {
  const classification = getEntryClassification(entry);
  if (Number.isFinite(classification.confidence_score)) {
    return classification.confidence_score;
  }
  if (Number.isFinite(entry?.confidence_score)) {
    return entry.confidence_score;
  }
  if (Number.isFinite(entry?.confidence_level)) {
    return entry.confidence_level;
  }
  return null;
}

function getEntryConfidenceReason(entry) {
  const classification = getEntryClassification(entry);
  return firstNonEmptyString(
    classification.confidence_reason,
    entry?.confidence_reason,
  );
}

function getEntryFeedback(entry) {
  const feedback = getNestedObject(entry?.feedback);
  const value =
    typeof entry?.feedback === 'string'
      ? entry.feedback
      : feedback.value;

  return {
    scope: firstNonEmptyString(feedback.scope, entry?.scope),
    value: firstNonEmptyString(value),
    comment: firstNonEmptyString(
      feedback.comment_redacted,
      feedback.comment,
      entry?.comment,
    ),
    assistantIndex: Number.isFinite(feedback.assistant_index)
      ? feedback.assistant_index
      : Number.isFinite(entry?.assistantIndex)
        ? entry.assistantIndex
        : null,
  };
}

function getEntryConversationId(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const value = entry.conversationId || entry.conversation_id;
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : null;
}

function getConversationTurnKey(conversationId, turn) {
  if (!conversationId || !Number.isFinite(turn)) return null;
  return `${conversationId}::${turn}`;
}

function buildBlockedReviewMap(lines) {
  const reviewMap = new Map();

  for (const line of lines) {
    const entry = parseJsonLogLine(line);
    if (!entry || entry.event !== 'blocked_response_review') continue;

    const conversationId = getEntryConversationId(entry);
    const turn = Number.isFinite(entry.turn) ? entry.turn : null;
    const key = getConversationTurnKey(conversationId, turn);
    const reviewStatus = firstNonEmptyString(
      entry.review?.status,
      entry.reviewStatus,
    );

    if (!key || !BLOCKED_REVIEW_STATUSES.has(reviewStatus)) continue;
    reviewMap.set(key, {
      status: reviewStatus,
      timestamp: entry.timestamp || null,
    });
  }

  return reviewMap;
}

module.exports = {
  BLOCKED_REVIEW_STATUSES,
  RESPONSE_FEEDBACK_VALUES,
  SESSION_FEEDBACK_VALUES,
  buildBlockedReviewMap,
  getConversationTurnKey,
  getEntryClassification,
  getEntryConfidenceReason,
  getEntryConfidenceScore,
  getEntryConversationId,
  getEntryFeedback,
  getEntryMessageText,
  getEntryRuleId,
  getEntryRouting,
  getEntryUnsureCategory,
  isEntryBlocked,
  isEntryPredefined,
  isEntryUnsureResponse,
  isTestModeEnabled,
  parseJsonLogLine,
  redactSensitiveText,
  sanitizeConversationId,
  sanitizePageUrl,
};
