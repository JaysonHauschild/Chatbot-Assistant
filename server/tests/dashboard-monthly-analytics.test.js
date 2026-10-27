'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

test('monthly analytics requires dashboard auth, validates filters, and reads daily plus legacy logs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-monthly-api-'));
  const originalPath = process.env.AI_RESPONSE_LOG_PATH;
  const originalSecret = process.env.JWT_SECRET;
  process.env.AI_RESPONSE_LOG_PATH = path.join(dir, 'ai-responses.jsonl');
  process.env.JWT_SECRET = 'monthly-test-secret';
  fs.writeFileSync(process.env.AI_RESPONSE_LOG_PATH, JSON.stringify({ event: 'chat_turn_received', timestamp: '2026-01-01T12:00:00Z', conversation_id: 'test-conversation', turn: 1, details: { session_id_hash: 'test-session' } }));
  fs.writeFileSync(path.join(dir, 'ai-responses-01-01-2026.jsonl'), JSON.stringify({ event: 'chat_response', timestamp: '2026-01-01T12:00:01Z', conversation_id: 'test-conversation', turn: 1, message: { assistant_redacted: 'Private message' } }));
  fs.appendFileSync(process.env.AI_RESPONSE_LOG_PATH, '\n' + JSON.stringify({ event: 'chat_turn_received', timestamp: '2026-01-01T12:00:00Z', conversation_id: 'sandbox', turn: 1, is_test: true }));
  fs.appendFileSync(path.join(dir, 'ai-responses-01-01-2026.jsonl'), '\n' + JSON.stringify({ event: 'chat_response', timestamp: '2026-01-01T12:00:01Z', conversation_id: 'sandbox', turn: 1 }));
  for (const id of ['test-conversation', 'sandbox']) {
    fs.appendFileSync(process.env.AI_RESPONSE_LOG_PATH, '\n' + JSON.stringify({ event: 'advising_link_clicked',
      timestamp: '2026-02-01T12:00:00Z', conversation_id: id,
      details: { url: 'https://business.oksbdc.org/reg.aspx?mode=counsel' } }));
  }
  const app = express();
  app.use('/api', require('../routes/dashboard'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/dashboard/monthly-analytics`;
  const headers = { Authorization: `Bearer ${jwt.sign({ role: 'dashboard' }, process.env.JWT_SECRET, { expiresIn: '5m' })}` };
  try {
    assert.equal((await fetch(url)).status, 401);
    for (const query of ['startMonth=2026-13', 'startMonth=2026-02&endMonth=2026-01', 'startMonth=2020-01&endMonth=2026-01', 'startMonth=2026-01&startMonth=2026-02']) {
      assert.equal((await fetch(`${url}?${query}`, { headers })).status, 400, query);
    }
    const response = await fetch(`${url}?startMonth=2026-01&endMonth=2026-02`, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json();
    assert.equal(data.months.length, 2);
    assert.equal(data.totals.userMessages, 1);
    assert.equal(data.totals.aiReplies, 1);
    assert.equal(data.totals.sessions, 1);
    assert.equal(data.totals.advisingReferralClicks, 1);
    assert.equal(data.totals.oksbdcLinkClicks, 1);
    assert.equal(data.months[0].advisingReferralClicks, 0);
    assert.equal(data.months[1].advisingReferralClicks, 1);
    for (const traffic of ['test', 'all']) {
      const filtered = await (await fetch(`${url}?startMonth=2026-01&endMonth=2026-02&traffic=${traffic}`, { headers })).json();
      assert.equal(filtered.totals.userMessages, 1);
      assert.equal(filtered.totals.aiReplies, 1);
    }
    assert.equal(JSON.stringify(data).includes('Private message'), false);
    assert.equal(JSON.stringify(data).includes('test-session'), false);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
    if (originalPath === undefined) delete process.env.AI_RESPONSE_LOG_PATH;
    else process.env.AI_RESPONSE_LOG_PATH = originalPath;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});
