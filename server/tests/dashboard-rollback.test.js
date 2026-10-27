'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function serializeRuleStore(rules) {
  return `${JSON.stringify({ version: 1, rules }, null, 2)}\n`;
}

test('dashboard creates rollback snapshot before rule edits and can restore it', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-dashboard-rollback-test-'));
  const messageFilterRulesPath = path.join(tempDir, 'message-filter-rules.json');
  const rollbackDir = path.join(tempDir, 'rollback');
  const logPath = path.join(tempDir, 'ai-responses.jsonl');
  const originalRulesFile = serializeRuleStore([
    { id: 'existing_rule', pattern: 'existing', flags: 'i', action: 'respond', reply: 'Existing' },
  ]);

  fs.writeFileSync(messageFilterRulesPath, originalRulesFile, 'utf8');
  process.env.MESSAGE_FILTER_RULES_PATH = messageFilterRulesPath;
  process.env.DASHBOARD_ROLLBACK_DIR = rollbackDir;
  process.env.AI_RESPONSE_LOG_PATH = logPath;
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
    const addResponse = await fetch(`http://127.0.0.1:${port}/api/dashboard/message-filter/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        id: 'temporary_rule',
        keywords: 'temporary keyword',
        reply: 'Temporary reply',
        action: 'respond',
      }),
    });
    assert.equal(addResponse.status, 200);
    const addData = await addResponse.json();
    assert.match(addData.rollbackSnapshotId, /message_filter_rule_add/);
    assert.match(fs.readFileSync(messageFilterRulesPath, 'utf8'), /temporary_rule/);

    const listResponse = await fetch(`http://127.0.0.1:${port}/api/dashboard/rollback-snapshots`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(listResponse.status, 200);
    const listData = await listResponse.json();
    const addSnapshot = listData.items.find((item) => item.id === addData.rollbackSnapshotId);
    assert.ok(addSnapshot);
    assert.equal(addSnapshot.targetType, 'message_filter');
    assert.equal(addSnapshot.action, 'message_filter_rule_add');
    assert.equal(addSnapshot.metadata.rule_id, 'temporary_rule');

    const restoreResponse = await fetch(`http://127.0.0.1:${port}/api/dashboard/rollback-snapshots/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ targetType: 'message_filter', snapshotId: addData.rollbackSnapshotId }),
    });
    assert.equal(restoreResponse.status, 200);
    const restoreData = await restoreResponse.json();
    assert.equal(restoreData.ok, true);
    assert.match(restoreData.preRestoreSnapshotId, /pre_restore_message_filter_rule_add/);
    assert.equal(fs.readFileSync(messageFilterRulesPath, 'utf8'), originalRulesFile);
  } finally {
    server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.MESSAGE_FILTER_RULES_PATH;
    delete process.env.DASHBOARD_ROLLBACK_DIR;
    delete process.env.AI_RESPONSE_LOG_PATH;
    delete process.env.JWT_SECRET;
    clearModule('../routes/dashboard');
    clearModule('../routes/auth');
    clearModule('../lib/state');
    clearModule('../util/logger');
  }
});
