'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRuleEngine, compileRule, compileRules, buildKeywordPattern, normalizeLanguage, ruleLanguage } = require('..');

const respond = (id, extra = {}) => ({ id, pattern: /help/i, action: 'respond', reply: id, ...extra });

test('legacy definitions without an action remain inactive', () => {
  const engine = createRuleEngine({ rules: [respond('unfinished', { action: undefined }), respond('active')] });
  assert.equal(engine.getRules().length, 2);
  assert.equal(engine.filterMessage('help').ruleId, 'active');
  assert.equal(engine.filterMessageBeforeClassification('help', { inferRuleTopics: true }).ruleId, 'active');
});

test('blocks take precedence over responses and block order is preserved', () => {
  const engine = createRuleEngine({ rules: [respond('reply', { priority: 999 }),
    { id: 'first-block', pattern: 'help', action: 'block', message: 'Stopped' },
    { id: 'second-block', pattern: 'help', action: 'block', priority: 1000, message: 'Later' }] });
  assert.deepEqual(engine.filterMessage('HELP', { language: 'es' }), { blocked: true, ruleId: 'first-block', reply: 'Stopped' });
  assert.deepEqual(engine.filterMessageBeforeClassification('HELP'), {
    blocked: true, ruleId: 'first-block', reply: 'Stopped', classifierBypassed: true, topicTag: 'general', userIntentTag: 'general',
  });
});

test('topic and user-intent scores outrank numeric priority, with stable ties', () => {
  const engine = createRuleEngine({ rules: [
    respond('generic', { priority: 10000 }),
    respond('topic', { intents: [' Billing '] }),
    respond('specific', { intents: ['billing'], userIntents: ['action ready'] }),
    respond('same-score-later', { intents: ['billing'], userIntents: ['action_ready'] }),
  ] });
  assert.equal(engine.filterMessage('help', { topicTag: 'BILLING', userIntentTag: 'Action-ready' }).ruleId, 'specific');
  assert.equal(engine.filterMessage('help', { topicTag: 'billing', userIntentTag: 'informational' }).ruleId, 'topic');
  const priorities = createRuleEngine({ rules: [respond('earlier'), respond('higher', { priority: 10 })] });
  assert.equal(priorities.filterMessage('help').ruleId, 'higher');
});

test('previous context breaks ties and only substitutes for unknown current topics', () => {
  const engine = createRuleEngine({ rules: [
    respond('billing', { intents: ['billing'] }),
    respond('context', { intents: ['billing'], prevIntents: ['billing'] }),
  ] });
  assert.equal(engine.filterMessage('help', { topicTag: 'general', prevTopicTag: 'billing' }).ruleId, 'context');
  assert.equal(engine.filterMessage('help', { topicTag: 'shipping', prevTopicTag: 'billing' }).llmFallback, true);
  const custom = createRuleEngine({ unknownTopic: 'not known', rules: [respond('billing', { intents: ['billing'] })] });
  assert.equal(custom.filterMessage('help', { topicTag: 'not-known', prevTopicTag: 'billing' }).ruleId, 'billing');
});

test('exclusions and Unicode-normalized matching apply without changing the caller message', () => {
  const engine = createRuleEngine({ rules: [
    respond('punctuation', { pattern: "it's ready - now", negativePattern: "don't" }),
    respond('wide', { pattern: undefined, keywords: ['hello'] }),
  ] });
  assert.equal(engine.filterMessage('it’s ready — now').ruleId, 'punctuation');
  assert.equal(engine.filterMessage('don’t say it’s ready — now').llmFallback, true);
  assert.equal(engine.filterMessage('ｈｅｌｌｏ').ruleId, 'wide');
  const input = 'nothing  changed';
  assert.equal(engine.filterMessage(input).message, input);
});

