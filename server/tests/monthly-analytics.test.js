'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMonthlyAnalytics } = require('../lib/monthly-analytics');
const { normalizeAiResponseLogEntry } = require('../util/logger');
const options = { startMonth: '2026-01', endMonth: '2026-03', now: new Date('2026-03-15T00:00:00Z') };
const received = (id, turn, month, session = 'session-a') => ({ event: 'chat_turn_received', conversation_id: id, turn, timestamp: `2026-${month}-10T12:00:00Z`, details: { session_id_hash: session } });
const response = (id, turn, month, routing = {}) => ({ event: 'chat_response', conversation_id: id, turn, timestamp: `2026-${month}-10T12:00:02Z`, routing, classification: { message_intent: 'funding' }, message: { assistant_redacted: 'Reply' } });
const feedback = (id, turn, scope, value) => ({ event: 'chat_feedback', conversation_id: id, turn, timestamp: '2026-04-01T00:00:00Z', feedback: { scope, value } });
const run = (entries, filters = {}) => buildMonthlyAnalytics(entries.map((entry) => typeof entry === 'string' ? entry : JSON.stringify(entry)), { ...options, ...filters });

test('new visit records keep reset conversations together in visit metrics', () => {
  const data = run([
    { ...received('before-reset', 1, '01', 'old-session'), visit_id_hash: 'stable-visit' },
    { ...received('after-reset', 1, '01', 'new-session'), details: { session_id_hash: 'new-session', visit_id_hash: 'stable-visit' } },
  ]);
  assert.equal(data.totals.sessions, 1);
  assert.equal(data.totals.conversations, 2);
  assert.equal(data.totals.chatsPerSession, 2);
});

test('deduplicates telemetry and ratings, groups multiple chats per session, and reconciles categories', () => {
  const receipt = received('a', 1, '01');
  const reply = response('a', 1, '01', { predefined: true, rule_id: 'funding_rule', response_type: 'predefined' });
  const entries = [receipt, receipt, reply, reply,
    { ...received('a', 1, '01'), event: 'message_classified_for_routing', routing: { classification_source: 'gemini' } },
    received('b', 1, '01'), response('b', 1, '01'),
    received('a', 2, '02'), response('a', 2, '02'),
    feedback('a', 1, 'response', 'up'), feedback('a', 1, 'response', 'down'),
    feedback('a', null, 'session', 'happy'), feedback('a', null, 'session', 'sad'),
    feedback('b', null, 'session', 'written'),
    { event: 'dashboard_hide_entry', conversation_id: 'a', turn: 1 },
    { ...received('test', 1, '01'), is_test: true },
  ];
  const data = run(entries);
  const jan = data.months[0];
  assert.equal(data.totals.sessions, 1);
  assert.equal(data.totals.conversations, 2);
  assert.equal(data.totals.userMessages, 3);
  assert.equal(data.totals.messages, 6);
  assert.equal(jan.chatsPerSession, 2);
  assert.equal(jan.messagesPerSession, 2);
  assert.equal(jan.ratedMessages, 1);
  assert.equal(jan.ratedMessageRate, .5);
  assert.equal(jan.ratedConversations, 1);
  assert.equal(jan.ratedConversationRate, .5);
  assert.equal(jan.writtenFeedbackConversations, 1);
  assert.equal(jan.regexTurns, 1);
  assert.equal(jan.aiReplies, 1);
  assert.equal(jan.aiUsedTurns, 2);
  assert.deepEqual(jan.rules, [{ key: 'funding_rule', count: 1 }]);
  assert.deepEqual(jan.categories, [{ key: 'funding', count: 2 }]);
  assert.equal(data.months[1].ratedConversations, 1);
  assert.equal(data.months[2].sessions, 0);
  assert.equal(data.months[2].messagesPerSession, null);
  assert.equal(data.months[2].partial, true);
  assert.equal(run(entries, { traffic: 'test' }).totals.userMessages, 3);
  assert.equal(run(entries, { traffic: 'all' }).totals.userMessages, 3);
  assert.equal(run(entries, { startMonth: '2026-02', endMonth: '2026-02' }).totals.messagesPerSession, 1);
  assert.equal(JSON.stringify(data).includes('session-a'), false);
  assert.equal(JSON.stringify(data).includes('"Reply"'), false);
});

