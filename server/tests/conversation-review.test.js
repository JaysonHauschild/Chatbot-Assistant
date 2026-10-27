'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

test('review tracking persists staff updates, protects concurrent drafts, filters before pagination and survives archiving', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-review-'));
  const variables = ['AI_RESPONSE_LOG_PATH', 'JWT_SECRET', 'DASHBOARD_CONVERSATION_ARCHIVE_PATH', 'DASHBOARD_CONVERSATION_REVIEW_PATH'];
  const previous = variables.map((key) => process.env[key]);
  process.env.AI_RESPONSE_LOG_PATH = path.join(dir, 'logs.jsonl');
  process.env.JWT_SECRET = 'review-test-secret';
  process.env.DASHBOARD_CONVERSATION_ARCHIVE_PATH = path.join(dir, 'archive.jsonl');
  process.env.DASHBOARD_CONVERSATION_REVIEW_PATH = path.join(dir, 'reviews', 'reviews.jsonl');
  const source = Array.from({ length: 28 }, (_, index) => JSON.stringify({ event: 'chat_response', conversation_id: `chat-${index}`, turn: 1, message: 'Question', reply: 'Answer' })).join('\n');
  fs.writeFileSync(process.env.AI_RESPONSE_LOG_PATH, source);
  const modules = ['../routes/dashboard', '../routes/auth', '../lib/state', '../util/logger', '../lib/conversation-review'];
  const start = async () => {
    modules.forEach((name) => { delete require.cache[require.resolve(name)]; });
    const app = express(); app.use(express.json()); app.use('/api', require('../routes/dashboard'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    return server;
  };
  let server = await start();
  let url = `http://127.0.0.1:${server.address().port}/api/dashboard/conversations`;
  const headers = { Authorization: `Bearer ${jwt.sign({ role: 'dashboard', username: 'Alex' }, process.env.JWT_SECRET)}`, 'Content-Type': 'application/json' };
  const get = async (query = '') => (await fetch(`${url}${query}`, { headers })).json();
  const save = (body, requestHeaders = headers) => fetch(`${url}/review`, { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) });
  try {
    assert.deepEqual((await get('?conversationId=chat-27')).review, { status: 'to_review', version: 0, updates: [] });
    const update = { conversationId: 'chat-27', status: 'in_progress', note: 'Ask the advisor.\nFollow up tomorrow.', expectedVersion: 0 };
    assert.equal((await save(update, { 'Content-Type': 'application/json' })).status, 401);
    for (const invalid of [{ ...update, status: 'invalid' }, { ...update, note: 'x'.repeat(4001) }, { ...update, expectedVersion: -1 }, { ...update, conversationId: 'invalid/id' }]) {
      assert.equal((await save(invalid)).status, 400);
    }
    assert.equal((await save({ ...update, conversationId: 'missing' })).status, 404);
    const response = await save(update);
    assert.equal(response.status, 200);
    const { review } = await response.json();
    assert.equal(review.version, 1);
    assert.equal(review.updates[0].updatedBy, 'Alex');
    assert.equal(review.updates[0].note, update.note);
    const conflict = await save({ ...update, status: 'resolved' });
    assert.equal(conflict.status, 409);
    assert.deepEqual((await conflict.json()).review, review);
    assert.equal((await save({ ...update, expectedVersion: 1, note: '', status: 'resolved' })).status, 200);
    const matched = await get('?reviewStatus=resolved');
    assert.equal(matched.total, 1);
    assert.equal(matched.conversations[0].conversationId, 'chat-27');
    assert.equal(matched.conversations[0].reviewUpdateCount, 2);
    assert.equal('review' in matched.conversations[0], false);
    assert.equal((await get('?reviewStatus=unfinished')).total, 27);
    assert.equal((await get('?reviewStatus=to_review')).total, 27);
    assert.equal((await fetch(`${url}?reviewStatus=invalid`, { headers })).status, 400);
    await fetch(`${url}/archive`, { method: 'POST', headers, body: JSON.stringify({ conversationId: 'chat-27' }) });
    assert.equal((await get('?archived=true&reviewStatus=resolved')).total, 1);
    await new Promise((resolve) => server.close(resolve));
    server = await start(); url = `http://127.0.0.1:${server.address().port}/api/dashboard/conversations`;
    assert.equal((await get('?archived=true&conversationId=chat-27')).review.updates.length, 2);
    await fetch(`${url}/restore`, { method: 'POST', headers, body: JSON.stringify({ conversationId: 'chat-27' }) });
    assert.equal((await get('?conversationId=chat-27')).review.status, 'resolved');
    // A failed write cannot report success, and source conversation logs never contain staff notes.
    const savedPath = process.env.DASHBOARD_CONVERSATION_REVIEW_PATH;
    fs.writeFileSync(path.join(dir, 'file'), 'not a directory');
    process.env.DASHBOARD_CONVERSATION_REVIEW_PATH = path.join(dir, 'file', 'reviews.jsonl');
    assert.equal((await save({ ...update, expectedVersion: 2 })).status, 500);
    process.env.DASHBOARD_CONVERSATION_REVIEW_PATH = savedPath;
    assert.equal((await get('?conversationId=chat-27')).review.version, 2);
    assert.equal(fs.readFileSync(process.env.AI_RESPONSE_LOG_PATH, 'utf8'), source);
    assert.equal((await get('?q=advisor')).total, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    variables.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    modules.forEach((name) => { delete require.cache[require.resolve(name)]; });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