test('replacement rules run in order with capture groups only when no terminal rule matches', () => {
  const rules = [
    { id: 'labels', pattern: '(old) label', flags: 'gi', action: 'replace', replacement: '$1 product' },
    { id: 'cleanup', pattern: /old/gi, action: 'replace', replacement: 'new' },
    { id: 'excluded', pattern: /product/g, negativePattern: /new/, action: 'replace', replacement: 'ignored' },
  ];
  const engine = createRuleEngine({ rules });
  const replacement = { message: 'new product and new product', appliedRules: ['labels', 'cleanup'] };
  assert.deepEqual(engine.applyMessageReplacements('old label and OLD label'), replacement);
  const result = engine.filterMessage('old label and OLD label');
  assert.equal(result.llmFallback, true);
  assert.deepEqual(result.appliedRules, replacement.appliedRules);
  assert.equal(result.message, replacement.message);
  const terminal = engine.filterMessage('help', { rules: [...rules, respond('saved')] });
  assert.equal(terminal.ruleId, 'saved');
});

test('language selection uses primary codes, default-language configuration, and native rules', () => {
  const engine = createRuleEngine({ rules: [respond('english'), respond('spanish', { language: 'es-MX' })] });
  assert.equal(engine.filterMessage('help', { language: 'es-ES' }).ruleId, 'spanish');
  assert.equal(engine.filterMessage('help').ruleId, 'english');
  assert.equal(engine.filterMessage('help', { language: 'fr' }).llmFallback, true);
  assert.equal(engine.hasPotentialPredefinedResponse('help', { language: 'fr' }), false);
  const french = createRuleEngine({ defaultLanguage: 'fr-CA', rules: [respond('untagged')] });
  assert.equal(french.filterMessage('help', { language: 'fr-FR' }).ruleId, 'untagged');
  assert.equal(french.filterMessage('help', { language: 'en' }).llmFallback, true);
  assert.equal(normalizeLanguage('es-MX'), 'es');
  assert.equal(ruleLanguage({}), 'en');
  for (const language of ['', null, 42, 'not a language']) assert.throws(() => normalizeLanguage(language), /language/);
});

test('classifier bypass requires a stable winner across every candidate combination', () => {
  const stable = createRuleEngine({ rules: [respond('billing', { intents: ['billing'] })] });
  assert.equal(stable.filterMessageBeforeClassification('help'), null);
  assert.equal(stable.filterMessageBeforeClassification('help', { inferRuleTopics: true }).ruleId, 'billing');
  const ambiguous = createRuleEngine({ rules: [respond('billing', { intents: ['billing'] }), respond('shipping', { intents: ['shipping'] })] });
  assert.equal(ambiguous.filterMessageBeforeClassification('help', { inferRuleTopics: true }), null);
  const intentSensitive = createRuleEngine({ rules: [respond('generic'), respond('specific', { userIntents: ['action_ready'] })] });
  assert.equal(intentSensitive.filterMessageBeforeClassification('help', { topicCandidates: ['general'], userIntentCandidates: ['general', 'action_ready'] }), null);
});

test('potential-response checks deliberately ignore topic eligibility and honor exclusions', () => {
  const engine = createRuleEngine({ rules: [respond('billing', { intents: ['billing'], negativePattern: /ignore/ })] });
  assert.equal(engine.hasPotentialPredefinedResponse('help', { topicTag: 'shipping' }), true);
  assert.equal(engine.hasPotentialPredefinedResponse('ignore help'), false);
  assert.equal(engine.filterMessage('help', { topicTag: 'shipping' }).llmFallback, true);
});

