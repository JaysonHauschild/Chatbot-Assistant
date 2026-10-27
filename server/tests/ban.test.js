'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function clearBanModule() {
  delete require.cache[require.resolve('../lib/ban')];
}

// `ip` mirrors what Express's `req.ip` resolves to once `trust proxy` has
// already accounted for the deployment's reverse-proxy hop(s) — ban identity
// now trusts that resolved value directly rather than re-parsing the raw
// X-Forwarded-For header itself.
function makeReq(ip = '203.0.113.10', userAgent = 'test-agent') {
  return {
    headers: {
      'x-forwarded-for': `${ip}, 198.51.100.5`,
      'user-agent': userAgent,
    },
    ip,
    socket: { remoteAddress: '127.0.0.1' },
  };
}

test('ban enforcement is opt-in while threshold decisions remain observable', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-ban-flag-test-'));
  const originalBanStorePath = process.env.BAN_STORE_PATH;
  const originalBanEnforcementEnabled = process.env.BAN_ENFORCEMENT_ENABLED;
  process.env.BAN_STORE_PATH = path.join(tempDir, 'ban-store.json');

  try {
    delete process.env.BAN_ENFORCEMENT_ENABLED;
    clearBanModule();
    let ban = require('../lib/ban');
    assert.equal(ban.BAN_ENFORCEMENT_ENABLED, false);
    assert.deepEqual(ban.getBanEnforcementDecision(ban.BAN_THRESHOLD, false), {
      enforcementEnabled: false,
      thresholdReached: true,
      wouldApplyBan: true,
      shouldApplyBan: false,
    });

    process.env.BAN_ENFORCEMENT_ENABLED = 'true';
    clearBanModule();
    ban = require('../lib/ban');
    assert.equal(ban.BAN_ENFORCEMENT_ENABLED, true);
    assert.deepEqual(ban.getBanEnforcementDecision(ban.BAN_THRESHOLD, false), {
      enforcementEnabled: true,
      thresholdReached: true,
      wouldApplyBan: true,
      shouldApplyBan: true,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalBanStorePath === undefined) delete process.env.BAN_STORE_PATH;
    else process.env.BAN_STORE_PATH = originalBanStorePath;
    if (originalBanEnforcementEnabled === undefined) delete process.env.BAN_ENFORCEMENT_ENABLED;
    else process.env.BAN_ENFORCEMENT_ENABLED = originalBanEnforcementEnabled;
    clearBanModule();
  }
});

test('ban store fingerprints request identity, persists redacted bans, sorts and deletes active bans', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-ban-test-'));
  const originalBanStorePath = process.env.BAN_STORE_PATH;
  process.env.BAN_STORE_PATH = path.join(tempDir, 'ban-store.json');

  try {
    clearBanModule();
    let ban = require('../lib/ban');
    const req = makeReq();
    const identity = ban.getRequestBanIdentity(req);

    assert.equal(identity.sourceIp, '203.0.113.10');
    assert.match(identity.banKey, /^[a-f0-9]{24}$/);
    assert.equal(await ban.getActiveBanForRequest(req), null);

    const first = await ban.applyTempBan(req, {
      conversationId: 'conv-ban',
      turn: 4,
      blockedByRule: 'prompt_injection',
      message: 'My phone is 405-555-1212 and email is owner@example.com',
    });
    assert.equal(first.banKey, identity.banKey);
    assert.ok(first.expiresAt > Date.now());

    const persisted = JSON.parse(fs.readFileSync(process.env.BAN_STORE_PATH, 'utf8'));
    assert.equal(persisted.bans.length, 1);
    assert.equal(persisted.bans[0].triggerMessageRedacted, 'My phone is [REDACTED_PHONE] and email is [REDACTED_EMAIL]');

    clearBanModule();
    ban = require('../lib/ban');
    const active = await ban.getActiveBanForRequest(req);
    assert.equal(active.banKey, identity.banKey);
    assert.equal(active.conversationId, 'conv-ban');
    assert.equal((await ban.getBans()).length, 1);
    assert.equal(await ban.deleteBan(identity.banKey), true);
    assert.equal((await ban.getBans()).length, 0);
    assert.equal(await ban.deleteBan(identity.banKey), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalBanStorePath === undefined) delete process.env.BAN_STORE_PATH;
    else process.env.BAN_STORE_PATH = originalBanStorePath;
    clearBanModule();
  }
});

