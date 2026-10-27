'use strict';

// Redis-backed equivalent of server-kit's file-backed createTemporaryBanStore
// (server-kit/src/request-security.js), used when REDIS_URL is configured so
// bans, violation windows, and exemptions are shared across instances behind
// a load balancer instead of living in one process's memory/disk.
//
// Every operation fails open: a Redis error is logged and the call returns
// the same value it would if the client simply weren't banned/exempt/in
// violation, rather than throwing and turning a Redis outage into a 500 or
// an outright block of legitimate traffic. This matches the rest of the
// codebase's "degrade to a safe response instead of failing the request"
// philosophy (see server/routes/chat.js).

const { getRequestIdentity } = require('server-kit/request-security');

const BAN_KEY_PREFIX = 'oksbdc:ban:';
const VIOLATION_KEY_PREFIX = 'oksbdc:violation:';
const EXEMPTION_KEY_PREFIX = 'oksbdc:exempt:';

function createRedisBanStore(options = {}) {
  const getClient = options.getClient;
  if (typeof getClient !== 'function') {
    throw new Error('createRedisBanStore requires a getClient() function.');
  }

  const durationMs = Number.isFinite(options.durationMs) ? options.durationMs : 24 * 60 * 60 * 1000;
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 5;
  const windowMs = Number.isFinite(options.windowMs) ? options.windowMs : 60 * 60 * 1000;
  const defaultExemptionDurationMs = Number.isFinite(options.defaultExemptionDurationMs)
    ? options.defaultExemptionDurationMs
    : 60 * 60 * 1000;
  const maxExemptionDurationMs = Number.isFinite(options.maxExemptionDurationMs)
    ? options.maxExemptionDurationMs
    : 24 * 60 * 60 * 1000;
  const identifyRequest = options.identifyRequest || getRequestIdentity;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const onError = typeof options.onError === 'function'
    ? options.onError
    : (message, error) => console.error(message, error);

  async function scanKeys(prefix) {
    const client = getClient();
    const keys = [];
    let cursor = '0';
    do {
      // eslint-disable-next-line no-await-in-loop
      const [nextCursor, batch] = await client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');
    return keys;
  }

  async function applyForRequest(request, metadata = {}) {
    const identity = identifyRequest(request);
    const createdAt = now();
    const expiresAt = createdAt + durationMs;
    const entry = { ...metadata, ...identity, createdAt, expiresAt };

    try {
      const client = getClient();
      await client.set(`${BAN_KEY_PREFIX}${identity.banKey}`, JSON.stringify(entry), 'PX', durationMs);
    } catch (error) {
      onError('Unable to write Redis ban entry:', error);
    }

    return { ...identity, expiresAt };
  }

  async function getActiveForRequest(request) {
    const identity = identifyRequest(request);
    try {
      const client = getClient();
      const raw = await client.get(`${BAN_KEY_PREFIX}${identity.banKey}`);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      return { ...entry, ...identity };
    } catch (error) {
      onError('Unable to read Redis ban entry:', error);
      return null;
    }
  }

  async function recordViolation(banKey) {
    try {
      const client = getClient();
      const currentTime = now();
      const cutoff = currentTime - windowMs;
      const key = `${VIOLATION_KEY_PREFIX}${banKey}`;
      const member = `${currentTime}:${Math.random().toString(36).slice(2)}`;

      const results = await client
        .multi()
        .zadd(key, currentTime, member)
        .zremrangebyscore(key, 0, cutoff)
        .zcard(key)
        .pexpire(key, windowMs)
        .exec();

      // ioredis multi().exec() resolves to [[err, reply], ...] per command.
      const zcardResult = results?.[2];
      const count = Array.isArray(zcardResult) ? zcardResult[1] : 0;
      return Number.isFinite(count) ? count : 0;
    } catch (error) {
      onError('Unable to record Redis ban violation:', error);
      return 0;
    }
  }

  async function list() {
    try {
      const keys = await scanKeys(BAN_KEY_PREFIX);
      if (!keys.length) return [];
      const client = getClient();
      const rows = await client.mget(...keys);
      return rows
        .map((raw) => {
          try {
            return raw ? JSON.parse(raw) : null;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((left, right) => right.createdAt - left.createdAt);
    } catch (error) {
      onError('Unable to list Redis ban entries:', error);
      return [];
    }
  }

  async function remove(banKey) {
    try {
      const client = getClient();
      const deletedCount = await client.del(`${BAN_KEY_PREFIX}${banKey}`);
      return deletedCount > 0;
    } catch (error) {
      onError('Unable to remove Redis ban entry:', error);
      return false;
    }
  }

  async function clear() {
    try {
      const keys = await scanKeys(BAN_KEY_PREFIX);
      if (!keys.length) return 0;
      const client = getClient();
      await client.del(...keys);
      return keys.length;
    } catch (error) {
      onError('Unable to clear Redis ban entries:', error);
      return 0;
    }
  }

  async function grantExemption(request, requestedDurationMs = defaultExemptionDurationMs) {
    const identity = identifyRequest(request);
    const clampedDurationMs = Number.isFinite(requestedDurationMs) && requestedDurationMs > 0
      ? Math.min(requestedDurationMs, maxExemptionDurationMs)
      : defaultExemptionDurationMs;
    const expiresAt = now() + clampedDurationMs;

    try {
      const client = getClient();
      await client
        .multi()
        .set(`${EXEMPTION_KEY_PREFIX}${identity.banKey}`, String(expiresAt), 'PX', clampedDurationMs)
        .del(`${BAN_KEY_PREFIX}${identity.banKey}`)
        .exec();
    } catch (error) {
      onError('Unable to write Redis ban exemption:', error);
    }

    return { ...identity, expiresAt };
  }

  async function isExempt(banKey) {
    try {
      const client = getClient();
      const raw = await client.get(`${EXEMPTION_KEY_PREFIX}${banKey}`);
      return raw !== null;
    } catch (error) {
      onError('Unable to read Redis ban exemption:', error);
      return false;
    }
  }

  async function revokeExemption(banKey) {
    try {
      const client = getClient();
      const deletedCount = await client.del(`${EXEMPTION_KEY_PREFIX}${banKey}`);
      return deletedCount > 0;
    } catch (error) {
      onError('Unable to revoke Redis ban exemption:', error);
      return false;
    }
  }

  async function listExemptions() {
    try {
      const keys = await scanKeys(EXEMPTION_KEY_PREFIX);
      if (!keys.length) return [];
      const client = getClient();
      const rows = await client.mget(...keys);
      return keys
        .map((key, index) => ({
          banKey: key.slice(EXEMPTION_KEY_PREFIX.length),
          expiresAt: Number(rows[index]),
        }))
        .filter((entry) => Number.isFinite(entry.expiresAt));
    } catch (error) {
      onError('Unable to list Redis ban exemptions:', error);
      return [];
    }
  }

  return Object.freeze({
    applyForRequest,
    clear,
    durationMs,
    getActiveForRequest,
    getRequestIdentity: identifyRequest,
    grantExemption,
    isExempt,
    list,
    listExemptions,
    recordViolation,
    remove,
    revokeExemption,
    threshold,
    windowMs,
  });
}

module.exports = {
  createRedisBanStore,
};
