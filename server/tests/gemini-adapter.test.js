'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGeminiAdapter } = require('../lib/gemini-adapter');

test('embeddings preserve models, input prefixes, and request timeout through gemini-kit', async () => {
  const requests = [];
  const adapter = createGeminiAdapter({
    embeddingModel: 'existing-store-model',
    requestTimeoutMs: 1234,
    client: { models: { async embedContent(request) {
      requests.push(request);
      return { embeddings: [{ values: [0.25, -0.5, 1] }] };
    } } },
  });

  assert.deepEqual(await adapter.embedQuery('Business planning'), [0.25, -0.5, 1]);
  await adapter.embedWebDocument('Planning', 'Page text');
  await adapter.embedWebDocument('', 'Untitled page');
  await adapter.embedDocument('Policy', 'Document text');
  await adapter.embedDocument('', 'Untitled document');

  assert.deepEqual(requests.map((request) => request.contents), [
    'task: question answering | query: Business planning',
    'title: Planning | text: Page text',
    'title: none | text: Untitled page',
    'task: retrieval_document | title: Policy | text: Document text',
    'task: retrieval_document | title: Document | text: Untitled document',
  ]);
  for (const request of requests) {
    assert.equal(request.model, 'existing-store-model');
    assert.deepEqual(request.config, { httpOptions: { timeout: 1234 } });
  }
});

test('default embeddings make one attempt and preserve error status and cause', async () => {
  let attempts = 0;
  const upstream = Object.assign(new Error('Rate limited'), { status: 429 });
  const adapter = createGeminiAdapter({
    client: { models: { async embedContent() {
      attempts++;
      throw upstream;
    } } },
  });
  await assert.rejects(adapter.embedQuery('Funding'), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.cause, upstream);
    assert.equal(error.attempts, 1);
    return true;
  });
  assert.equal(attempts, 1);
});

test('ingestion leaves timeout and embedding dimensions unspecified by default', async () => {
  const adapter = createGeminiAdapter({
    client: { models: { async embedContent(request) {
      assert.equal(request.config, undefined);
      return { embeddings: [{ values: [1, 0] }] };
    } } },
  });
  assert.deepEqual(await adapter.embedDocument('Title', 'Body'), [1, 0]);
});

test('missing, empty, and nonfinite vectors are rejected before retrieval or persistence', async () => {
  for (const response of [{}, { embeddings: [{ values: [] }] }, { embeddings: [{ values: [NaN] }] }]) {
    const adapter = createGeminiAdapter({
      client: { models: { async embedContent() { return response; } } },
    });
    await assert.rejects(adapter.embedQuery('Query'), /embedding/i);
  }
});
