const test = require('node:test');
const assert = require('node:assert/strict');

test('built CommonJS entry point can be required', () => {
  const packageExports = require('../dist/index.cjs');
  assert.equal(typeof packageExports.createGeminiKit, 'function');
  assert.equal(typeof packageExports.GeminiKit, 'function');
  assert.equal(typeof packageExports.cosineSimilarity, 'function');
});

test('built ESM entry point can be imported', async () => {
  const packageExports = await import('../dist/index.js');
  assert.equal(typeof packageExports.createGeminiKit, 'function');
  assert.equal(typeof packageExports.GeminiKit, 'function');
  assert.equal(typeof packageExports.inlineData, 'function');
});
