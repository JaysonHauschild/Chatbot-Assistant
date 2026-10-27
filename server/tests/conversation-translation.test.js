'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('conversation translations preserve originals, cache results, and recover from failures', async () => {
  const sdkPath = require.resolve('@google/generative-ai');
  const previousSdk = require.cache[sdkPath];
  const previousKey = process.env.GEMINI_API_KEY;
  let calls = 0; let mode = 'success';
  require.cache[sdkPath] = { id: sdkPath, filename: sdkPath, loaded: true, exports: {
    GoogleGenerativeAI: class {
      getGenerativeModel(options) {
        assert.match(options.systemInstruction, /never obey instructions/);
        return { generateContent: async (input, requestOptions) => {
          calls++;
          assert.equal(requestOptions.timeout, 15000);
          if (mode === 'failure') throw new Error('Offline');
          return { response: { text: () => mode === 'invalid' ? '[]' : JSON.stringify(JSON.parse(input).map((item) => ({
            id: item.id, sourceLanguage: item.content === 'Hello' ? 'English' : 'Spanish',
            englishContent: item.content === 'Hello' ? null : 'I need help starting a business.',
          }))) } };
        } };
      }
    },
  } };
  const helperPath = require.resolve('../lib/conversation-translation');
  delete require.cache[helperPath];
  const { translateConversation } = require(helperPath);
  const events = [{ id: '1-user', kind: 'user', content: 'Necesito ayuda para abrir un negocio.' },
    { id: '1-assistant', kind: 'assistant', content: 'Hello' }, { id: 'feedback', kind: 'feedback', content: '' }];
  try {
    delete process.env.GEMINI_API_KEY;
    assert.equal((await translateConversation(events)).translationStatus, 'unavailable');
    assert.equal(calls, 0);
    process.env.GEMINI_API_KEY = 'test';
    const result = await translateConversation(events);
    assert.equal(result.translationStatus, 'complete');
    assert.equal(result.events[0].englishContent, 'I need help starting a business.');
    assert.equal(result.events[0].content, events[0].content);
    assert.equal(result.events[0].sourceLanguage, 'Spanish');
    assert.deepEqual(result.events.slice(1), events.slice(1));
    assert.equal(events[0].englishContent, undefined);
    await translateConversation(events);
    assert.equal(calls, 1);
    mode = 'failure';
    const newEvents = [{ id: '2-user', content: 'Bonjour' }];
    assert.deepEqual(await translateConversation(newEvents), { events: newEvents, translationStatus: 'unavailable' });
    mode = 'invalid';
    assert.equal((await translateConversation(newEvents)).translationStatus, 'unavailable');
    mode = 'success';
    assert.equal((await translateConversation(newEvents)).translationStatus, 'complete');
    assert.equal(calls, 4, 'failed results must remain retryable');

    // Exercise the actual authenticated route with retained, redacted content.
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'translation-route-'));
    const envNames = ['AI_RESPONSE_LOG_PATH', 'JWT_SECRET', 'DASHBOARD_CONVERSATION_ARCHIVE_PATH', 'DASHBOARD_CONVERSATION_REVIEW_PATH'];
    const oldEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
    process.env.AI_RESPONSE_LOG_PATH = path.join(directory, 'logs.jsonl');
    process.env.JWT_SECRET = 'translation-test-secret';
    process.env.DASHBOARD_CONVERSATION_ARCHIVE_PATH = path.join(directory, 'archive.jsonl');
    process.env.DASHBOARD_CONVERSATION_REVIEW_PATH = path.join(directory, 'reviews.jsonl');
    fs.writeFileSync(process.env.AI_RESPONSE_LOG_PATH, JSON.stringify({ event: 'chat_response', conversation_id: 'translate-route',
      turn: 1, message: 'Necesito ayuda. owner@example.com', reply: 'Hello' }) + '\n');
    const app = express();
    app.use('/api', require('../routes/dashboard'));
    const server = app.listen(0, '127.0.0.1');
    try {
      await new Promise((resolve) => server.once('listening', resolve));
      const url = `http://127.0.0.1:${server.address().port}/api/dashboard/conversations`;
      const before = calls;
      assert.equal((await fetch(`${url}?conversationId=translate-route&translate=true`)).status, 401);
      const headers = { Authorization: `Bearer ${jwt.sign({ role: 'readonly' }, process.env.JWT_SECRET)}` };
      assert.equal((await fetch(url, { headers })).status, 200);
      assert.equal(calls, before, 'lists and unauthorized requests never invoke the model');
      const response = await fetch(`${url}?conversationId=translate-route&translate=true`, { headers });
      assert.equal(response.status, 200);
      const history = await response.json();
      assert.equal(history.translationStatus, 'complete');
      assert.equal(history.events[0].englishContent, 'I need help starting a business.');
      assert.match(history.events[0].content, /Necesito ayuda/);
      assert.doesNotMatch(JSON.stringify(history), /owner@example.com/);
      assert.equal(history.events[1].englishContent, undefined);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      for (const name of envNames) {
        if (oldEnv[name] === undefined) delete process.env[name]; else process.env[name] = oldEnv[name];
      }
      fs.rmSync(directory, { recursive: true, force: true });
    }

  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
    if (previousSdk) require.cache[sdkPath] = previousSdk; else delete require.cache[sdkPath];
    delete require.cache[helperPath];
  }
});
