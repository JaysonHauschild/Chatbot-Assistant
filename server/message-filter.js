'use strict';

const { createRuleEngine } = require('rules-kit');
const { getCompiledMessageFilterRules } = require('./lib/message-filter-rules');

// Keep application policy and the live rule source outside the reusable engine.
const engine = createRuleEngine({
  getRules: () => getCompiledMessageFilterRules(),
  defaultReply: 'Please visit https://www.oksbdc.org for more information.',
  canRespond(rule, { topicTag, defaultEligible }) {
    const topics = Array.isArray(rule.intents)
      ? rule.intents.map(tag => tag.trim().toLowerCase().replace(/[\s-]+/g, '_')).filter(Boolean)
      : [];
    if (!topics.length && topicTag === 'out_of_scope') return false;
    if (defaultEligible) return true;
    // A specific high-priority business rule can override broad startup intent.
    return topicTag === 'starting_business' && Number.isFinite(rule.priority) && rule.priority > 45 &&
      !['starting_a_business', 'how_do_i_get_started'].includes(rule.id);
  },
});

module.exports = {
  ...engine,
  get RULES() { return engine.getRules(); },
};
