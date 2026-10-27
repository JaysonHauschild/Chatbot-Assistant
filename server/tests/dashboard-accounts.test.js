'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

test('dashboard account store creates and authenticates password-hashed accounts', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-dashboard-accounts-test-'));
  const originalAccountsPath = process.env.DASHBOARD_ACCOUNTS_PATH;

  try {
    process.env.DASHBOARD_ACCOUNTS_PATH = path.join(tempDir, 'accounts.json');
    clearModule('../lib/dashboard-accounts');
    const accounts = require('../lib/dashboard-accounts');

    assert.equal(accounts.hasDashboardAccounts(), false);
    const account = accounts.createDashboardAccount({ username: 'Ops.Admin', password: 'very secure passphrase' });

    assert.equal(account.username, 'ops.admin');
    assert.equal(account.role, 'dashboard');
    assert.equal(account.email, null);
    assert.equal(accounts.hasDashboardAccounts(), true);
    assert.equal(accounts.authenticateDashboardAccount('ops.admin', 'wrong'), null);
    assert.equal(accounts.authenticateDashboardAccount('OPS.ADMIN', 'very secure passphrase').username, 'ops.admin');

    const stored = JSON.parse(fs.readFileSync(process.env.DASHBOARD_ACCOUNTS_PATH, 'utf8'));
    assert.notEqual(stored.accounts[0].passwordHash.hash, 'very secure passphrase');
    assert.equal(stored.accounts[0].passwordHash.algorithm, 'pbkdf2-sha256');

    // Older stores have no email property and must still support login.
    delete stored.accounts[0].email;
    fs.writeFileSync(process.env.DASHBOARD_ACCOUNTS_PATH, JSON.stringify(stored));
    assert.equal(accounts.authenticateDashboardAccount('ops.admin', 'very secure passphrase').email, null);
    assert.equal(accounts.listDashboardAccounts()[0].email, null);

    const emailAccount = accounts.createDashboardAccount({
      username: 'email.admin',
      password: 'another secure passphrase',
      email: ' admin@example.com ',
    });
    assert.equal(emailAccount.email, 'admin@example.com');
    assert.equal(accounts.authenticateDashboardAccount('email.admin', 'another secure passphrase').email, 'admin@example.com');
    const updated = JSON.parse(fs.readFileSync(process.env.DASHBOARD_ACCOUNTS_PATH, 'utf8'));
    assert.equal(updated.accounts[1].email, 'admin@example.com');
    assert.equal(accounts.listDashboardAccounts()[1].email, 'admin@example.com');
    assert.equal(Object.hasOwn(accounts.listDashboardAccounts()[1], 'passwordHash'), false);

    for (const email of ['invalid', 'admin@', 'a b@example.com', 'a@@example.com', 123]) {
      assert.throws(() => accounts.createDashboardAccount({
        username: 'invalid.admin', password: 'very secure passphrase', email,
      }), /Email must be a valid email address/);
    }
    assert.equal(accounts.listDashboardAccounts().length, 2);
  } finally {
    if (originalAccountsPath === undefined) delete process.env.DASHBOARD_ACCOUNTS_PATH;
    else process.env.DASHBOARD_ACCOUNTS_PATH = originalAccountsPath;
    clearModule('../lib/dashboard-accounts');
  }
});
