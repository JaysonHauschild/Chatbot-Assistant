'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getChatModels, createModelFallback } = require('../lib/chat-models');

const failure = (status) => Object.assign(new Error(`Provider status ${status}`), { status });

test('free-tier defaults apply to missing or blank model overrides; classification is opt-in', () => {
  const expected = { primary: 'gemini-3.5-flash-lite', secondary: 'gemini-3.6-flash', classifier: '' };
  assert.deepEqual(getChatModels({}), expected);
  assert.deepEqual(getChatModels({ GEMINI_MODEL: ' ', GEMINI_SECONDARY_MODEL: '' }), expected);
  assert.equal(getChatModels({ GEMINI_MODEL: ' models/custom ', GEMINI_CLASSIFIER_MODEL: 'classifier' }).primary, 'custom');
});

test('one send recovers transient, quota, missing-model, network and empty-response errors', async () => {
  for (const error of [404, 408, 429, 500, 502, 503, 504].map(failure).concat([
    new Error('fetch failed'), Object.assign(new Error('Request exceeded timeout'), { name: 'GoogleGenerativeAIAbortError' }),
    Object.assign(new Error('Empty'), { code: 'EMPTY_MODEL_RESPONSE' }),
  ])) {
    const calls = [];
    const result = await createModelFallback()({ models: ['primary', 'secondary'], generate: async (model) => {
      calls.push(model);
      if (model === 'primary') throw error;
      return 'Answer';
    } });
    assert.equal(result.value, 'Answer');
    assert.deepEqual(calls, ['primary', 'secondary']);
  }
});

test('does not retry authentication, invalid requests, permission or safety failures', async () => {
  for (const error of [400, 401, 403].map(failure).concat(new Error('Blocked for SAFETY'))) {
    let calls = 0;
    await assert.rejects(createModelFallback()({ models: ['primary', 'secondary'], generate: async () => {
      calls++;
      throw error;
    } }), error);
    assert.equal(calls, 1);
  }
});

test('cooldowns respect RetryInfo and avoid repeatedly consuming throttled quota', async () => {
  let time = 0;
  const generateWithFallback = createModelFallback({ now: () => time });
  const calls = [];
  const error = Object.assign(failure(429), { errorDetails: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '120s' }] });
  const send = () => generateWithFallback({ models: ['primary', 'secondary'], generate: async (model) => {
    calls.push(model);
    if (model === 'primary') throw error;
    return 'Answer';
  } });
  await send();
  time = 61_000;
  await send();
  assert.deepEqual(calls, ['primary', 'secondary', 'secondary']);
  time = 121_000;
  await send();
  assert.deepEqual(calls.slice(-2), ['primary', 'secondary']);
});

test('both exhausted models fail once each and duplicate names never cause an extra attempt', async () => {
  for (const models of [['primary', 'secondary'], ['primary', 'primary']]) {
    const generateWithFallback = createModelFallback();
    let calls = 0;
    const send = () => generateWithFallback({ models, generate: async () => { calls++; throw failure(429); } });
    await assert.rejects(send());
    await assert.rejects(send());
    assert.equal(calls, new Set(models).size);
  }
});

test('client disconnect prevents fallback', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(createModelFallback()({ models: ['primary', 'secondary'], signal: controller.signal, generate: async () => {
    calls++;
    controller.abort();
    throw failure(503);
  } }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('a successful primary never calls the secondary or reports a failure', async () => {
  const calls = [];
  const result = await createModelFallback()({
    models: ['primary', 'secondary'],
    generate: async model => { calls.push(model); return 'First answer'; },
    onFailure: () => assert.fail('A success must not report a failure'),
  });
  assert.deepEqual(result, { model: 'primary', value: 'First answer' });
  assert.deepEqual(calls, ['primary']);
});

test('missing and overloaded models are skipped until their cooldown expires', async (t) => {
  for (const [status, cooldown] of [[404, 300_000], [503, 10_000], [429, 60_000]]) {
    await t.test(`status ${status}`, async () => {
      let time = 0;
      let primaryAvailable = false;
      const calls = [];
      const generateWithFallback = createModelFallback({ now: () => time });
      const send = () => generateWithFallback({ models: ['primary', 'secondary'], generate: async model => {
        calls.push(model);
        if (model === 'primary' && !primaryAvailable) throw failure(status);
        return model;
      } });
      assert.equal((await send()).model, 'secondary');
      time = cooldown - 1;
      primaryAvailable = true;
      assert.equal((await send()).model, 'secondary');
      assert.deepEqual(calls, ['primary', 'secondary', 'secondary']);
      time = cooldown;
      assert.equal((await send()).model, 'primary');
    });
  }
});

test('an already cancelled request makes no upstream calls', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createModelFallback()({
    models: ['primary', 'secondary'], signal: controller.signal,
    generate: async () => assert.fail('An aborted request must not consume quota'),
  }), { name: 'AbortError' });
});
