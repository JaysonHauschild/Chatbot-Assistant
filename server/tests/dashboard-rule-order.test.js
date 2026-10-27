'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function writeRuleStore(filePath, rules) {
  fs.writeFileSync(filePath, `${JSON.stringify({ version: 1, rules }, null, 2)}\n`, 'utf8');
}

test('PUT /api/dashboard/message-filter/rules/order reorders rules without deleting them', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-rule-order-test-'));
  const messageFilterRulesPath = path.join(tempDir, 'message-filter-rules.json');
  const logPath = path.join(tempDir, 'ai-responses.jsonl');

  writeRuleStore(messageFilterRulesPath, [
    {
      id: 'first_rule',
      pattern: 'first',
      flags: 'i',
      action: 'respond',
      intents: ['funding', 'planning'],
      prevIntents: ['starting_business'],
      userIntents: ['exploratory'],
      reply: 'First',
    },
    { id: 'second_rule', pattern: 'second', flags: 'i', action: 'respond', reply: 'Second' },
    { id: 'third_rule', pattern: 'third', flags: 'i', action: 'block', message: 'Third' },
  ]);

  process.env.MESSAGE_FILTER_RULES_PATH = messageFilterRulesPath;
  process.env.AI_RESPONSE_LOG_PATH = logPath;
  process.env.DASHBOARD_ROLLBACK_DIR = path.join(tempDir, 'rollback');
  process.env.JWT_SECRET = 'test-secret';

  clearModule('../lib/state');
  clearModule('../util/logger');
  clearModule('../routes/dashboard');
  clearModule('../routes/auth');
  const dashboardRouter = require('../routes/dashboard');

  const app = express();
  app.use(express.json());
  app.use('/api', dashboardRouter);

  const token = jwt.sign({ role: 'dashboard' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const server = app.listen(0);
  const { port } = server.address();

  try {
    const listResponse = await fetch(`http://127.0.0.1:${port}/api/dashboard/message-filter/rules`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(listResponse.status, 200);
    const listData = await listResponse.json();
    assert.equal(listData.totalRules, 3);
    assert.deepEqual(listData.items.map((item) => item.id), ['first_rule', 'second_rule', 'third_rule']);
    assert.deepEqual(listData.items.map((item) => item.order), [1, 2, 3]);
    assert.equal(listData.items[0].pattern, '/first/i');
    assert.equal(listData.items[0].reply, 'First');
    assert.deepEqual(listData.items[0].intents, ['funding', 'planning']);
    assert.deepEqual(listData.items[0].prevIntents, ['starting_business']);
    assert.deepEqual(listData.items[0].userIntents, ['exploratory']);

    const orders = [
      ['second_rule', 'first_rule', 'third_rule'],
      ['second_rule', 'third_rule', 'first_rule'],
      ['third_rule', 'second_rule', 'first_rule'],
    ];

    for (const ids of orders) {
      const reorderResponse = await fetch(`http://127.0.0.1:${port}/api/dashboard/message-filter/rules/order`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids }),
      });
      assert.equal(reorderResponse.status, 200);
      const reorderData = await reorderResponse.json();
      assert.equal(reorderData.ok, true);
    }

    const relistResponse = await fetch(`http://127.0.0.1:${port}/api/dashboard/message-filter/rules`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(relistResponse.status, 200);
    const relistData = await relistResponse.json();
    assert.equal(relistData.totalRules, 3);
    assert.deepEqual(relistData.items.map((item) => item.id), ['third_rule', 'second_rule', 'first_rule']);

    const nextStore = JSON.parse(fs.readFileSync(messageFilterRulesPath, 'utf8'));
    assert.deepEqual(nextStore.rules.map((rule) => rule.id), ['third_rule', 'second_rule', 'first_rule']);

    const invalidResponse = await fetch(`http://127.0.0.1:${port}/api/dashboard/message-filter/rules/order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ids: ['second_rule', 'second_rule', 'third_rule'] }),
    });
    assert.equal(invalidResponse.status, 400);
  } finally {
    server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.MESSAGE_FILTER_RULES_PATH;
    delete process.env.AI_RESPONSE_LOG_PATH;
    delete process.env.DASHBOARD_ROLLBACK_DIR;
    delete process.env.JWT_SECRET;
    clearModule('../routes/dashboard');
    clearModule('../routes/auth');
    clearModule('../lib/state');
    clearModule('../util/logger');
  }
});

test('GET /api/dashboard/message-filter/rules lists compact JSON rule-store entries', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-rule-list-test-'));
  const messageFilterRulesPath = path.join(tempDir, 'message-filter-rules.json');
  const logPath = path.join(tempDir, 'ai-responses.jsonl');

  writeRuleStore(messageFilterRulesPath, [
    { id: 'compact_first', pattern: 'first', flags: 'i', action: 'respond', reply: 'First' },
    { id: 'compact_second', pattern: 'second', flags: 'i', action: 'block', message: 'Second' },
  ]);

  process.env.MESSAGE_FILTER_RULES_PATH = messageFilterRulesPath;
  process.env.AI_RESPONSE_LOG_PATH = logPath;
  process.env.DASHBOARD_ROLLBACK_DIR = path.join(tempDir, 'rollback');
  process.env.JWT_SECRET = 'test-secret';

  clearModule('../lib/state');
  clearModule('../util/logger');
  clearModule('../routes/dashboard');
  clearModule('../routes/auth');
  const dashboardRouter = require('../routes/dashboard');

  const app = express();
  app.use(express.json());
  app.use('/api', dashboardRouter);

  const token = jwt.sign({ role: 'dashboard' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const server = app.listen(0);
  const { port } = server.address();

  try {
    const listResponse = await fetch(`http://127.0.0.1:${port}/api/dashboard/message-filter/rules`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(listResponse.status, 200);
    const listData = await listResponse.json();
    assert.equal(listData.totalRules, 2);
    assert.deepEqual(listData.items.map((item) => item.id), ['compact_first', 'compact_second']);
    assert.deepEqual(listData.items.map((item) => item.action), ['respond', 'block']);
    assert.equal(listData.items[0].pattern, '/first/i');
  } finally {
    server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.MESSAGE_FILTER_RULES_PATH;
    delete process.env.AI_RESPONSE_LOG_PATH;
    delete process.env.DASHBOARD_ROLLBACK_DIR;
    delete process.env.JWT_SECRET;
    clearModule('../routes/dashboard');
    clearModule('../routes/auth');
    clearModule('../lib/state');
    clearModule('../util/logger');
  }
});

test('POST /api/dashboard/message-filter/rules appends rules without blank-line buildup', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-rule-add-spacing-test-'));
  const messageFilterRulesPath = path.join(tempDir, 'message-filter-rules.json');
  const logPath = path.join(tempDir, 'ai-responses.jsonl');

  writeRuleStore(messageFilterRulesPath, [
    { id: 'existing_rule', pattern: 'existing', flags: 'i', action: 'respond', reply: 'Existing' },
  ]);

  process.env.MESSAGE_FILTER_RULES_PATH = messageFilterRulesPath;
  process.env.AI_RESPONSE_LOG_PATH = logPath;
  process.env.DASHBOARD_ROLLBACK_DIR = path.join(tempDir, 'rollback');
  process.env.JWT_SECRET = 'test-secret';

  clearModule('../lib/state');
  clearModule('../util/logger');
  clearModule('../routes/dashboard');
  clearModule('../routes/auth');
  const dashboardRouter = require('../routes/dashboard');

  const app = express();
  app.use(express.json());
  app.use('/api', dashboardRouter);

  const token = jwt.sign({ role: 'dashboard' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const server = app.listen(0);
  const { port } = server.address();

  try {
    for (const id of ['added_one', 'added_two']) {
      const response = await fetch(`http://127.0.0.1:${port}/api/dashboard/message-filter/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, keywords: id.replace('_', ' '), reply: `Reply for ${id}` }),
      });
      assert.equal(response.status, 200);
    }

    const nextStore = JSON.parse(fs.readFileSync(messageFilterRulesPath, 'utf8'));
    assert.deepEqual(nextStore.rules.map((rule) => rule.id), ['existing_rule', 'added_one', 'added_two']);
  } finally {
    server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.MESSAGE_FILTER_RULES_PATH;
    delete process.env.AI_RESPONSE_LOG_PATH;
    delete process.env.DASHBOARD_ROLLBACK_DIR;
    delete process.env.JWT_SECRET;
    clearModule('../routes/dashboard');
    clearModule('../routes/auth');
    clearModule('../lib/state');
    clearModule('../util/logger');
  }
});
