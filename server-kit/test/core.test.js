'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  appendJsonLine,
  createBearerAuthMiddleware,
  createCorsOriginCallback,
  createFileAccountStore,
  createLivenessPayload,
  createTemporaryBanStore,
  getDailyLogPath,
  isTruthyValue,
  listDailyLogPaths,
  parseDelimitedList,
  parseJsonLine,
  redactSensitiveText,
  sanitizeHttpUrl,
} = require('..');

test('environment, validation, and redaction helpers normalize untrusted values', () => {
  assert.deepEqual(parseDelimitedList(' a, b ,,c '), ['a', 'b', 'c']);
  assert.equal(isTruthyValue('YES'), true);
  assert.equal(isTruthyValue('0'), false);
  assert.equal(
    sanitizeHttpUrl(' https://example.com/path '),
    'https://example.com/path',
  );
  assert.equal(sanitizeHttpUrl('javascript:alert(1)'), null);
  assert.equal(
    redactSensitiveText('Email owner@example.com or call 405-555-1212.'),
    'Email [REDACTED_EMAIL] or call [REDACTED_PHONE].',
  );
});

test('file account stores hash passwords and authenticate safely', () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'server-kit-account-'),
  );
  const filePath = path.join(tempDir, 'accounts.json');

  try {
    const store = createFileAccountStore({
      filePath,
      defaultRole: 'operator',
    });
    const account = store.createAccount({
      username: 'Ops.Admin',
      password: 'correct horse battery staple',
    });

    assert.equal(account.username, 'ops.admin');
    assert.equal(account.role, 'operator');
    assert.equal(store.authenticate('ops.admin', 'wrong'), null);
    assert.equal(
      store.authenticate(
        'OPS.ADMIN',
        'correct horse battery staple',
      ).id,
      account.id,
    );
    const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.notEqual(
      persisted.accounts[0].passwordHash.hash,
      'correct horse battery staple',
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('account updates preserve identity, hash replacement passwords, and leave other accounts intact', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-kit-update-account-'));
  try {
    const filePath = path.join(tempDir, 'accounts.json');
    const store = createFileAccountStore({ filePath });
    const account = store.createAccount({ username: 'first.user', password: 'original password' });
    const other = store.createAccount({ username: 'other.user', password: 'unrelated password' });
    const before = fs.readFileSync(filePath, 'utf8');
    assert.throws(() => store.updateAccount(account.id, { password: 'short' }), /at least 12/);
    assert.equal(fs.readFileSync(filePath, 'utf8'), before);
    assert.equal(store.updateAccount('missing-id', { firstName: 'Nobody' }), null);
    const updated = store.updateAccount(account.id, {
      firstName: 'Jo', password: 'replacement password', id: 'spoofed', username: 'spoofed',
      createdAt: 'spoofed', passwordHash: { hash: 'spoofed' },
    });
    assert.equal(updated.id, account.id);
    assert.equal(updated.username, account.username);
    assert.equal(updated.createdAt, account.createdAt);
    assert.equal(updated.firstName, 'Jo');
    assert.equal(Object.hasOwn(updated, 'passwordHash'), false);
    assert.equal(store.authenticate('first.user', 'original password'), null);
    assert.equal(store.authenticate('first.user', 'replacement password').id, account.id);
    assert.deepEqual(store.authenticate('other.user', 'unrelated password'), other);
    const reopened = createFileAccountStore({ filePath });
    assert.equal(reopened.authenticate('first.user', 'replacement password').firstName, 'Jo');
    assert.equal(fs.readFileSync(filePath, 'utf8').includes('replacement password'), false);
    const hash = JSON.parse(fs.readFileSync(filePath, 'utf8')).accounts[0].passwordHash;
    reopened.updateAccount(account.id, { lastName: 'Smith' });
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')).accounts[0].passwordHash, hash);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('temporary ban stores persist metadata and maintain rolling violations', () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'server-kit-ban-'),
  );
  const filePath = path.join(tempDir, 'bans.json');
  let currentTime = 1_000;
  const identifyRequest = () => ({
    sourceIp: '203.0.113.4',
    banKey: 'stable-key',
  });

  try {
    const store = createTemporaryBanStore({
      filePath,
      durationMs: 500,
      windowMs: 100,
      now: () => currentTime,
      identifyRequest,
    });

    assert.equal(store.recordViolation('stable-key'), 1);
    assert.equal(store.recordViolation('stable-key'), 2);
    const applied = store.applyForRequest({}, {
      reason: 'test',
      banKey: 'untrusted-override',
      expiresAt: 99_999,
    });
    assert.equal(applied.banKey, 'stable-key');
    assert.equal(applied.expiresAt, 1_500);
    assert.equal(store.getActiveForRequest({}).reason, 'test');

    currentTime = 1_101;
    assert.equal(store.recordViolation('stable-key'), 1);
    currentTime = 1_501;
    assert.equal(store.getActiveForRequest({}), null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('bearer authentication middleware validates roles and attaches payloads', () => {
  const middleware = createBearerAuthMiddleware({
    verifyToken: (token) => {
      if (token !== 'valid') throw new Error('invalid');
      return { sub: 'account-1', role: 'admin' };
    },
    allowedRoles: ['admin'],
    requestProperty: 'operator',
  });
  const request = { headers: { authorization: 'Bearer valid' } };
  let nextCalled = false;

  middleware(
    request,
    {},
    () => {
      nextCalled = true;
    },
  );

  assert.equal(nextCalled, true);
  assert.equal(request.operator.sub, 'account-1');
});

test('JSONL helpers append, parse, and discover daily files', () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'server-kit-jsonl-'),
  );
  const basePath = path.join(tempDir, 'events.jsonl');
  const date = new Date('2026-07-28T12:00:00.000Z');
  const dailyPath = getDailyLogPath(basePath, date);

  try {
    assert.equal(appendJsonLine(dailyPath, { event: 'ok' }), true);
    assert.deepEqual(parseJsonLine('{"event":"ok"}'), { event: 'ok' });
    assert.equal(parseJsonLine('not json'), null);
    assert.deepEqual(listDailyLogPaths(basePath), [dailyPath]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('HTTP helpers enforce CORS allowlists and create liveness payloads', () => {
  const validateOrigin = createCorsOriginCallback({
    allowedOrigins: ['https://allowed.example'],
    allowPrivateNetwork: false,
  });

  validateOrigin('https://allowed.example', (error, allowed) => {
    assert.equal(error, null);
    assert.equal(allowed, true);
  });
  validateOrigin('https://blocked.example', (error) => {
    assert.match(error.message, /not allowed/);
  });

  assert.deepEqual(
    createLivenessPayload({
      version: '1.2.3',
      uptimeSeconds: 10,
      now: new Date('2026-07-28T12:00:00.000Z'),
    }),
    {
      ok: true,
      status: 'alive',
      version: '1.2.3',
      uptimeSeconds: 10,
      timestamp: '2026-07-28T12:00:00.000Z',
    },
  );
});
