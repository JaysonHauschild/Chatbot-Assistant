'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function getCurrentLogPath(logPath) {
  const parsed = path.parse(logPath);
  const stamp = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }).replace(/\//g, '-');
  return path.join(parsed.dir, `${parsed.name}-${stamp}${parsed.ext || '.jsonl'}`);
}

function readJsonl(logPath) {
  const actualPath = fs.existsSync(logPath) ? logPath : getCurrentLogPath(logPath);
  return fs.readFileSync(actualPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function withServer(routerMounts, callback) {
  const app = express();
  app.use(express.json());
  for (const [mountPath, router] of routerMounts) {
    app.use(mountPath, router);
  }
  const server = app.listen(0);
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

test('auth route rejects unconfigured and invalid account logins, then issues a dashboard JWT for valid credentials', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-auth-route-test-'));
  const originalAccountsPath = process.env.DASHBOARD_ACCOUNTS_PATH;
  const originalSecret = process.env.JWT_SECRET;

  try {
    process.env.DASHBOARD_ACCOUNTS_PATH = path.join(tempDir, 'dashboard-accounts.json');
    process.env.JWT_SECRET = 'auth-test-secret';
    clearModule('../lib/dashboard-accounts');
    clearModule('../routes/auth');
    let authRouter = require('../routes/auth');

    await withServer([['/api/auth', authRouter]], async (baseUrl) => {
      const unconfigured = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'anything' }),
      });
      assert.equal(unconfigured.status, 500);
    });

    const { createDashboardAccount } = require('../lib/dashboard-accounts');
    createDashboardAccount({ username: 'Admin.User', password: 'correct horse battery staple' });
    clearModule('../routes/auth');
    authRouter = require('../routes/auth');

    await withServer([['/api/auth', authRouter]], async (baseUrl) => {
      const missingUsername = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'correct horse battery staple' }),
      });
      assert.equal(missingUsername.status, 400);

      const missingPassword = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin.user' }),
      });
      assert.equal(missingPassword.status, 400);

      const incorrect = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin.user', password: 'wrong' }),
      });
      assert.equal(incorrect.status, 401);

      const valid = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'ADMIN.USER', password: 'correct horse battery staple' }),
      });
      assert.equal(valid.status, 200);
      const data = await valid.json();
      const payload = jwt.verify(data.token, process.env.JWT_SECRET);
      assert.equal(payload.role, 'dashboard');
      assert.equal(payload.username, 'admin.user');
      assert.equal(data.onboardingRequired, false);
      assert.deepEqual(data.user, { username: 'admin.user', role: 'dashboard', firstName: null, lastName: null, email: null });
    });
  } finally {
    if (originalAccountsPath === undefined) delete process.env.DASHBOARD_ACCOUNTS_PATH;
    else process.env.DASHBOARD_ACCOUNTS_PATH = originalAccountsPath;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    clearModule('../lib/dashboard-accounts');
    clearModule('../routes/auth');
  }
});

test('feedback route validates payloads, writes sanitized response and written-session feedback logs', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-feedback-route-test-'));
  const originalLogPath = process.env.AI_RESPONSE_LOG_PATH;
  process.env.AI_RESPONSE_LOG_PATH = path.join(tempDir, 'ai-responses.jsonl');

  try {
    clearModule('../lib/state');
    clearModule('../util/logger');
    clearModule('../routes/feedback');
    const feedbackRouter = require('../routes/feedback');

    await withServer([['/api/feedback', feedbackRouter]], async (baseUrl) => {
      const missingConversation = await fetch(`${baseUrl}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'response', feedback: 'up', turn: 1 }),
      });
      assert.equal(missingConversation.status, 400);

      const invalidFeedback = await fetch(`${baseUrl}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conv', scope: 'response', feedback: 'happy', turn: 1 }),
      });
      assert.equal(invalidFeedback.status, 400);

      const responseFeedback = await fetch(`${baseUrl}/api/feedback?test_mode=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conv/unsafe', scope: 'response', feedback: 'up', turn: 2, assistantIndex: 3 }),
      });
      assert.equal(responseFeedback.status, 204);

      const missingWrittenComment = await fetch(`${baseUrl}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conv', scope: 'session', feedback: 'written' }),
      });
      assert.equal(missingWrittenComment.status, 400);

      const writtenFeedback = await fetch(`${baseUrl}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: 'conv-written',
          scope: 'session',
          feedback: 'written',
          comment: 'Please call me at 405-555-1212 or email owner@example.com.',
        }),
      });
      assert.equal(writtenFeedback.status, 204);
    });

    const logs = readJsonl(process.env.AI_RESPONSE_LOG_PATH);
    assert.equal(logs.length, 2);
    assert.equal(logs[0].schema_version, 2);
    assert.equal(logs[0].event, 'chat_feedback');
    assert.equal(logs[0].conversation_id, 'conv_unsafe');
    assert.equal(logs[0].turn, 2);
    assert.equal(logs[0].feedback.scope, 'response');
    assert.equal(logs[0].feedback.value, 'up');
    assert.equal(logs[0].feedback.conversation_turn_key, 'conv_unsafe::2');
    assert.equal(logs[0].feedback.assistant_index, 3);
    assert.equal(logs[0].is_test, true);
    assert.equal(logs[1].feedback.comment_redacted, 'Please call me at [REDACTED_PHONE] or email [REDACTED_EMAIL].');
    assert.equal(logs[1].feedback.comment_length, 58);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalLogPath === undefined) delete process.env.AI_RESPONSE_LOG_PATH;
    else process.env.AI_RESPONSE_LOG_PATH = originalLogPath;
    clearModule('../lib/state');
    clearModule('../util/logger');
    clearModule('../routes/feedback');
  }
});
