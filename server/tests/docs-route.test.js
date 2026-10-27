'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { createDocsRouter } = require('../routes/docs');

test('direct HTTP docs preserve HTTP assets and navigation while retaining a restrictive CSP', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-route-'));
  fs.writeFileSync(path.join(directory, 'index.html'), '<link rel="stylesheet" href="style.css"><a href="guide.html">Guide</a><script src="app.js"></script>');
  fs.writeFileSync(path.join(directory, 'guide.html'), '<h1>Guide</h1>');
  fs.writeFileSync(path.join(directory, 'style.css'), 'body { color: navy; }');
  fs.writeFileSync(path.join(directory, 'app.js'), 'window.docsReady = true;');
  const app = express();
  app.use(helmet());
  const parent = express.Router();
  parent.use('/docs', createDocsRouter({ directories: [path.join(directory, 'missing-build'), directory] }));
  parent.get('/', (_req, res) => res.send('Chatbot'));
  app.use('/chatbot', parent);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => { server.closeAllConnections(); server.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const redirect = await fetch(`${base}/chatbot/docs`, { redirect: 'manual' });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), '/chatbot/docs/');
  const page = await fetch(`${base}/chatbot/docs`);
  assert.equal(page.status, 200);
  const policy = page.headers.get('content-security-policy');
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
  assert.match(policy, /script-src 'self'/);
  assert.match(policy, /style-src 'self'/);
  assert.match(policy, /object-src 'none'/);
  const html = await page.text();
  for (const [, relative] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const url = new URL(relative, page.url);
    assert.equal(url.protocol, 'http:');
    const asset = await fetch(url);
    assert.equal(asset.status, 200);
    if (relative.endsWith('.css')) assert.match(asset.headers.get('content-type'), /text\/css/);
    if (relative.endsWith('.js')) assert.match(asset.headers.get('content-type'), /javascript/);
  }
  const chatbot = await fetch(`${base}/chatbot/`);
  assert.match(chatbot.headers.get('content-security-policy'), /upgrade-insecure-requests/);
  assert.equal((await fetch(`${base}/chatbot/docs/missing.html`)).status, 404);
});
