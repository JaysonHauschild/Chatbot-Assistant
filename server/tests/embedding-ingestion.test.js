'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const adapterModule = require('../lib/gemini-adapter');

test('crawler writes gemini-kit vectors with the existing page input format', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-crawl-embedding-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const requests = [];
  const originalCreate = adapterModule.createGeminiAdapter;
  t.mock.method(adapterModule, 'createGeminiAdapter', (options) => originalCreate({
    ...options,
    client: { models: { async embedContent(request) {
      requests.push(request);
      return { embeddings: [{ values: [0.5, 1] }] };
    } } },
  }));
  t.mock.method(globalThis, 'fetch', async () => new Response(
    '<html><head><title>Planning</title></head><body><main><p>' +
    'Prepare a business plan and estimate startup costs before applying for funding.' +
    '</p></main></body></html>',
    { headers: { 'content-type': 'text/html' } },
  ));
  const crawlerPath = require.resolve('../lib/crawler');
  delete require.cache[crawlerPath];
  t.after(() => delete require.cache[crawlerPath]);
  const { crawl } = require(crawlerPath);
  const outputPath = path.join(directory, 'vectors.json');

  const result = await crawl({
    apiKey: 'test-key',
    embeddingModel: 'existing-store-model',
    startUrls: ['https://example.test/'],
    allowedHostnames: ['example.test'],
    outputPath,
    checkpointPath: path.join(directory, 'checkpoint.json'),
    enableOcr: false,
    embedDelayMs: 0,
    maxPages: 1,
    showProgress: false,
  });
  const records = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(result.chunkCount, 1);
  assert.deepEqual(records[0].embedding, [0.5, 1]);
  assert.equal(requests[0].model, 'existing-store-model');
  assert.equal(requests[0].contents, `title: Planning | text: ${records[0].text}`);
});

test('document ingestion CLI merges gemini-kit vectors without replacing web records', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-document-embedding-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const documentPath = path.join(directory, 'faq.md');
  fs.writeFileSync(documentPath, '# FAQ\n\nPrepare a business plan and estimate startup costs before applying for funding.');
  const outputPath = path.join(directory, 'vectors.json');
  const webRecord = { id: 'web#0', url: 'https://example.test/', text: 'Existing web content', embedding: [1, 0] };
  fs.writeFileSync(outputPath, JSON.stringify([webRecord]));
  const preloadPath = path.join(directory, 'fake-gemini.cjs');
  const requestsPath = path.join(directory, 'requests.json');
  fs.writeFileSync(preloadPath, `
    const fs = require('node:fs');
    const adapter = require(${JSON.stringify(require.resolve('../lib/gemini-adapter'))});
    const create = adapter.createGeminiAdapter;
    const requests = [];
    adapter.createGeminiAdapter = (options) => create({ ...options,
      client: { models: { async embedContent(request) {
        requests.push(request);
        fs.writeFileSync(${JSON.stringify(requestsPath)}, JSON.stringify(requests));
        return { embeddings: [{ values: [0.25, 0.75] }] };
      } } },
    });
  `);
  const child = spawnSync(process.execPath, [
    '--require', preloadPath,
    path.join(__dirname, '../scripts/add-documents.js'),
    documentPath, '--out', outputPath, '--model', 'existing-store-model', '--delay-ms', '0',
  ], { env: { ...process.env, GEMINI_API_KEY: 'test-key' }, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  const records = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.deepEqual(records[0], webRecord);
  assert.equal(records.length, 2);
  assert.deepEqual(records[1].embedding, [0.25, 0.75]);
  const requests = JSON.parse(fs.readFileSync(requestsPath, 'utf8'));
  assert.equal(requests[0].model, 'existing-store-model');
  assert.equal(requests[0].contents, `task: retrieval_document | title: ${records[1].title} | text: ${records[1].text}`);
});