test('uses UTC receipt month, supports legacy logs, and exposes missing identity/date coverage', () => {
  const entries = [
    { ...received('boundary', 1, '01'), timestamp: '2026-01-31T23:59:59Z' },
    { ...response('boundary', 1, '02'), timestamp: '2026-02-01T00:00:01Z' },
    { conversationId: 'legacy', turn: 1, timestamp: '2026-02-01T00:30:00+02:00', bot_reply_redacted: 'Legacy reply', predefined_response: true, predefinedByRule: '__proto__' },
    { ...received('missing-time', 1, '01'), timestamp: 'bad date' },
    { event: 'chat_response', timestamp: '2026-01-01', turn: 1 },
    'bad json', 'null',
  ];
  const data = run(entries);
  assert.equal(data.months[0].userMessages, 2);
  assert.equal(data.months[1].userMessages, 0);
  assert.equal(data.totals.conversationsWithoutSession, 1);
  assert.equal(data.totals.linkedUserMessages, 1);
  assert.equal(data.totals.chatsPerSession, 1);
  assert.equal(data.totals.aiReplies, 1);
  assert.equal(data.totals.regexTurns, 1);
  assert.deepEqual(data.coverage, { invalidLines: 2, excludedRecords: 1, undatedTurns: 1 });
});

test('separates missing-key fallbacks, safety templates, AI attempts, and overwritten regex matches', () => {
  const entries = [received('a', 1, '01'),
    { ...response('a', 1, '01'), event: 'model_call_degraded_response', details: { reason: 'missing_gemini_api_key' } },
    received('b', 1, '01'), { ...response('b', 1, '01'), event: 'safe_template_reply' },
    received('c', 1, '01'), { ...response('c', 1, '01'), event: 'model_call_failed' },
    { ...response('c', 1, '01'), event: 'model_call_degraded_response' },
    received('d', 1, '01'), { ...response('d', 1, '01', { predefined: true }), details: { overridden_rule: 'original_rule' } },
    { ...received('d', 1, '01'), event: 'message_classified_for_routing' },
    received('e', 1, '01')];
  const { totals } = run(entries);
  assert.equal(totals.aiReplies, 0);
  assert.equal(totals.aiUsedTurns, 1);
  assert.equal(totals.regexTurns, 1);
  assert.equal(totals.unknownClassificationTurns, 1);
  assert.equal(totals.assistantMessages, 4);
  assert.equal(totals.categories.reduce((sum, row) => sum + row.count, 0), 5);
  assert.equal(totals.responseTypes.reduce((sum, row) => sum + row.count, 0), 5);
});

test('preserves classification routing metadata through log normalization', () => {
  const entry = normalizeAiResponseLogEntry({ event: 'message_classified_for_routing', routing: { classification_source: 'gemini', classifier_bypassed: false, recommended_route: 'llm_answer' } });
  assert.equal(entry.routing.classification_source, 'gemini');
  assert.equal(entry.routing.classifier_bypassed, false);
  assert.equal(entry.routing.recommended_route, 'llm_answer');
});

test('empty logs produce continuous months and no invented averages', () => {
  const data = run([]);
  assert.equal(data.months.length, 3);
  assert.equal(data.totals.userMessages, 0);
  assert.equal(data.totals.ratedMessageRate, null);
  assert.equal(data.firstRecordedMonth, null);
});

