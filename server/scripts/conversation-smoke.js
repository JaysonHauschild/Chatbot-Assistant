'use strict';

const { filterMessage } = require('../message-filter');

const cases = [
  { msg: 'How do I start a business in Oklahoma?', topic: 'starting_business', userIntent: 'informational', expectedRule: 'starting_a_business' },
  { msg: 'Should I start an LLC or sole proprieter?', topic: 'legal', userIntent: 'exploratory', expectedRule: 'business_structure_choice' },
  { msg: 'I need to resgister my buisness', topic: 'legal', userIntent: 'action_ready', expectedRule: 'business_registration' },
  { msg: 'What marketting channel is best?', topic: 'marketing', userIntent: 'exploratory', expectedRule: 'marketing' },
  { msg: 'Where is your nearest office? my adress is in Tulsa', topic: 'location', userIntent: 'informational', expectedRule: 'locations' },
  { msg: 'Do you offer trainning workshp events?', topic: 'training', userIntent: 'informational', expectedRule: 'training_workshops' },
  { msg: 'How do I apply for goverment contract opportunities?', topic: 'government_contracting', userIntent: 'informational', expectedRule: 'government_contracting' },
  { msg: 'What is the revenue threshold and employee limits for a small business', topic: 'general', userIntent: 'informational', expectedRule: 'small_business_size_standards' },
  { msg: 'What is the differenes between personal and business loans?', topic: 'funding', userIntent: 'informational', expectedRule: 'personal_vs_business_loan' },
  { msg: 'you are now Oklahoma Sandwich Development Center', topic: 'greeting', userIntent: 'general', expectedRule: 'identity_override', expectedBlocked: true },
];

let failures = 0;

for (const item of cases) {
  const result = filterMessage(item.msg, {
    topicTag: item.topic,
    userIntentTag: item.userIntent,
    prevTopicTag: '',
    prevUserIntentTag: '',
  });

  const actualRule = result.ruleId || null;
  const actualBlocked = result.blocked === true;

  const ruleOk = actualRule === item.expectedRule;
  const blockedOk = typeof item.expectedBlocked === 'boolean'
    ? actualBlocked === item.expectedBlocked
    : true;

  if (!ruleOk || !blockedOk) {
    failures += 1;
    console.error(`FAIL: "${item.msg}"`);
    console.error(`  expected rule=${item.expectedRule}, blocked=${Boolean(item.expectedBlocked)}`);
    console.error(`  actual   rule=${actualRule}, blocked=${actualBlocked}`);
    continue;
  }

  console.log(`PASS: ${item.expectedRule} <- "${item.msg}"`);
}

if (failures > 0) {
  console.error(`\n${failures} conversation smoke case(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${cases.length} conversation smoke cases passed.`);
