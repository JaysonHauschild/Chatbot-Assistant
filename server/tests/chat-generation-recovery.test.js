'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

test('chat generation recovers in the original request and signals failed responses', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-generation-recovery-'));
  const settings = {
    GEMINI_API_KEY: 'test-key', GEMINI_MODEL: '', GEMINI_SECONDARY_MODEL: '', GEMINI_CLASSIFIER_MODEL: '',
    GMAIL_USER: '', GMAIL_APP_PASSWORD: '', REDIS_URL: '', BAN_ENFORCEMENT_ENABLED: 'false',
    GEMINI_GENERATION_TIMEOUT_MS: '30000',
    AI_RESPONSE_LOG_PATH: path.join(dir, 'responses.jsonl'),
    HUMAN_READABLE_LOG_PATH: path.join(dir, 'transcript.md'),
    CONVERSATION_STATUS_LOG_PATH: path.join(dir, 'status.jsonl'),
  };
  const originals = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const genAI = require('@google/generative-ai');
  const originalGenAI = genAI.GoogleGenerativeAI;
  const rag = require('../rag');
  const originalGetContext = rag.getRelevantContext;
  rag.getRelevantContext = async () => null;
  let scenario = 'success';
  let calls = [];
  let forwarded = [];
  let classifierCalls = 0;
  const text = 'Start with customer interviews to learn which business problems matter most.';
  const response = { text: () => text, candidates: [{ finishReason: 'STOP' }] };
  genAI.GoogleGenerativeAI = class {
    getGenerativeModel(config) {
      assert.equal(config.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
      return {
        generateContent: async () => {
          classifierCalls++;
          return { response: { text: () => '{"topic":"marketing","userIntent":"informational"}' } };
        },
        startChat: ({ history }) => ({
          sendMessage: async (message, options) => {
            calls.push(config.model);
            forwarded.push({ history, message, timeout: options.timeout });
            if (scenario === 'both_fail' || scenario === 'quota' && calls.length === 1) {
              throw Object.assign(new Error('Quota exceeded'), { status: 429 });
            }
            if (calls.length === 1) {
              if (scenario === 'missing_model') throw Object.assign(new Error('Model unavailable to new users'), { status: 404 });
              if (scenario === 'timeout') throw Object.assign(new Error('Request exceeded timeout'), { name: 'GoogleGenerativeAIAbortError' });
              if (scenario === 'empty' || scenario === 'safety') return {
                response: { text: () => '', candidates: [{ finishReason: scenario === 'safety' ? 'SAFETY' : 'MAX_TOKENS' }] },
              };
            }
            return { response };
          },
          sendMessageStream: async () => {
            calls.push(config.model);
            const primary = calls.length === 1;
            if (scenario === 'both_fail') throw Object.assign(new Error('Quota exceeded'), { status: 429 });
            const broken = scenario === 'broken_stream' && primary;
            return {
              stream: (async function* () {
                yield { text: () => broken ? 'Partial primary' : text };
                if (broken) throw Object.assign(new Error('Unavailable'), { status: 503 });
              })(),
              response: broken ? Promise.reject(Object.assign(new Error('Unavailable'), { status: 503 })) : Promise.resolve(response),
            };
          },
        }),
      };
    }
  };
  const app = express();
  app.use(express.json());
  app.use('/api/chat', require('../routes/chat'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let sequence = 0;
  const send = async (mode, stream = false, { history = [], reuseModels = false, message } = {}) => {
    scenario = mode;
    calls = [];
    forwarded = [];
    sequence++;
    // Distinct overrides isolate per-model cooldown state between cases.
    if (!reuseModels) {
      process.env.GEMINI_MODEL = `gemini-3.5-flash-lite-${sequence}`;
      process.env.GEMINI_SECONDARY_MODEL = `gemini-3.6-flash-${sequence}`;
    }
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/chat?test_mode=1`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message || 'How should I sequence customer discovery before committing to one niche in Oklahoma?', history, conversationId: `recovery-${sequence}`, stream }),
    });
    assert.equal(result.status, 200);
    return stream ? (await result.text()).trim().split('\n').map(JSON.parse) : result.json();
  };
  try {
    await t.test('successful first attempt uses one generation call and no classifier quota', async () => {
      const data = await send('success');
      assert.equal(data.aiGenerated, true);
      assert.equal(data.retryable, undefined);
      assert.equal(calls.length, 1);
      assert.equal(classifierCalls, 0);
    });
    await t.test('quota error on primary is recovered by secondary in same request', async () => {
      const data = await send('quota');
      assert.equal(data.reply, text);
      assert.equal(data.aiGenerated, true);
      assert.deepEqual(calls, [process.env.GEMINI_MODEL, process.env.GEMINI_SECONDARY_MODEL]);
    });
    await t.test('failure during streaming resets partial text then completes secondary response', async () => {
      const events = await send('broken_stream', true);
      const reset = events.findIndex(event => event.type === 'reset');
      assert.ok(reset > 0);
      assert.equal(events[reset - 1].text, 'Partial primary');
      assert.equal(events[reset + 1].text, text);
      assert.equal(events.at(-1).reply, text);
      assert.equal(events.at(-1).aiGenerated, true);
      assert.equal(calls.length, 2);
    });
    await t.test('both models failing mark JSON and streamed service notices retryable', async () => {
      for (const stream of [false, true]) {
        const data = await send('both_fail', stream);
        const final = stream ? data.at(-1) : data;
        assert.equal(final.aiGenerated, false);
        assert.equal(final.retryable, true);
        assert.match(final.reply, /try again/i);
        assert.equal(calls.length, 2);
      }
    });
    for (const mode of ['missing_model', 'timeout', 'empty']) {
      await t.test(`${mode} recovers on the secondary without another user send`, async () => {
        const data = await send(mode);
        assert.equal(data.reply, text);
        assert.equal(data.aiGenerated, true);
        assert.equal(data.retryable, undefined);
        assert.deepEqual(calls, [process.env.GEMINI_MODEL, process.env.GEMINI_SECONDARY_MODEL]);
      });
    }
    await t.test('a subsequent request skips the throttled primary', async () => {
      await send('quota');
      const data = await send('success', false, { reuseModels: true });
      assert.equal(data.aiGenerated, true);
      assert.deepEqual(calls, [process.env.GEMINI_SECONDARY_MODEL]);
    });
    await t.test('fallback preserves the same redacted question, history and deadline', async () => {
      const history = [
        { role: 'user', content: 'My email is owner@example.com. I want to interview potential customers.' },
        { role: 'assistant', content: 'Ask customers about problems they encounter.' },
      ];
      const data = await send('quota', false, { history });
      assert.equal(data.aiGenerated, true);
      assert.equal(forwarded.length, 2);
      assert.deepEqual(forwarded[1], forwarded[0]);
      assert.match(JSON.stringify(forwarded[1].history), /REDACTED_EMAIL/);
      assert.doesNotMatch(JSON.stringify(forwarded[1]), /owner@example.com/);
      assert.equal(forwarded[1].timeout, 30_000);
    });
    await t.test('safety refusal never triggers the secondary model', async () => {
      const data = await send('safety');
      assert.equal(data.aiGenerated, false);
      assert.deepEqual(calls, [process.env.GEMINI_MODEL]);
    });
    await t.test('missing API key returns a retryable notice without model calls', async () => {
      process.env.GEMINI_API_KEY = '';
      try {
        for (const stream of [false, true]) {
          const data = await send('success', stream);
          const final = stream ? data.at(-1) : data;
          assert.equal(final.retryable, true);
          assert.equal(final.aiGenerated, false);
          assert.equal(calls.length, 0);
        }
      } finally {
        process.env.GEMINI_API_KEY = 'test-key';
      }
    });
    await t.test('classification only consumes quota when explicitly configured', async () => {
      const before = classifierCalls;
      process.env.GEMINI_CLASSIFIER_MODEL = 'gemini-3.5-flash-lite-classifier';
      try {
        const data = await send('success');
        assert.equal(data.aiGenerated, true);
        assert.equal(classifierCalls, before + 1);
      } finally {
        process.env.GEMINI_CLASSIFIER_MODEL = '';
      }
    });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    genAI.GoogleGenerativeAI = originalGenAI;
    rag.getRelevantContext = originalGetContext;
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