test('application eligibility and fallback text are configurable rather than embedded policy', () => {
  const generic = createRuleEngine({ rules: [respond('generic')] });
  assert.equal(generic.filterMessage('help', { topicTag: 'any_other_topic' }).ruleId, 'generic');
  const configured = createRuleEngine({ rules: [respond('generic')], canRespond: (_rule, context) => context.topicTag !== 'restricted' });
  assert.equal(configured.filterMessage('help', { topicTag: 'restricted' }).llmFallback, true);
  const replies = createRuleEngine({ defaultReply: 'Contact the team', blockedReply: 'Blocked locally', rules: [
    { id: 'missing-reply', pattern: /reply/, action: 'respond' },
    { id: 'missing-message', pattern: /stop/, action: 'block' },
  ] });
  assert.equal(replies.filterMessage('reply').reply, 'Contact the team');
  assert.equal(replies.filterMessageBeforeClassification('reply', { topicCandidates: ['general'] }).reply, 'Contact the team');
  assert.equal(replies.filterMessage('stop').reply, 'Blocked locally');
  const invalidPolicy = createRuleEngine({ rules: [respond('generic')], canRespond: () => Promise.resolve(false) });
  assert.throws(() => invalidPolicy.filterMessage('help'), /synchronous boolean/);
});

test('static snapshots, per-call overrides, and dynamic providers remain isolated', () => {
  const input = [respond('original', { intents: ['billing'] })];
  const engine = createRuleEngine({ rules: input });
  input[0].id = 'changed'; input[0].intents.push('shipping');
  const inspected = engine.getRules(); inspected[0].id = 'also-changed'; inspected[0].intents.push('shipping');
  assert.equal(engine.filterMessage('help', { topicTag: 'billing' }).ruleId, 'original');
  assert.equal(engine.filterMessage('help', { topicTag: 'shipping' }).llmFallback, true);
  assert.equal(engine.filterMessage('help', { rules: [respond('override')] }).ruleId, 'override');
  let current = [respond('first')];
  const dynamic = createRuleEngine({ getRules: () => current });
  assert.equal(dynamic.filterMessage('help').ruleId, 'first');
  current = [respond('second')];
  assert.equal(dynamic.filterMessage('help').ruleId, 'second');
});

test('IDs and display names remain distinct and stateful input regexes are not mutated', () => {
  const pattern = /help/gi; pattern.lastIndex = 2;
  const engine = createRuleEngine({ rules: [respond('stable-id', { displayName: 'Editable label', pattern })] });
  for (let index = 0; index < 3; index++) assert.equal(engine.filterMessage('help').ruleId, 'stable-id');
  assert.equal(pattern.lastIndex, 2);
  assert.equal(engine.getRules()[0].displayName, 'Editable label');
  assert.equal(compileRule(respond('legacy')).displayName, 'legacy');
});

test('keyword compilation treats punctuation literally and explicit empty flags stay case-sensitive', () => {
  const pattern = buildKeywordPattern([' A+B ', 'x.y', '', '(test)']);
  const regex = new RegExp(pattern);
  assert.equal(regex.test('A+B'), true); assert.equal(regex.test('xxxy'), false);
  const engine = createRuleEngine({ rules: [respond('literal', { pattern: 'Help', flags: '' })] });
  assert.equal(engine.filterMessage('Help').ruleId, 'literal');
  assert.equal(engine.filterMessage('help').llmFallback, true);
});

test('invalid definitions fail early without evaluating messages or loading external services', () => {
  const invalid = [
    { action: 'respond', pattern: /help/ }, respond('', {}), respond('bad', { pattern: '[' }),
    respond('bad', { action: 'unknown' }), respond('bad', { intents: 'billing' }), respond('bad', { reply: 42 }),
    respond('bad', { priority: NaN }), respond('bad', { language: '' }),
  ];
  for (const rule of invalid) assert.throws(() => compileRule(rule));
  assert.throws(() => compileRules([respond('same'), respond('same')]), /Duplicate rule/);
  assert.throws(() => createRuleEngine({ getRules: true }), /getRules/);
  assert.throws(() => createRuleEngine({ canRespond: true }), /canRespond/);
  assert.throws(() => createRuleEngine({ unknownTopic: '' }), /nonempty/);
  const engine = createRuleEngine();
  assert.equal(engine.filterMessage(null).message, null);
  assert.equal(engine.filterMessageBeforeClassification(null), null);
  assert.equal(engine.hasPotentialPredefinedResponse(null), false);
});
