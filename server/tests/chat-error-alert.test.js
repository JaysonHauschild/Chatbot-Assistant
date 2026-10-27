'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const express = require('express');
const { createChatErrorAlertMiddleware } = require('../lib/chat-error-alert');

test('HTTP failures including malformed JSON and rate limits alert, successful responses do not', async t => {
  const operations = [];
  const app = express();
  app.use('/api/chat', createChatErrorAlertMiddleware(async (_, operation) => operations.push(operation)));
  app.use(express.json());
  app.post('/api/chat', (req, res) => res.status(req.body.status).json({}));
  app.use((error, req, res, next) => res.status(error.status || 500).end());
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/chat`;
  for (const status of [200, 204, 400, 403, 429, 500, 503]) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    await response.text();
    assert.equal(response.status, status);
  }
  const malformed = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  await malformed.text();
  assert.equal(malformed.status, 400);
  assert.deepEqual(operations, [400, 403, 429, 500, 503, 400].map(status => `Chat HTTP ${status}`));
});

test('stream failures, fallback errors, and disconnects alert once per request', async () => {
  for (const kind of ['stream', 'fallback', 'disconnect']) {
    const operations = [];
    const res = Object.assign(new EventEmitter(), { locals: {}, statusCode: 200, writableFinished: false });
    createChatErrorAlertMiddleware(async (_, operation) => operations.push(operation))({}, res, () => {});
    if (kind !== 'disconnect') {
      res.locals.reportChatError('Chat response');
      res.locals.reportChatError('Chat unsuccessful response');
    }
    res.emit('close');
    res.emit('finish');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(operations.length, 1);
  }
});
