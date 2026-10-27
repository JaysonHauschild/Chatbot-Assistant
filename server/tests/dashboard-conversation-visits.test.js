'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

test('visit grouping uses recorded identities, filters before grouping, and paginates whole visits', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-visits-'));
  const names = ['AI_RESPONSE_LOG_PATH', 'JWT_SECRET', 'DASHBOARD_CONVERSATION_ARCHIVE_PATH', 'DASHBOARD_CONVERSATION_REVIEW_PATH'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.AI_RESPONSE_LOG_PATH = path.join(temp, 'history.jsonl');
  process.env.JWT_SECRET = 'visits-test-secret';
  process.env.DASHBOARD_CONVERSATION_ARCHIVE_PATH = path.join(temp, 'archives.jsonl');
  process.env.DASHBOARD_CONVERSATION_REVIEW_PATH = path.join(temp, 'reviews.jsonl');
  const receipt = (id, day, identity = {}, extra = {}) => ({ event: 'chat_turn_received', conversation_id: id,
    timestamp: `2026-01-${day}T12:00:00Z`, turn: 1, user_message_redacted: `Question ${id}`, ...identity, ...extra });
  const entries = [
    ...Array.from({ length: 30 }, (_, index) => receipt(`shared-${String(index).padStart(2, '0')}`, '05', {
      visit_id_hash: 'shared-visit', session_id_hash: `reset-session-${index}`,
    }, { user_message_redacted: index ? `Question ${index}` : 'Cafe permits', message_intent: index ? 'funding' : 'legal' })),
    receipt('legacy-one', '04', { details: { session_id_hash: 'legacy-session' } }),
    receipt('legacy-two', '04', { session_id_hash: 'legacy-session' }),
    receipt('unknown-one', '03'), receipt('unknown-two', '03'),
    receipt('conflicting', '02', { visit_id_hash: 'one' }),
    receipt('conflicting', '02', { visit_id_hash: 'two' }, { turn: 2 }),
    ...Array.from({ length: 26 }, (_, index) => receipt(`single-${index}`, '01', { visit_id_hash: `single-visit-${index}` })),
  ];
  entries.push(entries[0]);
  fs.writeFileSync(process.env.AI_RESPONSE_LOG_PATH, entries.map(JSON.stringify).join('\n'));
  const modules = ['../routes/dashboard', '../routes/auth', '../lib/state', '../util/logger'];
  modules.forEach((name) => { delete require.cache[require.resolve(name)]; });
  const app = express();
  app.use('/api', require('../routes/dashboard'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/dashboard/conversations`;
  const headers = { Authorization: `Bearer ${jwt.sign({ role: 'readonly' }, process.env.JWT_SECRET)}` };
  const read = async (query) => {
    const response = await fetch(`${url}?${query}`, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.json();
  };
  try {
    assert.equal((await fetch(`${url}?groupBy=visit`)).status, 401);
    for (const query of ['groupBy=invalid', 'groupBy=visit&groupBy=visit']) {
      assert.equal((await fetch(`${url}?${query}`, { headers })).status, 400);
    }
    const grouped = await read('groupBy=visit');
    assert.equal(grouped.total, 31);
    assert.equal(grouped.conversationTotal, 61);
    assert.equal(grouped.unlinkedConversationCount, 3);
    assert.equal(grouped.visits.length, 25);
    const shared = grouped.visits[0];
    assert.equal(shared.conversationCount, 30);
    assert.equal(shared.messageCount, 30);
    assert.equal(shared.conversations[0].conversationId, 'shared-00');
    assert.equal(shared.conversations.at(-1).conversationId, 'shared-29');
    assert.equal(shared.conversations.every((item) => !('events' in item) && !('review' in item) && !('referralClicks' in item)), true);
    assert.equal(grouped.visits.find((visit) => visit.conversations.some((item) => item.conversationId === 'legacy-one')).conversationCount, 2);
    assert.equal(grouped.visits.filter((visit) => !visit.visitReference).every((visit) => visit.conversationCount === 1), true);
    assert.doesNotMatch(JSON.stringify(grouped), /shared-visit|reset-session|legacy-session/);
    const last = await read('groupBy=visit&offset=25');
    assert.equal(last.visits.length, 6);
    assert.equal(new Set([...grouped.visits, ...last.visits].map((visit) => visit.id)).size, 31);
    const filtered = await read('groupBy=visit&q=Cafe&topic=legal&dateFrom=2026-01-05&dateTo=2026-01-05');
    assert.equal(filtered.total, 1);
    assert.equal(filtered.conversationTotal, 1);
    assert.equal(filtered.visits[0].conversationCount, 1);
    assert.equal(filtered.visits[0].id, shared.id);
    assert.equal((await read('groupBy=visit&q=does-not-exist')).total, 0);
    const flat = await read('');
    assert.equal(flat.total, 61);
    assert.equal(flat.conversations.length, 25);
    const detail = await read('conversationId=shared-00');
    assert.equal(detail.visitReference, shared.visitReference);
    assert.equal(detail.events.length, 1);

    fs.writeFileSync(process.env.DASHBOARD_CONVERSATION_ARCHIVE_PATH, JSON.stringify({ conversationId: 'shared-01', archivedAt: '2026-01-06T00:00:00Z' }) + '\n');
    assert.equal((await read('groupBy=visit')).visits[0].conversationCount, 29);
    const archived = await read('groupBy=visit&archived=true');
    assert.equal(archived.conversationTotal, 1);
    assert.equal(archived.visits[0].id, shared.id);
    assert.equal(archived.visits[0].conversations[0].archived, true);
    assert.equal((await read('groupBy=visit&archived=all')).visits[0].conversationCount, 30);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    names.forEach((name) => { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; });
    modules.forEach((name) => { delete require.cache[require.resolve(name)]; });
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
