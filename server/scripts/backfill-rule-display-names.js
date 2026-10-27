'use strict';

require('dotenv').config({ path: require('node:path').join(__dirname, '../.env'), quiet: true });
const { getMessageFilterRulesPath, readMessageFilterRuleStore, writeMessageFilterRuleStore } = require('../lib/message-filter-rules');

const filePath = getMessageFilterRulesPath();
const store = readMessageFilterRuleStore(filePath);
writeMessageFilterRuleStore(store, filePath);
console.log(`Display names saved for ${store.rules.length} rules in ${filePath}. Existing display names and internal IDs were preserved.`);
