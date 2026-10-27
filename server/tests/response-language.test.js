'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { filterMessage, filterMessageBeforeClassification, hasPotentialPredefinedResponse } = require('../message-filter');
const { normalizeResponseLanguage } = require('../lib/response-language');
const { summarizeMessageFilterRule } = require('../lib/message-filter-rules');

const rules = [
  { id: 'english', action: 'respond', pattern: /business|negocio/i, reply: 'English guidance', priority: 99 },
  { id: 'spanish', action: 'respond', language: 'es', pattern: /negocio/i, reply: 'Orientación en español' },
];

test('native language takes precedence over English priority and omitted languages remain English', () => {
  assert.equal(filterMessage('negocio', { rules, language: 'es-MX' }).ruleId, 'spanish');
  assert.equal(filterMessage('business', { rules }).ruleId, 'english');
  assert.equal(filterMessage('business', { rules, language: 'es' }).predefined, false);
  assert.equal(filterMessageBeforeClassification('negocio', { rules, language: 'es', topicCandidates: ['general'] }).ruleId, 'spanish');
  assert.equal(hasPotentialPredefinedResponse('business', { rules, language: 'es' }), false);
  assert.equal(summarizeMessageFilterRule({ action: 'respond' }, 0).language, 'en');
});

test('language selection preserves block precedence and exclusions', () => {
  const blocked = { id: 'block', action: 'block', language: 'en', pattern: /negocio/i, message: 'Blocked' };
  assert.equal(filterMessage('negocio', { rules: [...rules, blocked], language: 'es' }).blocked, true);
  assert.equal(filterMessageBeforeClassification('negocio', { rules: [...rules, blocked], language: 'es' }).blocked, true);
  assert.equal(filterMessage('negocio personal', { rules: [{ ...rules[1], negativePattern: /personal/i }], language: 'es' }).predefined, false);
  assert.equal(normalizeResponseLanguage(' ES-mx '), 'es');
  assert.throws(() => normalizeResponseLanguage('not a language'));
  assert.throws(() => normalizeResponseLanguage(null));
});


test('French locales select French replies before English rules', () => {
  const frenchRules = [...rules, { id: 'french', action: 'respond', language: 'fr', pattern: /business|entreprise/i, reply: 'Conseils en français' }];
  assert.equal(normalizeResponseLanguage('fr-CA'), 'fr');
  assert.equal(filterMessage('business', { rules: frenchRules, language: 'fr-FR' }).ruleId, 'french');
  assert.equal(filterMessageBeforeClassification('entreprise', { rules: frenchRules, language: 'fr', topicCandidates: ['general'] }).ruleId, 'french');
  assert.equal(hasPotentialPredefinedResponse('entreprise', { rules: frenchRules, language: 'fr' }), true);
  assert.equal(hasPotentialPredefinedResponse('negocio', { rules: frenchRules, language: 'fr' }), false);
});
