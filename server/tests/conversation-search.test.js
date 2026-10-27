'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseConversationFilters, normalizeWebsitePage, conversationSearchSummary, matchesConversationFilters } = require('../lib/conversation-search');

const event = (scope, rating, timestamp, turn = 1) => ({ kind: 'feedback', scope, rating, timestamp, turn, content: '' });

test('search combines inclusive UTC dates, topics, page text and the latest reply and chat ratings', () => {
  const metadata = new Map([[1, { topics: new Set(['funding']), pages: new Set(['https://example.com/funding']) }],
    [2, { topics: new Set(['hidden_topic']), pages: new Set(['https://hidden.example/']) }]]);
  const events = [
    { kind: 'user', turn: 1, timestamp: '2026-01-31T23:59:59Z', content: 'Business loan' },
    { kind: 'assistant', turn: 1, timestamp: '2026-02-01T00:00:00Z', content: 'Reply', blocked: true },
    event('response', 'down', '2026-02-02T00:00:00Z'), event('response', 'up', '2026-02-03T00:00:00Z'),
    event('session', 'sad', '2026-02-04T00:00:00Z', null),
  ];
  for (const records of [events, [...events].reverse()]) {
    const summary = conversationSearchSummary(metadata, records);
    assert.deepEqual(summary.topics, ['funding']);
    assert.deepEqual(summary.pages, ['https://example.com/funding']);
    assert.equal(summary.ratings.includes('down'), false);
    const item = { conversationId: 'chat-a', events: records, ...summary };
    const match = (query) => matchesConversationFilters(item, parseConversationFilters(query));
    assert.equal(match({ q: 'LOAN', dateFrom: '2026-01-31', dateTo: '2026-01-31', topic: 'funding', rating: 'sad', blocked: 'yes', page: 'FUNDING' }), true);
    assert.equal(match({ rating: 'negative' }), true); // Latest chat rating is sad, even though the reply is now positive.
    assert.equal(match({ rating: 'down' }), false);
    assert.equal(match({ blocked: 'no' }), false);
    assert.equal(match({ dateTo: '2026-01-30' }), false);
    assert.equal(match({ dateFrom: '2026-02-05' }), false);
    assert.equal(match({ rating: 'unrated' }), false);
    assert.equal(match({ topic: 'hidden_topic' }), false);
  }
});

test('website normalization removes credentials, query strings and fragments and rejects unsupported addresses', () => {
  assert.equal(normalizeWebsitePage('https://username:password@example.com/help?email=private@example.com#token'), 'https://example.com/help');
  assert.equal(normalizeWebsitePage('javascript:alert(1)'), '');
  assert.equal(normalizeWebsitePage('not a url'), '');
  assert.equal(parseConversationFilters({ page: 'https://example.com/help?tracking=1#section' }).page, 'https://example.com/help');
});

test('written feedback is not a visitor rating and undated history only matches searches without dates', () => {
  const events = [{ kind: 'user', turn: 1, content: 'Question', timestamp: null }, event('session', 'written', null, null)];
  const item = { conversationId: 'legacy', events, ...conversationSearchSummary(new Map(), events) };
  assert.deepEqual(item.topics, ['unclassified']);
  assert.equal(matchesConversationFilters(item, parseConversationFilters({ rating: 'unrated' })), true);
  assert.equal(matchesConversationFilters(item, parseConversationFilters({ dateFrom: '2026-01-01' })), false);
  assert.equal(matchesConversationFilters(item, parseConversationFilters({ topic: 'unclassified' })), true);
});
