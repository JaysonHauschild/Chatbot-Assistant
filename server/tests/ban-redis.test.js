'use strict';

// Exercises the Redis-backed ban store (server/lib/redis-ban-store.js, wired
// in through server/lib/ban.js when REDIS_URL is set) against ioredis-mock,
// so this runs offline without a live Redis. server/tests/ban.test.js covers
// the same public API against the file-backed fallback (no REDIS_URL).

const test = require('node:test');
const assert = require('node:assert/strict');
const RedisMock = require('ioredis-mock');

const IOREDIS_MODULE_PATH = require.resolve('ioredis');

function installIoredisMock() {
  require.cache[IOREDIS_MODULE_PATH] = {
    id: IOREDIS_MODULE_PATH,
    filename: IOREDIS_MODULE_PATH,
    loaded: true,
    exports: RedisMock,
  };
}

function clearModules() {
  delete require.cache[require.resolve('../lib/ban')];
  delete require.cache[require.resolve('../lib/redis-ban-store')];
  delete require.cache[require.resolve('../lib/redis-client')];
}

function makeReq(ip = '203.0.113.20', userAgent = 'redis-test-agent') {
  return {
    headers: { 'user-agent': userAgent },
    ip,
    socket: { remoteAddress: '127.0.0.1' },
  };
}

async function withRedisBanModule(run) {
  const originalRedisUrl = process.env.REDIS_URL;
  const originalBanStorePath = process.env.BAN_STORE_PATH;
  process.env.REDIS_URL = 'redis://localhost:6379/0';
  delete process.env.BAN_STORE_PATH;

  installIoredisMock();
  clearModules();

  const ban = require('../lib/ban');
  const { getRedisClient } = require('../lib/redis-client');

  try {
    await run(ban);
  } finally {
    await getRedisClient().flushall();
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
    if (originalBanStorePath === undefined) delete process.env.BAN_STORE_PATH;
    else process.env.BAN_STORE_PATH = originalBanStorePath;
    clearModules();
    delete require.cache[IOREDIS_MODULE_PATH];
  }
}

test('Redis-backed ban store applies, reads, lists, and deletes bans', async () => {
  await withRedisBanModule(async (ban) => {
    const req = makeReq();
    const identity = ban.getRequestBanIdentity(req);

    assert.equal(await ban.getActiveBanForRequest(req), null);

    const applied = await ban.applyTempBan(req, {
      conversationId: 'conv-redis',
      turn: 2,
      blockedByRule: 'prompt_injection',
      message: 'contact me at owner@example.com',
    });
    assert.equal(applied.banKey, identity.banKey);
    assert.ok(applied.expiresAt > Date.now());

    const active = await ban.getActiveBanForRequest(req);
    assert.equal(active.banKey, identity.banKey);
    assert.equal(active.conversationId, 'conv-redis');
    assert.equal(active.triggerMessageRedacted, 'contact me at [REDACTED_EMAIL]');

    const bans = await ban.getBans();
    assert.equal(bans.length, 1);
    assert.equal(bans[0].banKey, identity.banKey);

    assert.equal(await ban.deleteBan(identity.banKey), true);
    assert.equal(await ban.getActiveBanForRequest(req), null);
    assert.equal(await ban.deleteBan(identity.banKey), false);
  });
});

test('Redis-backed ban store counts violations within the rolling window', async () => {
  await withRedisBanModule(async (ban) => {
    const banKey = 'redis-violation-key';
    assert.equal(await ban.recordViolation(banKey), 1);
    assert.equal(await ban.recordViolation(banKey), 2);
    assert.equal(await ban.recordViolation(banKey), 3);
  });
});

test('Redis-backed ban store grants, lists, and revokes exemptions, clearing existing bans', async () => {
  await withRedisBanModule(async (ban) => {
    const req = makeReq();
    const identity = ban.getRequestBanIdentity(req);

    await ban.applyTempBan(req, {
      conversationId: 'conv-redis-exempt',
      turn: 1,
      blockedByRule: 'rate_limit',
      message: 'burst traffic',
    });
    assert.ok(await ban.getActiveBanForRequest(req));
    assert.equal(await ban.isBanExempt(identity.banKey), false);

    const exemption = await ban.grantBanExemption(req, 60_000);
    assert.equal(exemption.banKey, identity.banKey);

    assert.equal(await ban.getActiveBanForRequest(req), null, 'granting an exemption clears the existing ban');
    assert.equal(await ban.isBanExempt(identity.banKey), true);

    const listed = await ban.listBanExemptions();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].banKey, identity.banKey);

    assert.equal(await ban.revokeBanExemption(identity.banKey), true);
    assert.equal(await ban.isBanExempt(identity.banKey), false);
    assert.equal(await ban.revokeBanExemption(identity.banKey), false);
  });
});

test('Redis-backed ban store clears all active bans', async () => {
  await withRedisBanModule(async (ban) => {
    await ban.applyTempBan(makeReq('203.0.113.21'), {
      conversationId: 'conv-a',
      turn: 1,
      blockedByRule: 'rule_a',
      message: 'a',
    });
    await ban.applyTempBan(makeReq('203.0.113.22'), {
      conversationId: 'conv-b',
      turn: 1,
      blockedByRule: 'rule_b',
      message: 'b',
    });

    assert.equal((await ban.getBans()).length, 2);
    assert.equal(await ban.clearAllBans(), 2);
    assert.equal((await ban.getBans()).length, 0);
  });
});

test('Redis-backed ban store fails open (not banned, no violation) when Redis errors', async () => {
  await withRedisBanModule(async (ban) => {
    const { getRedisClient } = require('../lib/redis-client');
    const client = getRedisClient();
    const originalGet = client.get.bind(client);
    const originalMulti = client.multi.bind(client);
    client.get = async () => {
      throw new Error('simulated Redis outage');
    };
    client.multi = () => {
      throw new Error('simulated Redis outage');
    };

    try {
      const req = makeReq();
      assert.equal(await ban.getActiveBanForRequest(req), null);
      assert.equal(await ban.recordViolation('some-key'), 0);
    } finally {
      client.get = originalGet;
      client.multi = originalMulti;
    }
  });
});
