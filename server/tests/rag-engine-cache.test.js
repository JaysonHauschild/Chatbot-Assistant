'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function writeVectorStore() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-rag-cache-test-'));
  const vectorStorePath = path.join(tempDir, 'vector-store.json');
  fs.writeFileSync(vectorStorePath, JSON.stringify([
    { id: 'alpha#1', url: 'https://example.test/alpha', title: 'Alpha', text: 'Alpha business planning guidance.', embedding: [1, 0] },
    { id: 'beta#1', url: 'https://example.test/beta', title: 'Beta', text: 'Beta funding guidance.', embedding: [0, 1] },
  ]));
  return { tempDir, vectorStorePath };
}

function loadRagEngineWithFakeEmbeddings() {
  const adapterPath = require.resolve('../lib/gemini-adapter');
  const ragEnginePath = require.resolve('../lib/rag-engine');
  const adapterModule = require(adapterPath);
  const originalCreateAdapter = adapterModule.createGeminiAdapter;
  const requests = [];
  const client = {
    models: {
      async embedContent(request) {
        requests.push(request);
        return { embeddings: [{ values: /beta/i.test(request.contents) ? [0, 1] : [1, 0] }] };
      },
    },
  };

  adapterModule.createGeminiAdapter = (options) => originalCreateAdapter({ ...options, client });
  delete require.cache[ragEnginePath];
  const { RagEngine } = require(ragEnginePath);

  return {
    RagEngine,
    getEmbedCalls: () => requests.length,
    getRequests: () => requests,
    restore() {
      adapterModule.createGeminiAdapter = originalCreateAdapter;
      delete require.cache[ragEnginePath];
    },
  };
}

test('RagEngine preloads and reuses cached contexts without re-embedding repeat queries', async () => {
  const { tempDir, vectorStorePath } = writeVectorStore();
  const fake = loadRagEngineWithFakeEmbeddings();

  try {
    const engine = new fake.RagEngine();
    engine.init({
      apiKey: 'test-key',
      vectorStorePath,
      embeddingModel: 'fake-embedding-model',
      topK: 1,
      minScore: 0,
      cacheMaxEntries: 10,
      requestTimeoutMs: 3456,
    });

    assert.equal(engine.getStatus().requestTimeoutMs, 3456);
    await engine.preloadContextBatch(['Alpha planning', 'Alpha planning']);
    assert.equal(fake.getEmbedCalls(), 1);
    assert.deepEqual(fake.getRequests()[0], {
      model: 'fake-embedding-model',
      contents: 'task: question answering | query: alpha planning',
      config: { httpOptions: { timeout: 3456 } },
    });
    assert.equal(engine.getStatus().contextCacheSize, 1);
    assert.equal(engine.getStatus().preloadCompleted, 1);

    const first = await engine.getContext('  alpha   planning  ');
    const second = await engine.getContext('Alpha planning');

    assert.match(first, /Alpha business planning guidance/);
    assert.equal(second, first);
    assert.equal(fake.getEmbedCalls(), 1, 'cached preloaded context should avoid a second embedding call');
  } finally {
    fake.restore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('RagEngine deduplicates concurrent cache misses for the same query', async () => {
  const { tempDir, vectorStorePath } = writeVectorStore();
  const fake = loadRagEngineWithFakeEmbeddings();

  try {
    const engine = new fake.RagEngine();
    engine.init({
      apiKey: 'test-key',
      vectorStorePath,
      embeddingModel: 'fake-embedding-model',
      topK: 1,
      minScore: 0,
      cacheMaxEntries: 10,
    });

    const [first, second] = await Promise.all([
      engine.getContext('Beta funding'),
      engine.getContext(' beta funding '),
    ]);

    assert.match(first, /Beta funding guidance/);
    assert.equal(second, first);
    assert.equal(fake.getEmbedCalls(), 1, 'concurrent identical lookups should share one embedding call');
    assert.equal(engine.getStatus().contextCacheSize, 1);
  } finally {
    fake.restore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
