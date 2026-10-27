'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('node:child_process');
const express = require('express');
const jwt = require('jsonwebtoken');

function isolatedStore(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-onboarding-'));
  const previous = { DASHBOARD_ACCOUNTS_PATH: process.env.DASHBOARD_ACCOUNTS_PATH, JWT_SECRET: process.env.JWT_SECRET };
  process.env.DASHBOARD_ACCOUNTS_PATH = path.join(directory, 'accounts.json');
  process.env.JWT_SECRET = 'onboarding-test-secret-for-isolated-accounts';
  for (const name of ['../lib/dashboard-accounts', '../routes/auth']) delete require.cache[require.resolve(name)];
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    for (const name of ['../lib/dashboard-accounts', '../routes/auth']) delete require.cache[require.resolve(name)];
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { accounts: require('../lib/dashboard-accounts'), file: process.env.DASHBOARD_ACCOUNTS_PATH };
}

test('creation script accepts only a username and stores a hashed temporary password', (t) => {
  const { accounts, file } = isolatedStore(t);
  const script = path.join(__dirname, '../scripts/create-dashboard-account.js');
  const output = execFileSync(process.execPath, [script, '--username', 'New.Staff'], { encoding: 'utf8' });
  const password = output.match(/Temporary password: (\S+)/)?.[1];
  assert.match(password, /^[A-Za-z0-9_-]{32}$/);
  const account = accounts.authenticateDashboardAccount('new.staff', password);
  assert.equal(account.onboardingRequired, true);
  assert.equal(account.firstName, null);
  assert.equal(account.lastName, null);
  assert.equal(account.email, null);
  assert.equal(fs.readFileSync(file, 'utf8').includes(password), false);
  const secondOutput = execFileSync(process.execPath, [script, '--username=second.staff'], { encoding: 'utf8' });
  assert.notEqual(secondOutput.match(/Temporary password: (\S+)/)?.[1], password);
  const before = fs.readFileSync(file, 'utf8');
  for (const args of [[], ['--username', 'new.staff'], ['--username', 'other.staff', '--password', 'supplied password'], ['--username', 'other.staff', '--email', 'a@example.com']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout.includes('Temporary password:'), false);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  }
});

test('first login is restricted until profile and password are saved, then onboarding credentials cannot be reused', async (t) => {
  const { accounts, file } = isolatedStore(t);
  const pending = accounts.provisionDashboardAccount('new.staff');
  const other = accounts.createDashboardAccount({ username: 'legacy.staff', password: 'legacy strong password' });
  const auth = require('../routes/auth');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', auth);
  app.get('/api/system-prompt', auth.requireAuth, (_req, res) => res.json({ allowed: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, token) => fetch(`${base}/api/auth/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
  });
  const login = (password = pending.temporaryPassword) => post('login', { username: 'NEW.STAFF', password });
  const firstLogin = await (await login()).json();
  const secondLogin = await (await login()).json();
  assert.equal(firstLogin.onboardingRequired, true);
  const claims = jwt.verify(firstLogin.token, process.env.JWT_SECRET);
  assert.equal(claims.role, 'onboarding');
  assert.equal(claims.exp - claims.iat, 1800);
  assert.equal((await fetch(`${base}/api/system-prompt`, { headers: { Authorization: `Bearer ${firstLogin.token}` } })).status, 403);
  const profile = { firstName: ' Jo ', lastName: ' O’Neil ', email: ' jo@example.com ', password: ' new strong password ' };
  const originalStore = fs.readFileSync(file, 'utf8');
  for (const invalid of [
    { firstName: '' }, { firstName: 123 }, { firstName: 'a'.repeat(101) }, { lastName: '\nName' },
    { lastName: null }, { email: '' }, { email: 'invalid' }, { email: 123 },
    { password: 'short' }, { password: ' '.repeat(12) }, { password: 'x'.repeat(1025) }, { password: pending.temporaryPassword },
  ]) {
    const response = await post('onboarding', { ...profile, ...invalid }, firstLogin.token);
    assert.equal(response.status, 400, JSON.stringify(invalid));
    assert.equal(fs.readFileSync(file, 'utf8'), originalStore);
  }
  assert.equal((await post('onboarding', profile)).status, 401);
  assert.equal((await post('onboarding', profile, 'invalid-token')).status, 401);
  const expired = jwt.sign({ sub: pending.account.id, role: 'onboarding' }, process.env.JWT_SECRET, { expiresIn: -1 });
  assert.equal((await post('onboarding', profile, expired)).status, 401);
  const legacyLogin = await (await post('login', { username: other.username, password: 'legacy strong password' })).json();
  assert.equal(legacyLogin.onboardingRequired, false);
  assert.equal((await post('onboarding', profile, legacyLogin.token)).status, 403);

  const completed = await post('onboarding', { ...profile, id: other.id, username: other.username, role: 'admin', onboardingRequired: true }, firstLogin.token);
  assert.equal(completed.status, 200);
  const session = await completed.json();
  assert.equal(session.onboardingRequired, false);
  assert.deepEqual(session.user, { username: 'new.staff', role: 'dashboard', firstName: 'Jo', lastName: 'O’Neil', email: 'jo@example.com' });
  const normalClaims = jwt.verify(session.token, process.env.JWT_SECRET);
  assert.equal(normalClaims.role, 'dashboard');
  assert.equal(normalClaims.exp - normalClaims.iat, 28800);
  assert.equal((await fetch(`${base}/api/system-prompt`, { headers: { Authorization: `Bearer ${session.token}` } })).status, 200);
  assert.equal((await login()).status, 401);
  assert.deepEqual((await (await login(profile.password)).json()).user, session.user);
  assert.equal((await post('onboarding', profile, secondLogin.token)).status, 401);
  assert.equal((await fetch(`${base}/api/system-prompt`, { headers: { Authorization: `Bearer ${firstLogin.token}` } })).status, 403);
  assert.deepEqual(accounts.authenticateDashboardAccount(other.username, 'legacy strong password'), other);
  const stored = JSON.parse(fs.readFileSync(file, 'utf8')).accounts[0];
  assert.equal(stored.id, pending.account.id);
  assert.equal(stored.onboardingRequired, false);
  assert.ok(stored.onboardedAt);
  assert.equal(stored.email, 'jo@example.com');
  assert.equal(stored.password, undefined);
  assert.equal(JSON.stringify(session).includes('passwordHash'), false);
  assert.equal(fs.readFileSync(file, 'utf8').includes(profile.password), false);
});

test('onboarding cannot update disabled or deleted accounts and storage errors are not exposed', async (t) => {
  const { accounts, file } = isolatedStore(t);
  const { account, temporaryPassword } = accounts.provisionDashboardAccount('disabled.staff');
  const profile = { firstName: 'First', lastName: 'Last', email: 'staff@example.com', password: 'new strong password' };
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  stored.accounts[0].active = false;
  fs.writeFileSync(file, JSON.stringify(stored));
  assert.equal(accounts.authenticateDashboardAccount(account.username, temporaryPassword), null);
  assert.throws(() => accounts.completeDashboardOnboarding(account.id, profile), { status: 401 });
  fs.writeFileSync(file, JSON.stringify({ version: 1, accounts: [] }));
  assert.throws(() => accounts.completeDashboardOnboarding(account.id, profile), { status: 401 });

  const auth = require('../routes/auth');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', auth);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  fs.writeFileSync(file, 'invalid private store content');
  const token = jwt.sign({ sub: account.id, role: 'onboarding' }, process.env.JWT_SECRET);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/onboarding`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(profile),
  });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Unable to save your account. Please try again or contact your administrator.' });
});
