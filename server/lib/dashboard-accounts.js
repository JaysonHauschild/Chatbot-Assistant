'use strict';

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { createFileAccountStore } = require('server-kit');

const DEFAULT_ACCOUNTS_PATH = path.join(
  __dirname,
  '..',
  'data',
  'dashboard-accounts.json',
);

function getAccountsPath() {
  return process.env.DASHBOARD_ACCOUNTS_PATH || DEFAULT_ACCOUNTS_PATH;
}

const accountStore = createFileAccountStore({
  getFilePath: getAccountsPath,
  defaultRole: 'dashboard',
  duplicateError: (username) =>
    `Dashboard account "${username}" already exists.`,
});

function normalizeEmail(email) {
  if (email == null || email === '') return null;
  if (typeof email !== 'string') {
    throw new Error('Email must be a valid email address.');
  }
  const normalized = email.trim();
  if (!normalized) return null;
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('Email must be a valid email address.');
  }
  return normalized;
}

function withEmail(account) {
  return account ? { ...account, email: account.email ?? null } : null;
}

function createDashboardAccount({ email, role = 'dashboard', ...attributes }) {
  if (!['dashboard', 'admin', 'readonly'].includes(role)) {
    throw new Error('Role must be dashboard, admin, or readonly.');
  }
  return accountStore.createAccount({ ...attributes, role, email: normalizeEmail(email) });
}

function provisionDashboardAccount(username, { role = 'dashboard' } = {}) {
  const temporaryPassword = crypto.randomBytes(24).toString('base64url');
  const account = createDashboardAccount({
    username,
    role,
    password: temporaryPassword,
    onboardingRequired: true,
    firstName: null,
    lastName: null,
  });
  return { account, temporaryPassword };
}

function getDashboardAccount(id) {
  return withEmail(accountStore.listAccounts().find((account) => account.id === id));
}

function getAccountSessionVersion(account) {
  return Number.isSafeInteger(account?.sessionVersion) && account.sessionVersion >= 0 ? account.sessionVersion : 0;
}

function resetDashboardAccountPassword(id) {
  const account = getDashboardAccount(id);
  if (!account) return null;
  const temporaryPassword = crypto.randomBytes(24).toString('base64url');
  const updated = accountStore.updateAccount(id, { password: temporaryPassword, passwordResetRequired: true,
    sessionVersion: getAccountSessionVersion(account) + 1 });
  return { account: updated, temporaryPassword };
}

function setDashboardAccountLocked(id, locked) {
  if (typeof locked !== 'boolean') throw Object.assign(new Error('locked must be true or false.'), { status: 400 });
  return accountStore.updateAccount(id, { locked });
}

function revokeDashboardAccountSessions(id) {
  const account = getDashboardAccount(id);
  return account ? accountStore.updateAccount(id, { sessionVersion: getAccountSessionVersion(account) + 1,
    sessionsRevokedAt: new Date().toISOString() }) : null;
}

function updateDashboardAccountRole(id, role) {
  if (!['dashboard', 'admin', 'readonly'].includes(role)) {
    throw Object.assign(new Error('Role must be dashboard, admin, or readonly.'), { status: 400 });
  }
  return accountStore.updateAccount(id, { role });
}

function deleteDashboardAccount(id) {
  const filePath = getAccountsPath();
  const store = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const index = store.accounts.findIndex((account) => account.id === id);
  if (index === -1) return false;
  store.accounts.splice(index, 1);
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
  return true;
}

function onboardingError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function normalizeName(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw onboardingError(`${label} must be between 1 and 100 characters without control characters.`);
  }
  return value.trim();
}

function completeDashboardOnboarding(id, { firstName, lastName, email, password }) {
  const account = accountStore.listAccounts().find((candidate) => candidate.id === id);
  if (!account || account.active === false || account.locked === true ||
    (account.onboardingRequired !== true && account.passwordResetRequired !== true)) {
    throw onboardingError('Onboarding session is no longer valid. Please log in again.', 401);
  }
  const profile = account.onboardingRequired === true ? {
    firstName: normalizeName(firstName, 'First name'),
    lastName: normalizeName(lastName, 'Last name'),
  } : {};
  if (account.onboardingRequired === true) {
    try {
      profile.email = normalizeEmail(email);
    } catch {
      throw onboardingError('Email must be a valid email address.');
    }
    if (!profile.email) throw onboardingError('Email is required.');
  }
  if (!accountStore.validatePassword(password) || !password.trim() || password.length > 1024) {
    throw onboardingError('New password must be between 12 and 1,024 characters.');
  }
  if (accountStore.authenticate(account.username, password)) {
    throw onboardingError('Choose a new password different from the temporary password.');
  }
  // Synchronous validation and update keep completion single-use within this process.
  return accountStore.updateAccount(id, {
    ...profile,
    password,
    onboardingRequired: false,
    passwordResetRequired: false,
    sessionVersion: getAccountSessionVersion(account) + 1,
    onboardedAt: new Date().toISOString(),
  });
}

module.exports = {
  authenticateDashboardAccount: (username, password) => {
    const account = accountStore.authenticate(username, password);
    return account?.locked === true ? null : withEmail(account);
  },
  createDashboardAccount,
  provisionDashboardAccount,
  completeDashboardOnboarding,
  getAccountsPath,
  hasDashboardAccounts: accountStore.hasAccounts,
  listDashboardAccounts: () => accountStore.listAccounts().map(withEmail),
  getDashboardAccount,
  updateDashboardAccountRole,
  deleteDashboardAccount,
  getAccountSessionVersion,
  resetDashboardAccountPassword,
  setDashboardAccountLocked,
  revokeDashboardAccountSessions,
  normalizeUsername: accountStore.normalizeUsername,
  validatePassword: accountStore.validatePassword,
  validateUsername: accountStore.validateUsername,
};
