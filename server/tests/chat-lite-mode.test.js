'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

test('lite mode serves saved replies or local errors without AI or RAG and manual override requires a verified test token', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-lite-'));
  const settings = {
    GEMINI_API_KEY: 'must-not-be-used', JWT_SECRET: 'lite-test-secret-for-integration',
    MESSAGE_FILTER_RULES_PATH: path.join(directory, 'rules.json'),
    AI_RESPONSE_LOG_PATH: path.join(directory, 'responses.jsonl'),
    HUMAN_READABLE_LOG_PATH: path.join(directory, 'transcript.md'),
    CONVERSATION_STATUS_LOG_PATH: path.join(directory, 'status.jsonl'),
    BAN_STORE_PATH: path.join(directory, 'bans.json'),
  };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  fs.writeFileSync(settings.MESSAGE_FILTER_RULES_PATH, JSON.stringify({ rules: [
    { id: 'greeting', action: 'respond', pattern: '^hello$', reply: 'A saved greeting.' },
    { id: 'spanish', action: 'respond', language: 'es', pattern: '^hola$', reply: 'Una respuesta guardada.' },
    { id: 'blocked', action: 'block', pattern: 'blocked', message: 'This message is blocked.' },
  ] }));
  const sdk = require('@google/generative-ai');
  const originalSdk = sdk.GoogleGenerativeAI;
  const rag = require('../rag');
  const originalRag = rag.getRelevantContext;
  let remoteCalls = 0;
  sdk.GoogleGenerativeAI = class { getGenerativeModel() { remoteCalls++; throw new Error('AI must not run'); } };
  rag.getRelevantContext = async () => { remoteCalls++; throw new Error('RAG must not run'); };
  const { createChatTrafficGuard } = require('../lib/chat-traffic-guard');
  const guard = createChatTrafficGuard({ env: { CHAT_TRAFFIC_MAX_REQUESTS: '3' }, redis: () => null,
    notify: async () => {}, logger: { warn() {}, error() {} } });
  const { createLiveChatTestSession, liveChatTestMiddleware } = require('../lib/live-chat-test');
  const session = createLiveChatTestSession({ role: 'admin' });
  const app = express();
  app.use(express.json());
  app.use('/api/chat', liveChatTestMiddleware, guard.middleware, require('../routes/chat'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => {
    server.closeAllConnections(); server.close();
    sdk.GoogleGenerativeAI = originalSdk; rag.getRelevantContext = originalRag;
    for (const key of Object.keys(settings)) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const send = async (body, token) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Live-Chat-Test': token } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  };
  const saved = await send({ message: 'hello', liteMode: true });
  assert.equal(saved.data.liteMode, false); // Public requests cannot force test mode.
  const manual = await send({ message: 'Unmatched business question', liteMode: true, stream: true }, session.token);
  assert.equal(manual.data.liteModeReason, 'test');
  assert.equal(manual.data.aiGenerated, false);
  assert.match(manual.data.reply, /unable to answer/);
  assert.equal((await guard.getStatus()).liteMode, false);
  const manualSaved = await send({ message: 'hola', language: 'es', liteMode: true }, session.token);
  assert.equal(manualSaved.data.reply, 'Una respuesta guardada.');
  const manualOff = await send({ message: 'hello', liteMode: false }, session.token);
  assert.equal(manualOff.data.liteMode, false);
  assert.equal((await send({ message: 'hello' })).data.liteMode, false);
  const automatic = await send({ message: 'hello', liteMode: false });
  assert.equal(automatic.data.liteMode, true);
  assert.equal(automatic.data.liteModeReason, 'high_traffic');
  assert.equal(automatic.data.reply, 'A saved greeting.');
  const testCannotDisable = await send({ message: 'hello', liteMode: false }, session.token);
  assert.equal(testCannotDisable.data.liteMode, true);
  assert.equal(testCannotDisable.data.liteModeReason, 'high_traffic');
  const unknown = await send({ message: 'Unmatched business question', liteMode: false });
  assert.equal(unknown.data.liteMode, true);
  assert.match(unknown.data.reply, /unable to answer/);
  assert.equal(unknown.data.aiGenerated, false);
  assert.equal(unknown.data.retryable, undefined);
  const blocked = await send({ message: 'blocked' });
  assert.equal(blocked.data.reply, 'This message is blocked.');
  const spanish = await send({ message: 'Pregunta sin respuesta', language: 'es' });
  assert.match(spanish.data.reply, /no podemos responder/);
  const french = await send({ message: 'Question sans réponse', language: 'fr', stream: true });
  assert.match(french.data.reply, /ne pouvons pas répondre/);
  assert.equal((await send({ message: 'hello' }, 'invalid-token')).status, 401);
  assert.equal(remoteCalls, 0);
  const logged = fs.readdirSync(directory).filter(file => /^responses-.*\.jsonl$/.test(file))
    .flatMap(file => fs.readFileSync(path.join(directory, file), 'utf8').trim().split('\n').map(line => JSON.parse(line)));
  const liteReplies = logged.filter(entry => entry.details?.lite_mode === true);
  assert.ok(liteReplies.length >= 5);
  assert.ok(liteReplies.every(entry => ['predefined', 'blocked', 'degraded'].includes(entry.routing.response_type)));
});
