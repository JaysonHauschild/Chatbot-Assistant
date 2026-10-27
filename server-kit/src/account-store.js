'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_USERNAME_PATTERN = /^[a-zA-Z0-9._@-]{3,80}$/;
const HASH_ALGORITHM = 'sha256';
const HASH_ITERATIONS = 210000;
const HASH_KEY_LENGTH = 64;

function createFileAccountStore(options = {}) {
  const usernamePattern =
    options.usernamePattern || DEFAULT_USERNAME_PATTERN;
  const minimumPasswordLength = Number.isFinite(options.minimumPasswordLength)
    ? options.minimumPasswordLength
    : 12;
  const defaultRole = options.defaultRole || 'user';

  function getFilePath() {
    const filePath =
      typeof options.getFilePath === 'function'
        ? options.getFilePath()
        : options.filePath;
    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw new Error('An account store filePath is required.');
    }
    return filePath;
  }

  function normalizeUsername(username) {
    return String(username || '').trim().toLowerCase();
  }

  function validateUsername(username) {
    return usernamePattern.test(normalizeUsername(username));
  }

  function validatePassword(password) {
    return (
      typeof password === 'string' &&
      password.length >= minimumPasswordLength
    );
  }

  function createEmptyStore() {
    return { version: 1, accounts: [] };
  }

  function readStore() {
    const filePath = getFilePath();
    if (!fs.existsSync(filePath)) return createEmptyStore();

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || !Array.isArray(parsed.accounts)) {
      return createEmptyStore();
    }

    return {
      version: parsed.version || 1,
      accounts: parsed.accounts.filter(
        (account) =>
          account && typeof account.username === 'string',
      ),
    };
  }

  function writeStore(store) {
    const filePath = getFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(
      tempPath,
      `${JSON.stringify(store, null, 2)}\n`,
      { mode: 0o600 },
    );
    fs.renameSync(tempPath, filePath);

    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Some filesystems do not support POSIX modes.
    }
  }

  function hashPassword(
    password,
    salt = crypto.randomBytes(16).toString('hex'),
  ) {
    const hash = crypto
      .pbkdf2Sync(
        password,
        salt,
        HASH_ITERATIONS,
        HASH_KEY_LENGTH,
        HASH_ALGORITHM,
      )
      .toString('hex');

    return {
      algorithm: `pbkdf2-${HASH_ALGORITHM}`,
      iterations: HASH_ITERATIONS,
      keyLength: HASH_KEY_LENGTH,
      salt,
      hash,
    };
  }

  function timingSafeEqualString(expected, provided) {
    const expectedBuffer = Buffer.from(expected || '', 'hex');
    const providedBuffer = Buffer.from(provided || '', 'hex');
    return (
      expectedBuffer.length === providedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, providedBuffer)
    );
  }

  function verifyPassword(password, passwordHash) {
    if (
      !passwordHash ||
      passwordHash.algorithm !== `pbkdf2-${HASH_ALGORITHM}`
    ) {
      return false;
    }

    const hash = crypto
      .pbkdf2Sync(
        password,
        passwordHash.salt,
        passwordHash.iterations,
        passwordHash.keyLength || HASH_KEY_LENGTH,
        HASH_ALGORITHM,
      )
      .toString('hex');
    return timingSafeEqualString(passwordHash.hash, hash);
  }

  function withoutPasswordHash(account) {
    const { passwordHash, ...safeAccount } = account;
    return safeAccount;
  }

  function listAccounts() {
    return readStore().accounts.map(withoutPasswordHash);
  }

  function createAccount({
    username,
    password,
    role = defaultRole,
    ...attributes
  }) {
    const normalizedUsername = normalizeUsername(username);
    if (!validateUsername(normalizedUsername)) {
      throw new Error(
        options.usernameError ||
          'Username must be 3-80 characters and may only include letters, numbers, dots, underscores, hyphens, or @.',
      );
    }
    if (!validatePassword(password)) {
      throw new Error(
        options.passwordError ||
          `Password must be at least ${minimumPasswordLength} characters long.`,
      );
    }

    const store = readStore();
    if (
      store.accounts.some(
        (account) =>
          normalizeUsername(account.username) === normalizedUsername,
      )
    ) {
      throw new Error(
        typeof options.duplicateError === 'function'
          ? options.duplicateError(normalizedUsername)
          : `Account "${normalizedUsername}" already exists.`,
      );
    }

    const now = new Date().toISOString();
    const account = {
      ...attributes,
      id: crypto.randomUUID(),
      username: normalizedUsername,
      role,
      active: true,
      createdAt: now,
      updatedAt: now,
      passwordHash: hashPassword(password),
    };

    store.accounts.push(account);
    writeStore(store);
    return withoutPasswordHash(account);
  }

  function authenticate(username, password) {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername || typeof password !== 'string') return null;

    const account = readStore().accounts.find(
      (candidate) =>
        normalizeUsername(candidate.username) === normalizedUsername,
    );
    if (
      !account ||
      account.active === false ||
      !verifyPassword(password, account.passwordHash)
    ) {
      return null;
    }

    return withoutPasswordHash(account);
  }

  function updateAccount(id, { password, ...attributes }) {
    if (password !== undefined && !validatePassword(password)) {
      throw new Error(`Password must be at least ${minimumPasswordLength} characters long.`);
    }
    const store = readStore();
    const index = store.accounts.findIndex((account) => account.id === id);
    if (index === -1) return null;
    const current = store.accounts[index];
    const updated = {
      ...current,
      ...attributes,
      id: current.id,
      username: current.username,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
      passwordHash: password === undefined ? current.passwordHash : hashPassword(password),
    };
    store.accounts[index] = updated;
    writeStore(store);
    return withoutPasswordHash(updated);
  }

  function hasAccounts() {
    return readStore().accounts.some(
      (account) => account.active !== false,
    );
  }

  return Object.freeze({
    authenticate,
    createAccount,
    getFilePath,
    hasAccounts,
    listAccounts,
    normalizeUsername,
    updateAccount,
    validatePassword,
    validateUsername,
  });
}

module.exports = {
  DEFAULT_USERNAME_PATTERN,
  createFileAccountStore,
};