test('reply comparison counts final AI and predefined replies once and excludes other outcomes', () => {
  const predefined = response('canned', 1, '01', { response_type: 'predefined' });
  const entries = [
    received('ai', 1, '01'), response('ai', 1, '01'), response('ai', 1, '01'),
    predefined, predefined,
    { ...response('safety', 1, '01'), event: 'safe_template_reply' },
    { ...response('override', 1, '02', { predefined: true }), details: { overridden_rule: 'rule' } },
    { ...response('blocked', 1, '01', { predefined: true, response_type: 'blocked', rule_id: 'rule' }) },
    { ...response('degraded', 1, '01', { predefined: true }), event: 'model_call_degraded_response' },
    { ...response('error', 1, '01'), event: 'chat_error_response' },
    { ...received('classifier-only', 1, '01'), event: 'message_classified_for_routing', routing: { classification_source: 'gemini' } },
    received('no-reply', 1, '01'),
    { ...response('test-ai', 1, '01'), is_test: true },
  ];
  const data = run(entries);
  assert.equal(data.totals.aiReplies, 1);
  assert.equal(data.totals.predefinedReplies, 3);
  assert.equal(data.totals.assistantMessages, 7);
  assert.equal(data.months[0].predefinedReplies, 2);
  assert.equal(data.months[1].predefinedReplies, 1);
  assert.equal(data.months[2].predefinedReplies, 0);
  assert.equal(run(entries, { traffic: 'test' }).totals.aiReplies, 1);
  assert.equal(run(entries, { traffic: 'test' }).totals.predefinedReplies, 3);
  assert.equal(run([], {}).totals.predefinedReplies, 0);
});


test('excludes all activity from test conversations regardless of record order or traffic option', () => {
  const entries = [
    received('visitor', 1, '01'), response('visitor', 1, '01'),
    { ...feedback('visitor', 1, 'response', 'up'), is_test: true, conversation_id: undefined },
    received('sandbox', 1, '01', 'sandbox-session'), response('sandbox', 1, '01'),
    feedback('sandbox', 1, 'response', 'up'), feedback('sandbox', null, 'session', 'happy'),
    { ...received('sandbox', 2, '02'), test_mode: true },
    { ...received('test', 1, '01'), is_test: true }, response('test', 1, '01'),
    { ...feedback('test', null, 'session', 'written'), is_test: true },
  ];
  for (const traffic of [undefined, 'production', 'test', 'all']) {
    for (const records of [entries, [...entries].reverse()]) {
      const data = run(records, { traffic });
      assert.equal(data.traffic, 'production');
      assert.equal(data.totals.conversations, 1);
      assert.equal(data.totals.sessions, 1);
      assert.equal(data.totals.userMessages, 1);
      assert.equal(data.totals.assistantMessages, 1);
      assert.equal(data.totals.ratedMessages, 0);
      assert.equal(data.totals.ratedConversations, 0);
      assert.equal(data.totals.writtenFeedbackConversations, 0);
      assert.equal(data.months[1].userMessages, 0);
    }
  }
});

test('quality counts final outcomes once, distinguishes deliberate blocks, and keeps topics without a reply', () => {
  const entries = [
    { ...received('missing', 1, '01'), classification: { message_intent: 'licensing' } },
    received('unsure', 1, '01'), { ...response('unsure', 1, '01'), classification: { message_intent: 'funding', unsure_response: true } },
    received('failure', 1, '01'), { ...response('failure', 1, '01'), event: 'chat_error_response', unsure_response: true },
    { ...response('block', 1, '01', { response_type: 'blocked' }), unsure_response: true },
    { ...response('safety', 1, '01'), event: 'safe_template_reply' },
    { ...response('recovered', 1, '01'), unsure_response: true },
    { ...response('recovered', 1, '01'), timestamp: '2026-01-10T12:00:03Z' },
    response('test', 1, '01'), { ...received('test', 1, '01'), test_mode: true },
    { ...response('test2', 1, '01'), unsure_response: true }, { ...feedback('test2', 1, 'response', 'down'), is_test: true },
  ];
  const data = run([...entries, entries[2]]);
  assert.equal(data.totals.userMessages, 6);
  assert.equal(data.totals.noReplyMessages, 1);
  assert.equal(data.totals.unsureReplies, 2);
  assert.equal(data.totals.failedReplies, 1);
  assert.equal(data.totals.helpNeededMessages, 3);
  const funding = data.totals.topicQuality.find((topic) => topic.key === 'funding');
  const licensing = data.totals.topicQuality.find((topic) => topic.key === 'licensing');
  assert.equal(funding.questions, 5);
  assert.equal(funding.helpNeededMessages, 2);
  assert.equal(funding.savedReplies, 1);
  assert.equal(licensing.noReplyMessages, 1);
  assert.equal(data.months[0].helpNeededMessages, 3);
  assert.equal(data.months[1].helpNeededMessages, 0);
  assert.equal(data.totals.negativeReplyRate, null);
  assert.equal(data.totals.negativeConversationRate, null);
  assert.equal(JSON.stringify(data).includes('"Reply"'), false);
});

