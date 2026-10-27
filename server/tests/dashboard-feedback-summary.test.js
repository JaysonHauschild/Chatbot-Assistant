'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

test('GET /api/dashboard/feedback-summary aggregates telemetry counts', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-feedback-test-'));
  const logPath = path.join(tempDir, 'ai-responses.jsonl');

  fs.writeFileSync(
    logPath,
    [
      JSON.stringify({ conversation_id: 'conv-feedback', turn: 1, user_message_redacted: 'What is an LLC?', bot_reply_redacted: 'An LLC is a business structure.' }),
      JSON.stringify({ event: 'chat_response', conversation_id: 'conv-classify', turn: 1, classification: { message_intent: 'starting_business' }, message: { assistant_redacted: 'Start with a plan.' } }),
      JSON.stringify({ event: 'chat_response_predefined', conversation_id: 'conv-classify', turn: 2, message_intent: 'marketing', predefined_response: true, predefinedByRule: 'social_media_marketing' }),
      JSON.stringify({ event: 'chat_response', conversation_id: 'conv-classify', turn: 3, classification: { message_intent: 'loans_vs_grants' }, routing: { response_type: 'predefined' } }),
      JSON.stringify({ event: 'chat_feedback', scope: 'response', feedback: 'up', conversationId: 'conv-feedback', turn: 1, timestamp: '2026-01-01T00:00:01.000Z' }),
      JSON.stringify({ event: 'chat_feedback', scope: 'response', feedback: 'down', conversationId: 'conv-feedback', turn: 1, timestamp: '2026-01-01T00:00:02.000Z' }),
      JSON.stringify({ event: 'dashboard_hide_entry', hide_from_dashboard: true, target_type: 'feedback_detail', target_key: 'feedback_detail::conv-feedback::1::response::down::2026-01-01T00:00:02.000Z' }),
      JSON.stringify({ event: 'chat_feedback', scope: 'session', feedback: 'happy', conversationId: 'conv-feedback' }),
      JSON.stringify({ event: 'chat_feedback', scope: 'session', feedback: 'neutral', conversationId: 'conv-feedback' }),
      JSON.stringify({ event: 'chat_feedback', scope: 'session', feedback: 'sad', conversationId: 'conv-feedback' }),
      JSON.stringify({ event: 'chat_feedback', feedback: 'written' }),
      JSON.stringify({ blocked: true, blockedByRule: 'identity_override' }),
      JSON.stringify({ blocked: true, blockedByRule: 'identity_override' }),
      JSON.stringify({ event: 'blocked_response_review', reviewStatus: 'false_positive' }),
      JSON.stringify({ unsure_response: true, confidence_reason: 'Needs more business details', unsure_category: 'insufficient_user_details' }),
      JSON.stringify({ event: 'model_call_degraded_response', unsure_response: true }),
      '',
    ].join('\n'),
    'utf8',
  );

  process.env.AI_RESPONSE_LOG_PATH = logPath;
  process.env.JWT_SECRET = 'test-secret';

  clearModule('../lib/state');
  clearModule('../routes/dashboard');
  clearModule('../routes/auth');
  const dashboardRouter = require('../routes/dashboard');

  const app = express();
  app.use(express.json());
  app.use('/api', dashboardRouter);

  const token = jwt.sign({ role: 'dashboard' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const server = app.listen(0);
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dashboard/feedback-summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.totals.feedbackEvents, 5);
    assert.equal(data.totals.blockedEvents, 2);
    assert.equal(data.totals.reviewEvents, 1);
    assert.equal(data.totals.unsureResponses, 2);
    assert.equal(data.feedbackTotals.up, 1);
    assert.equal(data.feedbackTotals.down, 0);
    assert.equal(data.feedbackTotals.happy, 1);
    assert.equal(data.feedbackTotals.neutral, 1);
    assert.equal(data.feedbackTotals.sad, 1);
    assert.equal(data.feedbackByType.happy, 1);
    assert.equal(data.feedbackByType.written, 1);
    assert.ok(Array.isArray(data.feedbackDetails));
    const upDetail = data.feedbackDetails.find((item) => item.feedback === 'up');
    assert.equal(upDetail.assistant_reply, 'An LLC is a business structure.');
    assert.equal(data.feedbackDetails.some((item) => item.feedback === 'down'), false);
    const happyDetail = data.feedbackDetails.find((item) => item.feedback === 'happy');
    assert.equal(happyDetail.conversation.length, 2);
    assert.equal(data.blockedByRule.identity_override, 2);
    assert.equal(data.blockedReviewByStatus.false_positive, 1);
    assert.equal(data.unsureByCategory.insufficient_user_details, 1);
    assert.equal(data.unsureByCategory.uncategorized, 1);
    assert.ok(Array.isArray(data.unsureMessages));
    assert.equal(data.unsureMessages.length, 2);
    assert.equal(data.unsureMessages[0].confidence_reason, 'Needs more business details');
    assert.equal(data.unsureMessages[0].unsure_category, 'insufficient_user_details');
    assert.ok(Array.isArray(data.classificationSummary.intents.most));
    assert.ok(data.classificationSummary.intents.most.some((item) => item.key === 'starting_business' && item.label === 'Starting a business'));
    assert.ok(data.classificationSummary.intents.most.some((item) => item.key === 'loans_vs_grants' && item.label === 'Loans Vs. Grants'));
    assert.equal(data.classificationSummary.responseTypes.most[0].key, 'ai_generated');
    assert.equal(data.classificationSummary.responseTypes.most[0].label, 'AI generated');
    assert.ok(data.classificationSummary.responseTypes.most.some((item) => item.key === 'predefined' && item.label === 'Predefined response'));
    assert.ok(data.classificationSummary.categories.most.some((item) => item.key === 'insufficient_user_details' && item.label === 'Needs more business details'));
  } finally {
    server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.AI_RESPONSE_LOG_PATH;
    delete process.env.JWT_SECRET;
  }
});