test('grantBanExemption clears an existing ban and prevents re-banning until it expires', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-ban-exempt-test-'));
  const originalBanStorePath = process.env.BAN_STORE_PATH;
  process.env.BAN_STORE_PATH = path.join(tempDir, 'ban-store.json');
  const originalDateNow = Date.now;

  try {
    clearBanModule();
    const ban = require('../lib/ban');
    const req = makeReq();
    const identity = ban.getRequestBanIdentity(req);

    await ban.applyTempBan(req, {
      conversationId: 'conv-ban',
      turn: 1,
      blockedByRule: 'rate_limit',
      message: 'burst traffic',
    });
    assert.ok(await ban.getActiveBanForRequest(req));
    assert.equal(await ban.isBanExempt(identity.banKey), false);

    Date.now = () => 2_000_000;
    const exemption = await ban.grantBanExemption(req, 60_000);
    assert.equal(exemption.banKey, identity.banKey);
    assert.equal(exemption.expiresAt, 2_000_000 + 60_000);

    // Granting an exemption clears any pre-existing ban for that identity.
    assert.equal(await ban.getActiveBanForRequest(req), null);
    assert.equal(await ban.isBanExempt(identity.banKey), true);

    const listed = await ban.listBanExemptions();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].banKey, identity.banKey);

    Date.now = () => 2_000_000 + 60_000 + 1;
    assert.equal(await ban.isBanExempt(identity.banKey), false);
    assert.equal((await ban.listBanExemptions()).length, 0);
  } finally {
    Date.now = originalDateNow;
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalBanStorePath === undefined) delete process.env.BAN_STORE_PATH;
    else process.env.BAN_STORE_PATH = originalBanStorePath;
    clearBanModule();
  }
});

test('revokeBanExemption ends an exemption early', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-ban-revoke-test-'));
  const originalBanStorePath = process.env.BAN_STORE_PATH;
  process.env.BAN_STORE_PATH = path.join(tempDir, 'ban-store.json');

  try {
    clearBanModule();
    const ban = require('../lib/ban');
    const req = makeReq();
    const identity = ban.getRequestBanIdentity(req);

    await ban.grantBanExemption(req, 60_000);
    assert.equal(await ban.isBanExempt(identity.banKey), true);
    assert.equal(await ban.revokeBanExemption(identity.banKey), true);
    assert.equal(await ban.isBanExempt(identity.banKey), false);
    assert.equal(await ban.revokeBanExemption(identity.banKey), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalBanStorePath === undefined) delete process.env.BAN_STORE_PATH;
    else process.env.BAN_STORE_PATH = originalBanStorePath;
    clearBanModule();
  }
});

test('recordViolation counts only recent violations for a ban key', async () => {
  const originalBanStorePath = process.env.BAN_STORE_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-violation-test-'));
  process.env.BAN_STORE_PATH = path.join(tempDir, 'ban-store.json');

  const originalDateNow = Date.now;

  try {
    clearBanModule();
    const ban = require('../lib/ban');
    Date.now = () => 1_000_000;
    assert.equal(await ban.recordViolation('key'), 1);
    assert.equal(await ban.recordViolation('key'), 2);
    Date.now = () => 1_000_000 + ban.BAN_WINDOW_MS + 1;
    assert.equal(await ban.recordViolation('key'), 1);
  } finally {
    Date.now = originalDateNow;
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalBanStorePath === undefined) delete process.env.BAN_STORE_PATH;
    else process.env.BAN_STORE_PATH = originalBanStorePath;
    clearBanModule();
  }
});