test('negative ratings use the latest timestamp, deduplicate, and follow the original activity month', () => {
  const rate = (id, turn, scope, value, day) => ({ ...feedback(id, turn, scope, value), timestamp: `2026-04-${day}T00:00:00Z` });
  const entries = [
    received('a', 1, '01'), response('a', 1, '01'),
    received('b', 1, '01'), response('b', 1, '01', { response_type: 'predefined' }),
    received('a', 2, '02'), response('a', 2, '02'),
    received('unrated', 1, '01'), response('unrated', 1, '01'),
    received('missing', 1, '01'), rate('missing', 1, 'response', 'down', '01'),
    rate('a', 1, 'response', 'down', '01'), rate('a', 1, 'response', 'up', '02'),
    rate('b', 1, 'response', 'up', '01'), rate('b', 1, 'response', 'down', '02'),
    rate('b', 1, 'response', 'down', '02'),
    rate('a', 2, 'response', 'down', '02'),
    rate('a', null, 'session', 'sad', '01'), rate('a', null, 'session', 'neutral', '02'),
    rate('b', null, 'session', 'sad', '02'),
    { ...rate('a', 1, 'response', 'down', '03'), is_test: true, conversation_id: undefined },
  ];
  for (const records of [entries, [...entries].reverse()]) {
    const data = run(records);
    assert.equal(data.totals.ratedMessages, 3);
    assert.equal(data.totals.negativeReplies, 2);
    assert.equal(data.totals.negativeReplyRate, 2 / 3);
    assert.equal(data.totals.ratedConversations, 2);
    assert.equal(data.totals.negativeConversations, 1);
    assert.equal(data.totals.negativeConversationRate, .5);
    assert.equal(data.months[0].negativeReplyRate, .5);
    assert.equal(data.months[1].negativeReplyRate, 1);
    assert.equal(data.months[1].negativeConversationRate, 0);
    assert.equal(data.months[2].negativeReplyRate, null);
    assert.equal(data.totals.topicQuality.find((topic) => topic.key === 'funding').negativeReplies, 2);
  }
});


