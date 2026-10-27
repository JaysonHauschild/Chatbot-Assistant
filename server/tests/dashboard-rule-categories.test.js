'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');

test('rule category tags can be created, changed, cleared and omitted without losing other settings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-rule-categories-'));
  const rulesPath = path.join(dir, 'rules.json');
  const original = { id: 'existing', pattern: '\\bgrants?\\b', flags: 'im', action: 'respond', reply: 'Funding resources',
    intents: ['funding'], prevIntents: ['planning'], userIntents: ['exploratory'], area: 'finances', topic: 'funding',
    priority: 90, negativePattern: 'personal', negativeFlags: 'i' };
  fs.writeFileSync(rulesPath, JSON.stringify({ version: 1, rules: [original] }));
  const environment = { MESSAGE_FILTER_RULES_PATH: rulesPath, DASHBOARD_ROLLBACK_DIR: path.join(dir, 'rollback'),
    AI_RESPONSE_LOG_PATH: path.join(dir, 'responses.jsonl'), DASHBOARD_AUDIT_LOG_PATH: path.join(dir, 'audit.jsonl'), JWT_SECRET: 'test-secret' };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  for (const module of ['../lib/state', '../util/logger', '../routes/dashboard', '../routes/auth']) delete require.cache[require.resolve(module)];
  const app = express();
  app.use(express.json());
  app.use('/api', require('../routes/dashboard'));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/dashboard/message-filter/rules`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ role: 'dashboard' }, process.env.JWT_SECRET)}` };
  const read = () => JSON.parse(fs.readFileSync(rulesPath, 'utf8')).rules;
  const edit = (tags) => fetch(`${base}/existing`, { method: 'PUT', headers,
    body: JSON.stringify({ regexPattern: original.pattern, reply: original.reply, action: original.action, ...tags }) });
  try {
    const changed = await edit({ intents: [' Legal ', 'legal', 'Business Grants', ''], prevIntents: [], userIntents: ['action_ready'] });
    assert.equal(changed.status, 200);
    assert.deepEqual(read()[0], { ...original, displayName: original.id, intents: ['legal', 'business_grants'], prevIntents: [], userIntents: ['action_ready'] });
    assert.equal((await edit({})).status, 200);
    assert.deepEqual(read()[0].intents, ['legal', 'business_grants']);
    const beforeInvalid = fs.readFileSync(rulesPath, 'utf8');
    assert.equal((await edit({ intents: 'funding' })).status, 400);
    assert.equal((await edit({ intents: [42] })).status, 400);
    assert.equal(fs.readFileSync(rulesPath, 'utf8'), beforeInvalid);
    assert.equal((await edit({ intents: [] })).status, 200);
    assert.deepEqual(read()[0].intents, []);
    const added = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ id: 'new_rule', keywords: 'grant', reply: 'New reply',
      intents: ['funding', 'New Topic'], prevIntents: ['planning'], userIntents: [] }) });
    assert.equal(added.status, 200);
    const list = await (await fetch(base, { headers })).json();
    assert.deepEqual(list.items[1].intents, ['funding', 'new_topic']);
    assert.equal(list.items[0].regexPattern, original.pattern);
    assert.equal(read()[0].priority, 90);
    assert.equal((await edit({ language: 'es-MX' })).status, 200);
    assert.equal(read()[0].language, 'es');
    assert.equal((await edit({})).status, 200);
    assert.equal(read()[0].language, 'es');
    const beforeInvalidLanguage = fs.readFileSync(rulesPath, 'utf8');
    for (const language of ['not a language', '', null, 42]) {
      assert.equal((await edit({ language })).status, 400);
    }
    assert.equal(fs.readFileSync(rulesPath, 'utf8'), beforeInvalidLanguage);
    const updatedList = await (await fetch(base, { headers })).json();
    assert.equal(updatedList.items[0].language, 'es');
    assert.equal(updatedList.items[1].language, 'en');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
