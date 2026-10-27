'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { execFileSync, spawnSync } = require('node:child_process');

test('read-only accounts retain their role through login/onboarding and cannot invoke any dashboard write route', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-readonly-'));
  const settings = { DASHBOARD_ACCOUNTS_PATH: path.join(directory, 'accounts.json'),
    AI_RESPONSE_LOG_PATH: path.join(directory, 'responses.jsonl'), JWT_SECRET: 'readonly-test-secret' };
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const accounts = require('../lib/dashboard-accounts');
  accounts.createDashboardAccount({ username: 'viewer', password: 'viewer strong password', role: 'readonly' });
  assert.throws(() => accounts.createDashboardAccount({ username: 'invalid', password: 'viewer strong password', role: 'unknown' }), /Role must be/);
  const script = path.join(__dirname, '../scripts/create-dashboard-account.js');
  const output = execFileSync(process.execPath, [script, '--role=readonly', '--username', 'new.viewer'], { encoding: 'utf8' });
  const temporaryPassword = output.match(/Temporary password: (\S+)/)[1];
  assert.equal(accounts.authenticateDashboardAccount('new.viewer', temporaryPassword).role, 'readonly');
  const before = fs.readFileSync(settings.DASHBOARD_ACCOUNTS_PATH, 'utf8');
  const invalid = spawnSync(process.execPath, [script, '--username', 'invalid.viewer', '--role', 'unknown'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.equal(fs.readFileSync(settings.DASHBOARD_ACCOUNTS_PATH, 'utf8'), before);

  const auth = require('../routes/auth');
  const dashboard = require('../routes/dashboard');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', auth);
  app.use('/api', dashboard);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const login = (username, password) => fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const session = await (await login('viewer', 'viewer strong password')).json();
  assert.equal(session.user.role, 'readonly');
  assert.equal(jwt.verify(session.token, settings.JWT_SECRET).role, 'readonly');
  const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
  for (const route of ['/dashboard/monthly-analytics?startMonth=2026-01&endMonth=2026-02', '/dashboard/conversations', '/dashboard/page-usage', '/dashboard/feedback-summary']) {
    assert.equal((await fetch(base + route, { headers })).status, 200, route);
  }
  // Cover every mutation, including AI sandbox tests and GET-shaped paths called with write methods.
  const writes = dashboard.stack.filter((layer) => layer.route).flatMap((layer) => Object.keys(layer.route.methods)
    .filter((method) => !['get', 'head', 'options'].includes(method))
    .map((method) => [method, layer.route.path.replace(':id', 'example')]));
  assert.ok(writes.length >= 15);
  for (const [method, route] of writes) {
    const response = await fetch(base + route, { method: method.toUpperCase(), headers, body: '{}' });
    assert.equal(response.status, 403, `${method} ${route}`);
    assert.equal((await response.json()).error, 'This dashboard account is read-only.');
  }
  assert.equal((await fetch(`${base}/dashboard/conversations`, { method: 'POST', headers, body: '{}' })).status, 403);
  for (const role of ['dashboard', 'admin']) {
    const token = jwt.sign({ role }, settings.JWT_SECRET);
    // Invalid payload should reach validation, proving operators still have write access.
    assert.equal((await fetch(`${base}/dashboard/conversations/review`, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body: '{}' })).status, 400);
  }
  assert.equal((await fetch(`${base}/dashboard/conversations`)).status, 401);
  assert.equal((await fetch(`${base}/dashboard/conversations`, { headers: { Authorization: `Bearer ${jwt.sign({ role: 'unknown' }, settings.JWT_SECRET)}` } })).status, 403);

  const pending = await (await login('new.viewer', temporaryPassword)).json();
  assert.equal(pending.onboardingRequired, true);
  const completed = await fetch(`${base}/auth/onboarding`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pending.token}` },
    body: JSON.stringify({ firstName: 'Read', lastName: 'Only', email: 'viewer@example.com', password: 'new viewer strong password', role: 'admin' }) });
  assert.equal(completed.status, 200);
  const finished = await completed.json();
  assert.equal(finished.user.role, 'readonly');
  assert.equal(jwt.verify(finished.token, settings.JWT_SECRET).role, 'readonly');
});
