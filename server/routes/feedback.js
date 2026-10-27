/**
 * routes/feedback.js — User feedback endpoint.
 *
 * POST /chatbot/api/feedback  — Records thumbs-up/down or session-end emoji/written feedback.
 */

'use strict';

const express = require('express');

const { appendAiResponseLog }                               = require('../util/logger');
const { sanitizeConversationId, redactSensitiveText,
        isTestModeEnabled, RESPONSE_FEEDBACK_VALUES,
        SESSION_FEEDBACK_VALUES }                           = require('../util/helpers');

const router = express.Router();

// Captures user feedback events for analytics and quality review.
// For response feedback, conversationId + turn uniquely identify the rated reply.
router.post('/', (req, res) => {
  const conversationId = sanitizeConversationId(req.body?.conversationId);
  const scope     = typeof req.body?.scope     === 'string' ? req.body.scope.trim()     : '';
  const feedback  = typeof req.body?.feedback  === 'string' ? req.body.feedback.trim()  : '';
  const rawComment = typeof req.body?.comment  === 'string' ? req.body.comment          : '';
  const comment   = rawComment.trim();
  const rawTurn   = Number.parseInt(String(req.body?.turn || ''), 10);
  const turn      = Number.isFinite(rawTurn) && rawTurn > 0 ? rawTurn : null;
  const rawAssistantIndex = Number.parseInt(String(req.body?.assistantIndex || ''), 10);
  const assistantIndex    = Number.isFinite(rawAssistantIndex) && rawAssistantIndex >= 0
    ? rawAssistantIndex
    : null;
  const testMode = isTestModeEnabled(req.query?.test_mode);

  if (!conversationId) {
    return res.status(400).json({ error: 'conversationId is required.' });
  }

  if (scope === 'response') {
    if (!RESPONSE_FEEDBACK_VALUES.has(feedback)) {
      return res.status(400).json({ error: 'feedback is invalid for response scope.' });
    }
    if (!turn) {
      return res.status(400).json({ error: 'turn must be a positive integer for response scope.' });
    }

    appendAiResponseLog({
      timestamp:          new Date().toISOString(),
      event:              'chat_feedback',
      scope,
      feedback,
      conversationId,
      turn,
      conversationTurnKey: `${conversationId}::${turn}`,
      ...(assistantIndex !== null ? { assistantIndex } : {}),
      ...(testMode ? { is_test: true } : {}),
    });

    return res.status(204).send();
  }

  if (scope === 'session') {
    if (!SESSION_FEEDBACK_VALUES.has(feedback)) {
      return res.status(400).json({ error: 'feedback is invalid for session scope.' });
    }

    if (feedback === 'written') {
      if (!comment) {
        return res.status(400).json({ error: 'comment is required when feedback is written.' });
      }
      if (comment.length > 1000) {
        return res.status(400).json({ error: 'comment must be 1000 characters or fewer.' });
      }
    }

    appendAiResponseLog({
      timestamp:      new Date().toISOString(),
      event:          'chat_feedback',
      scope,
      feedback,
      conversationId,
      ...(feedback === 'written'
        ? {
            comment:       redactSensitiveText(comment),
            commentLength: comment.length,
          }
        : {}),
      ...(testMode ? { is_test: true } : {}),
    });

    return res.status(204).send();
  }

  return res.status(400).json({ error: 'scope must be either response or session.' });
});

module.exports = router;
