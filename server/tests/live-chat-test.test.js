'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('authorized live tests run real chat without persisting conversations or affecting public logging', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-chat-test-'));
  const keys = ['AI_RESPONSE_LOG_PATH', 'HUMAN_READABLE_LOG_PATH', 'CONVERSATION_STATUS_LOG_PATH', 'JWT_SECRET', 'GEMINI_API_KEY'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.AI_RESPONSE_LOG_PATH = path.join(tempDir, 'ai.jsonl');
  process.env.HUMAN_READABLE_LOG_PATH = path.join(tempDir, 'transcript.md');
  process.env.CONVERSATION_STATUS_LOG_PATH = path.join(tempDir, 'status.jsonl');
  process.env.JWT_SECRET = 'live-test-integration-secret';
  delete process.env.GEMINI_API_KEY;
  const { liveChatTestMiddleware } = require('../lib/live-chat-test');
  const logger = require('../util/logger');
  const app = express();
  app.use(express.json());
  app.use(['/api/chat', '/api/feedback'], liveChatTestMiddleware);
  app.use('/api/chat', require('../routes/chat'));
  app.use('/api/feedback', require('../routes/feedback'));
  app.use('/api', require('../routes/dashboard'));
  app.post('/failure', liveChatTestMiddleware, (_req, res) => {
    logger.appendAiResponseLog({ event: 'model_call_failed', user_message_redacted: 'private-test-text', error: { message: 'private-upstream-text' }, trace_id: 'test-trace' });
    res.sendStatus(204);
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const dashboardToken = role => jwt.sign({ role }, process.env.JWT_SECRET, { expiresIn: '5m' });
  try {
    assert.equal((await send('/api/dashboard/live-chat-test', {})).status, 401);
    assert.equal((await send('/api/dashboard/live-chat-test', {}, { Authorization: `Bearer ${dashboardToken('readonly')}` })).status, 403);
    const started = await send('/api/dashboard/live-chat-test', {}, { Authorization: `Bearer ${dashboardToken('dashboard')}` });
    assert.equal(started.status, 200);
    assert.equal(started.headers.get('cache-control'), 'no-store');
    const session = await started.json();
    const headers = { 'X-Live-Chat-Test': session.token };
    const decoded = jwt.decode(session.token);
    assert.equal(decoded.exp - decoded.iat, 1800);
    assert.equal((await send('/api/dashboard/live-chat-test', {}, { Authorization: `Bearer ${session.token}` })).status, 403);
    const responses = await Promise.all([
      send('/api/chat', { message: 'hello', sessionId: 'same-browser-session' }, headers),
      send('/api/chat', { message: 'hello', sessionId: 'same-browser-session', conversationId: 'public-conversation' }),
    ]);
    const live = await responses[0].json();
    assert.equal(responses[0].status, 200);
    assert.match(live.reply, /hello/i);
    assert.ok(live.conversationId.startsWith(`live-test-${decoded.jti}-`));
    assert.equal(responses[1].status, 200);
    // The test cannot attach to, suppress logs for, or reset a public conversation.
    assert.equal((await send('/api/chat', { message: 'hello', conversationId: 'public-conversation' }, headers)).status, 403);
    assert.equal((await send('/api/chat', { message: 'hello', conversationId: live.conversationId })).status, 401);
    assert.equal((await send('/api/chat', { message: 'hello', sessionId: `live-test-${decoded.jti}-session` })).status, 401);
    assert.equal((await send('/api/chat', { message: 'hello' }, { 'X-Live-Chat-Test': dashboardToken('admin') })).status, 401);
    const expired = jwt.sign({ ...decoded, exp: Math.floor(Date.now() / 1000) - 1 }, process.env.JWT_SECRET);
    assert.equal((await send('/api/chat', { message: 'hello' }, { 'X-Live-Chat-Test': expired })).status, 401);
    assert.equal((await send('/api/chat', { message: 'hello', conversationId: live.conversationId, history: [{ role: 'user', content: 'hello' }, { role: 'model', content: live.reply }] }, headers)).status, 200);
    assert.equal((await send('/api/feedback', { scope: 'response', feedback: 'up', turn: 1, conversationId: live.conversationId }, headers)).status, 204);
    assert.equal((await send('/api/chat/link-click', { url: 'https://www.oksbdc.org/advising/', conversationId: live.conversationId }, headers)).status, 204);
    const cleared = await (await send('/api/chat', { message: 'hello', sessionId: 'new-test-session' }, headers)).json();
    assert.notEqual(cleared.conversationId, live.conversationId);
    assert.equal((await send('/api/chat/reset', { conversationId: live.conversationId }, headers)).status, 200);
    const again = await (await send('/api/chat', { message: 'hello' }, headers)).json();
    assert.notEqual(again.conversationId, live.conversationId);
    const logs = () => fs.readdirSync(tempDir).map(file => fs.readFileSync(path.join(tempDir, file), 'utf8')).join('\n');
    assert.match(logs(), /public-conversation/);
    assert.doesNotMatch(logs(), /live-test-|is_test/);
    await send('/failure', {}, headers);
    assert.match(logs(), /live_chat_test_failure/);
    assert.match(logs(), /test-trace/);
    assert.doesNotMatch(logs(), /private-test-text|private-upstream-text/);
    // The legacy public flag still logs tagged tests rather than granting suppression.
    await send('/api/chat?test_mode=1', { message: 'hello', conversationId: 'legacy-test' });
    assert.match(logs(), /legacy-test/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    keys.forEach(key => { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
