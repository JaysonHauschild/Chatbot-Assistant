'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

test('conversation browser authenticates, reconstructs ordered events, searches and respects hidden entries', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-history-test-'));
  const previous = { log: process.env.AI_RESPONSE_LOG_PATH, secret: process.env.JWT_SECRET,
    archive: process.env.DASHBOARD_CONVERSATION_ARCHIVE_PATH, review: process.env.DASHBOARD_CONVERSATION_REVIEW_PATH };
  process.env.AI_RESPONSE_LOG_PATH = path.join(tempDir, 'ai-responses.jsonl');
  process.env.DASHBOARD_CONVERSATION_ARCHIVE_PATH = path.join(tempDir, 'archives', 'conversations.jsonl');
  process.env.DASHBOARD_CONVERSATION_REVIEW_PATH = path.join(tempDir, 'reviews.jsonl');
  process.env.JWT_SECRET = 'history-test-secret';
  const longReply = 'Business planning advice. '.repeat(150);
  const entry = (event, second, extra = {}) => ({ event, timestamp: `2026-01-01T00:00:0${second}.000Z`, conversation_id: 'conversation-a', turn: 1, ...extra });
  const logs = [
    entry('chat_turn_received', 1, { user_message_redacted: 'Starting a cafe: owner@example.com', classification: { message_intent: 'starting_business' }, page_url: 'https://example.com/start?email=owner@example.com#private' }),
    entry('message_classified_for_routing', 2, { message: 'Starting a cafe: owner@example.com' }),
    entry('chat_response', 3, { message: { user: 'Starting a cafe', assistant: longReply }, routing: { response_type: 'blocked' } }),
    entry('chat_turn_received', 4, { turn: 2, message: 'Permits?', message_intent: 'legal', page_url: 'https://example.com/permits' }),
    entry('chat_response_predefined', 5, { turn: 2, message: 'Permits?', reply: 'Contact an advisor.' }),
    entry('advising_link_clicked', 6, { details: { url: 'https://business.oksbdc.org/reg.aspx?mode=counsel&email=owner@example.com' } }),
    entry('advising_link_clicked', 7, { turn: null, timestamp: 'invalid', url: 'https://www.oksbdc.org/about/' }),
    entry('advising_link_clicked', 7, { details: { url: 'https://www.oksbdc.org/workshops/' } }),
    entry('advising_link_clicked', 7, { details: { url: 'https://oksbdc.org.evil.example/about/' } }),
    entry('advising_link_clicked', 7, { turn: 2, details: { url: 'https://www.oksbdc.org/about/' } }),
    entry('advising_link_clicked', 7, { turn: 3, details: { url: 'https://www.oksbdc.org/about/' } }),
    entry('chat_feedback', 6, { scope: 'response', feedback: 'up' }),
    entry('chat_feedback', 7, { turn: null, feedback: { scope: 'session', value: 'written', comment: 'Thanks owner@example.com' } }),
    entry('chat_response', 8, { turn: 3, message: 'Hidden message', reply: 'Hidden reply', message_intent: 'hidden_topic', page_url: 'https://hidden.example/' }),
    { event: 'dashboard_hide_entry', hide_from_dashboard: true, target_key: 'context_turn::conversation-a::3' },
    entry('chat_feedback', 9, { feedback: 'down', scope: 'response' }),
    { event: 'dashboard_hide_entry', hide_from_dashboard: true, target_key: 'feedback_detail::conversation-a::1::response::down::2026-01-01T00:00:09.000Z' },
    { event: 'dashboard_hide_entry', hide_from_dashboard: true, target_key: 'conversation_message::conversation-a::2::assistant' },
    ...Array.from({ length: 26 }, (_, index) => entry('chat_response', 1, {
      conversation_id: `older-${index}`, message: 'Older question', reply: 'Older answer',
    })),
  ];
  fs.writeFileSync(process.env.AI_RESPONSE_LOG_PATH, `${logs.map((item) => JSON.stringify(item)).join('\n')}\ninvalid json\n`);
  const modules = ['../routes/dashboard', '../routes/auth', '../lib/state', '../util/logger', '../lib/conversation-archive'];
  modules.forEach((name) => { delete require.cache[require.resolve(name)]; });
  const app = express();
  app.use(express.json());
  app.use('/api', require('../routes/dashboard'));
  let server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  let url = `http://127.0.0.1:${server.address().port}/api/dashboard/conversations`;
  const headers = { Authorization: `Bearer ${jwt.sign({ role: 'dashboard' }, process.env.JWT_SECRET)}` };
  try {
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(`${url}?conversationId=conversation-a`, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const history = await response.json();
    assert.deepEqual(history.events.map((item) => item.kind), ['user', 'assistant', 'user', 'feedback', 'feedback']);
    assert.deepEqual(history.events.map((item) => item.timestamp), [1, 3, 4, 6, 7].map((second) => `2026-01-01T00:00:0${second}.000Z`));
    assert.equal(history.events[1].content, longReply.trim());
    assert.equal(history.events[3].turn, 1);
    assert.equal(history.events[4].scope, 'session');
    assert.doesNotMatch(JSON.stringify(history), /owner@example.com|Hidden/);
    assert.equal(history.feedbackCount, 2);
    assert.equal(history.messageCount, 2);
    assert.equal(history.responseCount, 1);
    assert.equal(history.referralClickCount, 2);
    assert.equal(history.referralClicks.length, 2);
    assert.equal(history.referralClicks[0].timestamp, '2026-01-01T00:00:06.000Z');
    assert.equal(history.referralClicks[0].turn, 1);
    assert.match(history.referralClicks[0].url, /mode=counsel/);
    assert.equal(history.referralClicks[1].timestamp, null);
    assert.equal(history.referralClicks[1].turn, null);
    assert.equal(history.referralClicks[1].url, 'https://www.oksbdc.org/about/');
    const page = await (await fetch(url, { headers })).json();
    assert.equal(page.total, 27);
    assert.equal(page.conversations.length, 25);
    assert.equal(page.conversations[0].conversationId, 'conversation-a');
    assert.equal('events' in page.conversations[0], false);
    assert.equal('referralClicks' in page.conversations[0], false);
    assert.equal(page.conversations[0].referralClickCount, 2);
    const last = await (await fetch(`${url}?offset=25`, { headers })).json();
    assert.equal(last.conversations.length, 2);
    const search = await (await fetch(`${url}?q=cafe`, { headers })).json();
    assert.equal(search.total, 1);
    assert.deepEqual(search.conversations[0].topics, ['legal', 'starting_business']);
    assert.deepEqual(search.conversations[0].pages, ['https://example.com/permits', 'https://example.com/start']);
    assert.deepEqual(search.conversations[0].ratings, ['up']);
    assert.equal(search.conversations[0].hasBlockedMessages, true);
    assert.deepEqual(page.filterOptions.topics, ['legal', 'starting_business', 'unclassified']);
    assert.equal(page.filterOptions.pages.includes('https://hidden.example/'), false);
    assert.doesNotMatch(JSON.stringify(page), /owner@example.com|#private|hidden_topic/);
    for (const filter of ['topic=legal', 'rating=up', 'rating=positive', 'blocked=yes', 'page=permits',
      'q=cafe&dateFrom=2026-01-01&dateTo=2026-01-01&topic=starting_business&rating=positive&blocked=yes&page=start']) {
      const result = await (await fetch(`${url}?${filter}`, { headers })).json();
      assert.equal(result.total, 1, filter);
      assert.equal(result.conversations[0].conversationId, 'conversation-a', filter);
    }
    assert.equal((await (await fetch(`${url}?rating=negative`, { headers })).json()).total, 0);
    assert.equal((await (await fetch(`${url}?rating=unrated&blocked=no&topic=unclassified`, { headers })).json()).total, 26);
    assert.equal((await (await fetch(`${url}?dateTo=2025-12-31`, { headers })).json()).total, 0);
    assert.equal((await (await fetch(`${url}?topic=legal&offset=25`, { headers })).json()).conversations.length, 0);
    for (const invalid of ['dateFrom=2026-02-30', 'dateTo=not-a-date', 'dateFrom=2026-02-01&dateTo=2026-01-01',
      'quality=unknown', 'quality=help&quality=negative_reply', 'rating=unknown', 'blocked=maybe', 'topic=a&topic=b', 'q=a&q=b', `page=${'x'.repeat(501)}`]) {
      assert.equal((await fetch(`${url}?${invalid}`, { headers })).status, 400, invalid);
    }
    const hidden = await (await fetch(`${url}?q=Hidden`, { headers })).json();
    assert.equal(hidden.total, 0);
    const old = await (await fetch(`${url}?conversationId=older-0`, { headers })).json();
    assert.equal(old.events[0].reconstructed, true);
    assert.deepEqual(old.events.map((item) => item.kind), ['user', 'assistant']);
    assert.deepEqual(old.referralClicks, []);
    assert.equal((await fetch(`${url}?conversationId=missing`, { headers })).status, 404);

    const archive = (conversationId, requestHeaders = headers) => fetch(`${url}/archive`, {
      method: 'POST', headers: { ...requestHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId }),
    });
    const restore = (conversationId, requestHeaders = headers) => fetch(`${url}/restore`, {
      method: 'POST', headers: { ...requestHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId }),
    });
    assert.equal((await fetch(`${url}?archived=true`)).status, 401);
    assert.equal((await restore('conversation-a', {})).status, 401);
    assert.equal((await archive('conversation-a', {})).status, 401);
    for (const invalid of [undefined, '', 42, 'invalid/id', 'x'.repeat(121)]) {
      assert.equal((await archive(invalid)).status, 400);
      assert.equal((await restore(invalid)).status, 400);
    }
    assert.equal((await archive('missing')).status, 404);
    assert.equal((await restore('missing')).status, 404);
    assert.equal((await (await fetch(`${url}?archived=true`, { headers })).json()).total, 0);
    assert.equal(fs.existsSync(process.env.DASHBOARD_CONVERSATION_ARCHIVE_PATH), false);

    const originalLogs = fs.readFileSync(process.env.AI_RESPONSE_LOG_PATH, 'utf8');
    assert.deepEqual(await (await archive('conversation-a')).json(), { conversationId: 'conversation-a', archived: true });
    const archiveContents = fs.readFileSync(process.env.DASHBOARD_CONVERSATION_ARCHIVE_PATH, 'utf8');
    assert.equal((await archive('conversation-a')).status, 200);
    assert.equal(fs.readFileSync(process.env.DASHBOARD_CONVERSATION_ARCHIVE_PATH, 'utf8'), archiveContents);
    assert.equal(fs.readFileSync(process.env.AI_RESPONSE_LOG_PATH, 'utf8'), originalLogs);
    assert.equal((await fetch(`${url}?conversationId=conversation-a`, { headers })).status, 404);
    assert.equal((await (await fetch(`${url}?q=cafe`, { headers })).json()).total, 0);
    assert.equal((await (await fetch(url, { headers })).json()).total, 26);
    assert.equal((await (await fetch(`${url}?offset=25`, { headers })).json()).conversations.length, 1);
    const archivedPage = await (await fetch(`${url}?archived=true&q=cafe`, { headers })).json();
    assert.equal(archivedPage.total, 1);
    assert.equal(archivedPage.conversations[0].conversationId, 'conversation-a');
    assert.equal((await (await fetch(`${url}?archived=true&q=Older`, { headers })).json()).total, 0);
    assert.equal((await fetch(`${url}?archived=true&conversationId=older-0`, { headers })).status, 404);
    assert.equal((await (await fetch(`${url}?archived=true&topic=legal&rating=up&blocked=yes`, { headers })).json()).total, 1);
    const archivedHistory = await (await fetch(`${url}?archived=true&conversationId=conversation-a`, { headers })).json();
    assert.deepEqual(archivedHistory, { ...history, archived: true });
    const combined = await (await fetch(`${url}?archived=all`, { headers })).json();
    assert.equal(combined.total, 27);
    const quality = await (await fetch(`${url}?archived=all&quality=negative_reply&dateFrom=2026-01-01&dateTo=2026-01-31`, { headers })).json();
    assert.equal(quality.total, 1);
    assert.equal(quality.conversations[0].conversationId, 'conversation-a');
    assert.equal(quality.conversations[0].archived, true);
    assert.equal((await (await fetch(`${url}?archived=all&quality=help`, { headers })).json()).total, 0);
    assert.equal((await (await fetch(`${url}?archived=all&quality=negative_reply&dateFrom=2026-02-01`, { headers })).json()).total, 0);

    // New log records for an archived ID do not bring it back to the dashboard.
    fs.appendFileSync(process.env.AI_RESPONSE_LOG_PATH, `${JSON.stringify(entry('chat_response', 9, {
      turn: 4, message: 'New archived message', reply: 'Still retained',
    }))}\n`);
    assert.equal((await (await fetch(`${url}?q=New%20archived`, { headers })).json()).total, 0);

    // Rebuild the server and authenticate a new session: no in-memory state is needed.
    await new Promise((resolve) => server.close(resolve));
    modules.forEach((name) => { delete require.cache[require.resolve(name)]; });
    const restartedApp = express();
    restartedApp.use(express.json());
    restartedApp.use('/api', require('../routes/dashboard'));
    server = restartedApp.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    url = `http://127.0.0.1:${server.address().port}/api/dashboard/conversations`;
    const newSession = { Authorization: `Bearer ${jwt.sign({ role: 'dashboard', username: 'another.staff' }, process.env.JWT_SECRET)}` };
    const persisted = await (await fetch(url, { headers: newSession })).json();
    assert.equal(persisted.total, 26);
    assert.equal(persisted.conversations.some((item) => item.conversationId === 'conversation-a'), false);

    // Storage failures must not report success or remove another conversation.
    const archivePath = process.env.DASHBOARD_CONVERSATION_ARCHIVE_PATH;
    process.env.DASHBOARD_CONVERSATION_ARCHIVE_PATH = path.join(tempDir, 'not-a-directory', 'archive.jsonl');
    fs.writeFileSync(path.join(tempDir, 'not-a-directory'), 'file');
    assert.equal((await archive('older-0')).status, 500);
    assert.equal((await restore('conversation-a')).status, 500);
    process.env.DASHBOARD_CONVERSATION_ARCHIVE_PATH = archivePath;
    assert.equal((await fetch(`${url}?conversationId=older-0`, { headers })).status, 200);

    const retainedLogs = fs.readFileSync(process.env.AI_RESPONSE_LOG_PATH, 'utf8');
    assert.deepEqual(await (await restore('conversation-a')).json(), { conversationId: 'conversation-a', archived: false });
    const restoredMetadata = fs.readFileSync(archivePath, 'utf8');
    assert.ok(restoredMetadata.startsWith(archiveContents));
    assert.equal((await restore('conversation-a')).status, 200);
    assert.equal(fs.readFileSync(archivePath, 'utf8'), restoredMetadata);
    assert.equal(fs.readFileSync(process.env.AI_RESPONSE_LOG_PATH, 'utf8'), retainedLogs);
    assert.equal((await (await fetch(`${url}?archived=true`, { headers })).json()).total, 0);
    assert.equal((await (await fetch(url, { headers })).json()).total, 27);
    const restoredHistory = await (await fetch(`${url}?conversationId=conversation-a`, { headers })).json();
    assert.equal(restoredHistory.messageCount, 3);
    assert.doesNotMatch(JSON.stringify(restoredHistory), /owner@example.com|Hidden/);
    delete require.cache[require.resolve('../lib/conversation-archive')];
    assert.equal(require('../lib/conversation-archive').readArchivedConversationIds().has('conversation-a'), false);

    // A restored conversation can be archived again, including older marker formats.
    assert.equal((await archive('conversation-a')).status, 200);
    assert.equal((await fetch(`${url}?conversationId=conversation-a`, { headers })).status, 404);
    assert.equal((await (await fetch(`${url}?archived=true`, { headers })).json()).total, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previous.log === undefined) delete process.env.AI_RESPONSE_LOG_PATH;
    else process.env.AI_RESPONSE_LOG_PATH = previous.log;
    if (previous.secret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous.secret;
    if (previous.archive === undefined) delete process.env.DASHBOARD_CONVERSATION_ARCHIVE_PATH;
    else process.env.DASHBOARD_CONVERSATION_ARCHIVE_PATH = previous.archive;
    if (previous.review === undefined) delete process.env.DASHBOARD_CONVERSATION_REVIEW_PATH;
    else process.env.DASHBOARD_CONVERSATION_REVIEW_PATH = previous.review;
    modules.forEach((name) => { delete require.cache[require.resolve(name)]; });
  }
});