test('quality drill-downs share analytics rules for missing, unsure, failed, blocked, and latest ratings', () => {
  const entries = [];
  const receipt = (id, month = '02', isTest = false) => entries.push({ event: 'chat_turn_received', conversation_id: id, turn: 1, timestamp: `2026-${month}-01T00:00:00Z`, is_test: isTest });
  const reply = (id, extra = {}) => entries.push({ event: 'chat_response', conversation_id: id, turn: 1, timestamp: '2026-02-01T00:00:01Z', ...extra });
  const rating = (id, scope, value, day = '01') => entries.push({ event: 'chat_feedback', conversation_id: id, turn: 1, timestamp: `2026-04-${day}T00:00:00Z`, feedback: { scope, value } });
  receipt('missing'); receipt('unsure'); reply('unsure', { classification: { unsure_response: true } });
  receipt('failed'); reply('failed', { event: 'chat_error_response' });
  receipt('blocked'); reply('blocked', { routing: { response_type: 'blocked' }, classification: { unsure_response: true } });
  receipt('test', '02', true); rating('test', 'session', 'sad');
  receipt('outside', '01'); rating('outside', 'session', 'sad');
  receipt('negative'); reply('negative'); rating('negative', 'response', 'down');
  receipt('changed'); reply('changed'); rating('changed', 'response', 'down'); rating('changed', 'response', 'up', '02');
  rating('changed', 'session', 'sad');
  const lines = entries.map(JSON.stringify);
  const ids = (conversationFilter) => [...buildMonthlyAnalytics(lines, { startMonth: '2026-02', endMonth: '2026-02', conversationFilter })].sort();
  assert.deepEqual(ids('help'), ['failed', 'missing', 'unsure']);
  assert.deepEqual(ids('negative_reply'), ['negative']);
  assert.deepEqual(ids('negative_chat'), ['changed']);
  assert.deepEqual([...buildMonthlyAnalytics(lines, { startMonth: '2026-02', endMonth: '2026-02',
    conversationFilter: 'help', dateFrom: '2026-02-02' })], []);
});


test('counts referral and other OKSBDC clicks by click month without inflating usage', () => {
  const advising = 'https://business.oksbdc.org/reg.aspx?center=64000&mode=counsel&subloc=0';
  const click = (id, month, url = advising, extra = {}) => ({ event: 'advising_link_clicked',
    conversation_id: id, timestamp: `2026-${month}-12T00:00:00Z`, details: { url }, ...extra });
  const entries = [received('a', 1, '01'), response('a', 1, '01'),
    click('a', '02', advising, { turn: 1 }), click('a', '02'),
    click('legacy', '01', 'https://www.oksbdc.org/about/'),
    click('legacy', '01', 'https://oksbdc.org/about'),
    click('other', '02', 'https://www.oksbdc.org/workshops/'),
    click('training', '02', 'https://business.oksbdc.org/reg.aspx?mode=training'),
    click('future', '04'), click('test', '01'), { ...received('test', 1, '01'), is_test: true },
    click('sandbox', '01', advising, { test_mode: true }),
    click('invalid', '01', 'https://oksbdc.org.example.com/about/'),
    click('invalid', '01', 'https://example.com/'), click('invalid', '01', 'not a URL'),
    click('invalid', '01', advising, { timestamp: 'invalid' }),
    click('', '01'), { event: 'dashboard_link_clicked', details: { url: advising } }];
  for (const records of [entries, [...entries].reverse()]) {
    const data = run(records);
    assert.equal(data.totals.advisingReferralClicks, 4);
    assert.equal(data.totals.oksbdcLinkClicks, 6);
    assert.equal(data.totals.userMessages, 1);
    assert.equal(data.totals.conversations, 1);
    assert.equal(data.totals.sessions, 1);
    assert.equal(data.months[0].advisingReferralClicks, 2);
    assert.equal(data.months[1].advisingReferralClicks, 2);
    assert.equal(data.months[1].oksbdcLinkClicks, 4);
    assert.equal(data.months[1].userMessages, 0);
    assert.equal(data.months[2].oksbdcLinkClicks, 0);
    const feb = run(records, { startMonth: '2026-02', endMonth: '2026-02' });
    assert.equal(feb.totals.advisingReferralClicks, 2);
    assert.equal(feb.totals.oksbdcLinkClicks, 4);
  }
  assert.equal(run([]).totals.advisingReferralClicks, 0);
  const normalized = normalizeAiResponseLogEntry(click('old', '01', advising, { details: undefined, url: advising }));
  assert.equal(run([normalized]).totals.advisingReferralClicks, 1);
});


