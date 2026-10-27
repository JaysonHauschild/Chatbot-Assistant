'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

test('only current admins manage accounts, sessions are revoked, and credentials never enter lists or audit logs', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-user-admin-'));
  const settings = { DASHBOARD_ACCOUNTS_PATH: path.join(directory, 'accounts.json'), JWT_SECRET: 'user-admin-test-secret',
    AI_RESPONSE_LOG_PATH: path.join(directory, 'responses.jsonl'), DASHBOARD_AUDIT_LOG_PATH: path.join(directory, 'audit.jsonl') };
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const accounts = require('../lib/dashboard-accounts');
  const password = 'isolated account test password';
  const admin = accounts.createDashboardAccount({ username: 'root.admin', password, role: 'admin' });
  const secondAdmin = accounts.createDashboardAccount({ username: 'second.admin', password, role: 'admin',
    firstName: 'Second', lastName: 'Admin', email: 'second@example.com' });
  accounts.createDashboardAccount({ username: 'editor', password, role: 'dashboard' });
  accounts.createDashboardAccount({ username: 'viewer', password, role: 'readonly' });
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api', require('../routes/dashboard'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const login = async (username, value = password) => {
    const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: value }) });
    return { status: response.status, ...(await response.json()) };
  };
  const session = await login('root.admin');
  const call = (suffix = '', options = {}, token = session.token) => fetch(`${base}/dashboard/users${suffix}`, {
    ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const post = (body, token = session.token) => call('', { method: 'POST', body: JSON.stringify(body) }, token);
  const change = (id, role, token = session.token) => call(`/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) }, token);
  assert.equal((await call('', {}, '')).status, 401);
  for (const username of ['editor', 'viewer']) {
    const token = (await login(username)).token;
    assert.equal((await call('', {}, token)).status, 403);
    assert.equal((await post({ username: 'unauthorized', role: 'admin' }, token)).status, 403);
    assert.equal((await change(admin.id, 'readonly', token)).status, 403);
    assert.equal((await call(`/${admin.id}`, { method: 'DELETE' }, token)).status, 403);
    for (const action of ['reset-password', 'revoke-sessions']) {
      assert.equal((await call(`/${admin.id}/${action}`, { method: 'POST' }, token)).status, 403);
    }
    assert.equal((await call(`/${admin.id}/lock`, { method: 'PUT', body: JSON.stringify({ locked: true }) }, token)).status, 403);
  }
  assert.equal((await call('', {}, jwt.sign({ role: 'admin' }, settings.JWT_SECRET))).status, 403);
  assert.equal((await post({ username: 'x', role: 'admin' })).status, 400);
  assert.equal((await post({ username: 'new.staff', role: 'unknown' })).status, 400);
  assert.equal((await post({ username: 'editor' })).status, 409);
  const before = fs.readFileSync(settings.DASHBOARD_ACCOUNTS_PATH, 'utf8');
  assert.equal((await change(admin.id, 'readonly')).status, 400);
  assert.equal((await call(`/${admin.id}`, { method: 'DELETE' })).status, 400);
  assert.equal(fs.readFileSync(settings.DASHBOARD_ACCOUNTS_PATH, 'utf8'), before);

  const createdResponse = await post({ username: 'New.Staff', role: 'admin', active: false, password: 'untrusted supplied password' });
  assert.equal(createdResponse.status, 201);
  assert.equal(createdResponse.headers.get('cache-control'), 'no-store');
  const created = await createdResponse.json();
  assert.equal(created.user.role, 'admin');
  assert.equal(created.user.onboardingRequired, true);
  assert.equal(created.user.active, true);
  assert.match(created.temporaryPassword, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(accounts.authenticateDashboardAccount('new.staff', 'untrusted supplied password'), null);
  const pending = await login('new.staff', created.temporaryPassword);
  assert.equal(pending.onboardingRequired, true);
  assert.equal((await call('', {}, pending.token)).status, 403);
  const listResponse = await call();
  const list = await listResponse.json();
  assert.equal(listResponse.headers.get('cache-control'), 'no-store');
  assert.equal(list.currentUserId, admin.id);
  assert.equal(JSON.stringify(list).includes(created.temporaryPassword), false);
  assert.equal(JSON.stringify(list).includes('passwordHash'), false);
  const onboarding = await fetch(`${base}/auth/onboarding`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pending.token}` },
    body: JSON.stringify({ firstName: 'New', lastName: 'Staff', email: 'new@example.com', password: 'completed user test password' }) });
  assert.equal(onboarding.status, 200);
  const newSession = await onboarding.json();
  assert.equal((await call('', {}, newSession.token)).status, 200);
  assert.equal((await change(created.user.id, 'readonly')).status, 200);
  assert.equal((await call('', {}, newSession.token)).status, 401);
  const readonly = await login('new.staff', 'completed user test password');
  assert.equal(readonly.user.role, 'readonly');
  assert.equal((await call('', {}, readonly.token)).status, 403);
  assert.equal((await call(`/${created.user.id}`, { method: 'DELETE' })).status, 204);
  assert.equal(accounts.getDashboardAccount(created.user.id), null);
  assert.equal((await login('new.staff', 'completed user test password')).status, 401);
  assert.equal((await fetch(`${base}/dashboard/conversations`, { headers: { Authorization: `Bearer ${readonly.token}` } })).status, 401);
  assert.equal((await call(`/${created.user.id}`, { method: 'DELETE' })).status, 404);
  const secondSession = await login('second.admin');
  const lock = (locked) => call(`/${secondAdmin.id}/lock`, { method: 'PUT', body: JSON.stringify({ locked }) });
  const reset = () => call(`/${secondAdmin.id}/reset-password`, { method: 'POST' });
  const revoke = (id = secondAdmin.id) => call(`/${id}/revoke-sessions`, { method: 'POST' });
  const finishReset = (token, newPassword) => fetch(`${base}/auth/onboarding`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ password: newPassword }) });
  assert.equal((await call(`/${admin.id}/lock`, { method: 'PUT', body: JSON.stringify({ locked: true }) })).status, 400);
  assert.equal((await call(`/${admin.id}/reset-password`, { method: 'POST' })).status, 400);
  assert.equal((await lock('true')).status, 400);
  assert.equal((await lock(true)).status, 200);
  assert.equal((await login('second.admin')).status, 401);
  assert.equal((await call('', {}, secondSession.token)).status, 200, 'locking retains active sessions');
  assert.equal((await revoke()).status, 200);
  assert.equal((await call('', {}, secondSession.token)).status, 401, 'revocation takes effect immediately');
  assert.equal((await login('second.admin')).status, 401);
  assert.equal((await lock(false)).status, 200);
  const afterUnlock = await login('second.admin');
  assert.equal(afterUnlock.status, 200);
  const resetResponse = await reset();
  assert.equal(resetResponse.headers.get('cache-control'), 'no-store');
  const resetResult = await resetResponse.json();
  assert.match(resetResult.temporaryPassword, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(resetResult.user.passwordResetRequired, true);
  assert.equal((await login('second.admin')).status, 401, 'old password fails after reset');
  assert.equal((await call('', {}, afterUnlock.token)).status, 401);
  let resetSession = await login('second.admin', resetResult.temporaryPassword);
  assert.equal(resetSession.passwordResetRequired, true);
  assert.equal(resetSession.onboardingRequired, true);
  assert.equal((await call('', {}, resetSession.token)).status, 403);
  assert.equal((await finishReset(resetSession.token, resetResult.temporaryPassword)).status, 400);
  assert.equal((await lock(true)).status, 200);
  assert.equal((await login('second.admin', resetResult.temporaryPassword)).status, 401);
  assert.equal((await finishReset(resetSession.token, 'replacement account password')).status, 401, 'locked setup cannot mint a new session');
  assert.equal((await lock(false)).status, 200);
  assert.equal((await revoke()).status, 200);
  assert.equal((await finishReset(resetSession.token, 'replacement account password')).status, 401, 'revokes setup sessions too');
  resetSession = await login('second.admin', resetResult.temporaryPassword);
  const completedReset = await finishReset(resetSession.token, 'replacement account password');
  assert.equal(completedReset.status, 200);
  const replacementSession = await completedReset.json();
  assert.equal(replacementSession.passwordResetRequired, false);
  assert.deepEqual(replacementSession.user, { username: 'second.admin', role: 'admin', firstName: 'Second', lastName: 'Admin', email: 'second@example.com' });
  assert.equal((await call('', {}, replacementSession.token)).status, 200);
  assert.equal((await finishReset(resetSession.token, 'another replacement password')).status, 401);
  assert.equal((await login('second.admin', resetResult.temporaryPassword)).status, 401);
  assert.equal((await login('second.admin', 'replacement account password')).status, 200);
  assert.equal(JSON.stringify(await (await call()).json()).includes(resetResult.temporaryPassword), false);
  assert.equal(fs.readFileSync(settings.DASHBOARD_ACCOUNTS_PATH, 'utf8').includes(resetResult.temporaryPassword), false);
  assert.equal((await change(secondAdmin.id, 'dashboard')).status, 200);
  assert.equal((await call('', {}, secondSession.token)).status, 401);
  assert.equal((await change(secondAdmin.id, 'unknown')).status, 400);
  const persisted = fs.readFileSync(settings.DASHBOARD_ACCOUNTS_PATH, 'utf8');
  assert.equal(persisted.includes(created.temporaryPassword), false);
  const audit = fs.readFileSync(settings.DASHBOARD_AUDIT_LOG_PATH, 'utf8');
  assert.equal(audit.includes(created.temporaryPassword), false);
  assert.equal(audit.includes(resetResult.temporaryPassword), false);
  assert.equal(audit.includes('passwordHash'), false);
  const entries = audit.trim().split('\n').map(JSON.parse);
  assert.equal(entries[0].action, 'dashboard_user_created');
  assert.equal(entries[0].actor.subject, admin.id);
  assert.equal(entries[0].target.id, created.user.id);
  for (const event of ['dashboard_user_created', 'dashboard_user_role_changed', 'dashboard_user_deleted']) assert.ok(audit.includes(event));
  for (const event of ['dashboard_user_password_reset', 'dashboard_user_locked', 'dashboard_user_unlocked', 'dashboard_user_sessions_revoked']) assert.ok(audit.includes(event));
  assert.equal((await revoke(admin.id)).status, 200);
  assert.equal((await call()).status, 401, 'administrators can revoke their own sessions');
});
