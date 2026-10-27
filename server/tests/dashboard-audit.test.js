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

test('dashboard writes structured audit entries for rule tests and config edits', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-dashboard-audit-test-'));
  const messageFilterRulesPath = path.join(tempDir, 'message-filter-rules.json');

  writeRuleStore(messageFilterRulesPath, [
    { id: 'existing_rule', pattern: 'existing', flags: 'i', action: 'respond', reply: 'Existing' },
  ]);

  process.env.MESSAGE_FILTER_RULES_PATH = messageFilterRulesPath;
  process.env.AI_RESPONSE_LOG_PATH = path.join(tempDir, 'ai-responses.jsonl');
  process.env.DASHBOARD_AUDIT_LOG_PATH = path.join(tempDir, 'dashboard-audit.jsonl');
  process.env.DASHBOARD_ROLLBACK_DIR = path.join(tempDir, 'rollback');
  process.env.JWT_SECRET = 'test-secret';
  process.env.DASHBOARD_ACCOUNTS_PATH = path.join(tempDir, 'accounts.json');
  fs.writeFileSync(process.env.DASHBOARD_ACCOUNTS_PATH, JSON.stringify({ accounts: [
    { id: 'acct-123', username: 'ops.admin', role: 'dashboard', active: true },
    { id: 'admin-123', username: 'root.admin', role: 'admin', active: true },
    { id: 'viewer-123', username: 'viewer', role: 'readonly', active: true },
  ] }));

  clearModule('../lib/state');
  clearModule('../util/logger');
  clearModule('../routes/dashboard');
  clearModule('../routes/auth');
  const dashboardRouter = require('../routes/dashboard');

  const app = express();
  app.use(express.json());
  app.use('/api', dashboardRouter);

  const token = jwt.sign(
    { sub: 'acct-123', username: 'ops.admin', role: 'dashboard' },
    process.env.JWT_SECRET,
    { expiresIn: '5m' },
  );
  const server = app.listen(0);
  const { port } = server.address();
  const adminToken = jwt.sign({ sub: 'admin-123', username: 'root.admin', role: 'admin' }, process.env.JWT_SECRET);
  const auditCall = (query = '', bearer = adminToken) => fetch(`http://127.0.0.1:${port}/api/dashboard/audit-log${query}`, {
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
  });

  try {
    const draftResponse = await fetch(`http://127.0.0.1:${port}/api/dashboard/message-filter/rules/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'dashboard-audit-test',
        'X-Request-ID': 'audit-test-1',
      },
      body: JSON.stringify({
        keywords: 'audit keyword',
        reply: 'Audit reply with private detail 555-123-4567',
        action: 'respond',
        testMessage: 'audit keyword from user@example.com',
      }),
    });
    assert.equal(draftResponse.status, 200);

    const addResponse = await fetch(`http://127.0.0.1:${port}/api/dashboard/message-filter/rules`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'dashboard-audit-test',
        'X-Request-ID': 'audit-test-2',
      },
      body: JSON.stringify({
        id: 'audit_rule',
        keywords: 'audit keyword',
        reply: 'Audit reply with private detail 555-123-4567',
        action: 'respond',
      }),
    });
    assert.equal(addResponse.status, 200);

    assert.equal((await auditCall('', '')).status, 401);
    assert.equal((await auditCall('', token)).status, 403);
    assert.equal((await auditCall('', jwt.sign({ sub: 'viewer-123', role: 'readonly' }, process.env.JWT_SECRET))).status, 403);
    assert.equal((await auditCall('', jwt.sign({ role: 'admin' }, process.env.JWT_SECRET))).status, 403);
    fs.appendFileSync(process.env.DASHBOARD_AUDIT_LOG_PATH, '\nmalformed JSON\nnull\n[]\n42\n');
    const auditResponse = await auditCall();
    assert.equal(auditResponse.status, 200);
    assert.equal(auditResponse.headers.get('cache-control'), 'no-store');
    const auditData = await auditResponse.json();
    assert.equal(auditData.total, 2);
    assert.equal(auditData.limit, 50);
    assert.equal(auditData.items[0].action, 'message_filter_rule_added');
    const olderPage = await (await auditCall('?limit=1&offset=1')).json();
    assert.equal(olderPage.total, 2);
    assert.equal(olderPage.items.length, 1);
    assert.equal(olderPage.items[0].action, 'message_filter_rule_tested');
    const filtered = await (await auditCall('?q=RULE_TESTED')).json();
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0].action, 'message_filter_rule_tested');
    assert.equal((await (await auditCall('?q=ops.admin')).json()).total, 2);
    assert.equal((await (await auditCall('?q=audit_rule')).json()).total, 1);
    fs.appendFileSync(process.env.DASHBOARD_AUDIT_LOG_PATH, JSON.stringify({ action: 'dashboard_user_locked',
      actor: { username: 'root.admin' }, target: { type: 'dashboard_user', id: 'staff-123' }, details: { username: 'staff.viewer' } }) + '\n');
    assert.equal((await (await auditCall('?q=staff.viewer')).json()).total, 1);
    assert.deepEqual((await (await auditCall('?q=nonexistent')).json()).items, []);
    for (const query of ['?limit=101', '?limit=0', '?offset=-1', '?offset=1.5', '?limit=invalid', '?q=' + 'x'.repeat(201)]) {
      assert.equal((await auditCall(query)).status, 400);
    }
    const actions = auditData.items.map((item) => item.action);
    assert.ok(actions.includes('message_filter_rule_tested'));
    assert.ok(actions.includes('message_filter_rule_added'));

    const addEntry = auditData.items.find((item) => item.action === 'message_filter_rule_added');
    assert.equal(addEntry.actor.username, 'ops.admin');
    assert.equal(addEntry.actor.role, 'dashboard');
    assert.equal(addEntry.actor.subject, 'acct-123');
    assert.equal(addEntry.request.method, 'POST');
    assert.equal(addEntry.request.request_id, 'audit-test-2');
    assert.match(addEntry.request.path, /\/api\/dashboard\/message-filter\/rules$/);
    assert.equal(addEntry.target.type, 'message_filter_rule');
    assert.equal(addEntry.target.id, 'audit_rule');
    assert.match(addEntry.rollback_snapshot_id, /message_filter_rule_add/);
    assert.equal(addEntry.details.rule.reply.length, 'Audit reply with private detail 555-123-4567'.length);
    assert.match(addEntry.details.rule.reply.sha256, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(addEntry).includes('555-123-4567'), false);

    const testEntry = auditData.items.find((item) => item.action === 'message_filter_rule_tested');
    assert.equal(testEntry.details.matched, true);
    assert.match(testEntry.details.test_message.redacted_preview, /\[REDACTED_EMAIL\]/);
    fs.unlinkSync(process.env.DASHBOARD_AUDIT_LOG_PATH);
    assert.equal((await (await auditCall()).json()).total, 0);
    fs.mkdirSync(process.env.DASHBOARD_AUDIT_LOG_PATH);
    const unavailable = await auditCall();
    assert.equal(unavailable.status, 500);
    assert.deepEqual(await unavailable.json(), { error: 'Unable to load the dashboard audit log.' });
  } finally {
    server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.MESSAGE_FILTER_RULES_PATH;
    delete process.env.AI_RESPONSE_LOG_PATH;
    delete process.env.DASHBOARD_AUDIT_LOG_PATH;
    delete process.env.DASHBOARD_ROLLBACK_DIR;
    delete process.env.JWT_SECRET;
    delete process.env.DASHBOARD_ACCOUNTS_PATH;
    clearModule('../routes/dashboard');
    clearModule('../routes/auth');
    clearModule('../lib/state');
    clearModule('../util/logger');
  }
});