test('referral follow-through counts distinct chats with a sent link and a later click in the same period', () => {
  const url = 'https://business.oksbdc.org/reg.aspx?mode=counsel&center=64000&subloc=0';
  const sent = (id, month, turn = 1) => ({ ...response(id, turn, month),
    message: { assistant_redacted: `Request [advising](${url}).` } });
  const click = (id, month, day = '12') => ({ event: 'advising_link_clicked', conversation_id: id,
    timestamp: `2026-${month}-${day}T00:00:00Z`, details: { url } });
  const entries = [
    sent('repeat', '01'), sent('repeat', '01', 2), click('repeat', '01'), click('repeat', '01'),
    sent('unclicked', '01'),
    { ...response('metadata', 1, '01'), classification: { allowed_links_used: [url] } }, click('metadata', '01'),
    { ...response('legacy', 1, '01'), message: { assistant_redacted: 'See https://www.oksbdc.org/about/.' } },
    sent('later', '01'), click('later', '02'),
    sent('before', '01'), click('before', '01', '01'),
    click('missing-reply', '01'),
    response('no-link', 1, '01'), click('no-link', '01'),
    { ...response('flag-only', 1, '01'), classification: { was_referred: true } },
    sent('test', '01'), click('test', '01'), { ...received('test', 1, '01'), is_test: true },
    sent('old', '12'), click('old', '01'),
  ];
  for (const records of [entries, [...entries].reverse()]) {
    const data = run(records);
    assert.equal(data.totals.advisingLinkChats, 6);
    assert.equal(data.totals.advisingClickedChats, 3);
    assert.equal(data.totals.advisingChatClickRate, .5);
    assert.equal(data.months[0].advisingLinkChats, 6);
    assert.equal(data.months[0].advisingClickedChats, 2);
    assert.equal(data.months[0].advisingChatClickRate, 2 / 6);
    assert.equal(data.months[1].advisingLinkChats, 0);
    assert.equal(data.months[1].advisingChatClickRate, null);
    const feb = run(records, { startMonth: '2026-02', endMonth: '2026-02' });
    assert.equal(feb.totals.advisingClickedChats, 0);
    assert.equal(feb.totals.advisingLinkChats, 0);
  }
  assert.equal(run([]).totals.advisingChatClickRate, null);
});


test('all-chat referral rate deduplicates clicks and includes active chats without a referral in the period', () => {
  const url = 'https://business.oksbdc.org/reg.aspx?mode=counsel';
  const click = (id, month) => ({ event: 'advising_link_clicked', conversation_id: id,
    timestamp: `2026-${month}-12T00:00:00Z`, details: { url } });
  const entries = [received('repeat', 1, '01'), received('repeat', 2, '01'),
    received('repeat', 3, '02'), click('repeat', '01'), click('repeat', '01'), click('repeat', '02'),
    received('no-referral', 1, '01'),
    { ...response('earlier-referral', 1, '01'), timestamp: '2025-12-20T00:00:00Z', message: { assistant_redacted: url } },
    received('earlier-referral', 2, '01'), click('earlier-referral', '01'),
    click('missing-history', '01'),
    { ...received('test', 1, '01'), is_test: true }, click('test', '01')];
  for (const records of [entries, [...entries].reverse()]) {
    const data = run(records);
    assert.equal(data.totals.conversations, 3);
    assert.equal(data.totals.advisingClickChats, 2);
    assert.equal(data.totals.advisingAllChatClickRate, 2 / 3);
    assert.equal(data.totals.advisingClickedChats, 0);
    assert.equal(data.months[0].advisingClickChats, 2);
    assert.equal(data.months[1].advisingClickChats, 1);
    assert.equal(data.months[1].advisingAllChatClickRate, 1);
    assert.equal(data.months[2].advisingAllChatClickRate, null);
  }
  const noClicks = run([received('no-click', 1, '01')]);
  assert.equal(noClicks.totals.advisingAllChatClickRate, 0);
  assert.equal(run([click('missing-history', '01')]).totals.advisingAllChatClickRate, null);
});
