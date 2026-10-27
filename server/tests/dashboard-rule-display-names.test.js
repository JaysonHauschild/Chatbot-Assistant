'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

test('rule display names default to immutable IDs, can be renamed, and preserve routing and history keys', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-names-'));
  const settings = { MESSAGE_FILTER_RULES_PATH: path.join(directory, 'rules.json'),
    DASHBOARD_ROLLBACK_DIR: path.join(directory, 'rollback'), AI_RESPONSE_LOG_PATH: path.join(directory, 'responses.jsonl'),
    HUMAN_READABLE_LOG_PATH: path.join(directory, 'transcript.md'), DASHBOARD_AUDIT_LOG_PATH: path.join(directory, 'audit.jsonl'),
    DASHBOARD_ACCOUNTS_PATH: path.join(directory, 'accounts.json'),
    JWT_SECRET: 'display-name-integration-secret' };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  fs.writeFileSync(settings.DASHBOARD_ACCOUNTS_PATH, JSON.stringify({ accounts: [{ id: 'test-admin', username: 'test.admin', role: 'admin', active: true }] }));
  const original = { id: 'loan_help', action: 'respond', pattern: 'loan', flags: 'im', reply: 'A saved loan reply.',
    priority: 90, negativePattern: 'personal', intents: ['funding'] };
  fs.writeFileSync(settings.MESSAGE_FILTER_RULES_PATH, JSON.stringify({ version: 1, rules: [original] }));
  const { readMessageFilterRuleStore, writeMessageFilterRuleStore, getCompiledMessageFilterRules } = require('../lib/message-filter-rules');
  const { filterMessage } = require('../message-filter');
  assert.equal(readMessageFilterRuleStore().rules[0].displayName, 'loan_help');
  writeMessageFilterRuleStore(readMessageFilterRuleStore());
  assert.equal(JSON.parse(fs.readFileSync(settings.MESSAGE_FILTER_RULES_PATH)).rules[0].displayName, 'loan_help');
  const app = express(); app.use(express.json()); app.use('/api', require('../routes/dashboard'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => {
    server.closeAllConnections(); server.close();
    for (const key of Object.keys(settings)) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api/dashboard/message-filter/rules`;
  const headers = { Authorization: `Bearer ${jwt.sign({ sub: 'test-admin', role: 'admin' }, settings.JWT_SECRET)}`, 'Content-Type': 'application/json' };
  const request = (suffix, method, body) => fetch(base + suffix, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const draft = { regexPattern: original.pattern, reply: original.reply, action: 'respond' };
  const rename = await request('/loan_help', 'PUT', { ...draft, id: 'attempt_to_change_id', displayName: 'Business loan help' });
  assert.equal(rename.status, 200);
  assert.deepEqual((await rename.json()).id, 'loan_help');
  assert.deepEqual(readMessageFilterRuleStore().rules[0], { ...original, displayName: 'Business loan help' });
  const listed = await (await request('', 'GET')).json();
  assert.equal(listed.items[0].displayName, 'Business loan help');
  assert.equal(listed.items[0].id, 'loan_help');
  const auditResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/dashboard/audit-log?q=Business%20loan%20help`, { headers });
  assert.equal(auditResponse.status, 200);
  const audit = await auditResponse.json();
  assert.ok(audit.items.some(entry => entry.action === 'message_filter_rule_renamed' && entry.target.id === 'loan_help' && entry.target.displayName === 'Business loan help'));
  assert.equal((await request('/loan_help', 'PUT', draft)).status, 200);
  assert.equal(readMessageFilterRuleStore().rules[0].displayName, 'Business loan help');
  for (const displayName of ['', '   ', null, 42, 'a'.repeat(121)]) {
    assert.equal((await request('/loan_help', 'PUT', { ...draft, displayName })).status, 400);
  }
  assert.equal(readMessageFilterRuleStore().rules[0].displayName, 'Business loan help');
  const added = await request('', 'POST', { id: 'greeting', displayName: 'Ignored initial override', keywords: 'hello', reply: 'Welcome' });
  assert.equal(added.status, 200);
  assert.equal((await added.json()).displayName, 'greeting');
  assert.equal((await request('/greeting', 'PUT', { keywords: 'hello', reply: 'Welcome', displayName: 'Business loan help' })).status, 200);
  assert.equal((await request('/order', 'PUT', { ids: ['greeting', 'loan_help'] })).status, 200);
  assert.equal(readMessageFilterRuleStore().rules[1].displayName, 'Business loan help');
  const result = filterMessage('I need a loan', { topicTag: 'funding', rules: getCompiledMessageFilterRules() });
  assert.equal(result.ruleId, 'loan_help');
  assert.equal(result.reply, original.reply);
  const snapshots = fs.readdirSync(path.join(directory, 'rollback', 'message_filter'));
  assert.ok(snapshots.length > 0);
  const snapshotMetadata = snapshots.map(file => JSON.parse(fs.readFileSync(path.join(directory, 'rollback', 'message_filter', file))));
  assert.ok(snapshotMetadata.some(item => item.metadata?.rule_id === 'loan_help' && item.metadata?.displayName === 'Business loan help'));
});
