'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULT_NOTIFICATION_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function validateClaim({ timestamp, cooldownMs }) {
  if (!Number.isFinite(timestamp) || !Number.isSafeInteger(cooldownMs) || cooldownMs <= 0) {
    throw new RangeError('Cooldown claims require a finite timestamp and a positive integer cooldownMs.');
  }
}

// Each store represents one notification category. Share it to share a cooldown.
function createMemoryCooldownStore() {
  let lastAttemptAt = null;
  return {
    claim(options) {
      validateClaim(options);
      const { timestamp, cooldownMs } = options;
      if (lastAttemptAt !== null && timestamp - lastAttemptAt < cooldownMs) return false;
      lastAttemptAt = timestamp;
      return true;
    },
  };
}

function createFileCooldownStore({ filePath, getFilePath } = {}) {
  if (typeof getFilePath !== 'function' && (typeof filePath !== 'string' || !filePath.trim())) {
    throw new TypeError('A cooldown filePath or getFilePath function is required.');
  }
  return {
    claim(options) {
      validateClaim(options);
      const { timestamp, cooldownMs } = options;
      const statePath = getFilePath ? getFilePath() : filePath;
      let previous;
      try { previous = JSON.parse(fs.readFileSync(statePath, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (previous !== undefined && (!previous || Array.isArray(previous) || !Number.isFinite(previous.lastAttemptAt))) {
        throw new Error('Invalid notification cooldown state.');
      }
      if (previous && timestamp - previous.lastAttemptAt < cooldownMs) return false;
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporaryPath, JSON.stringify({ lastAttemptAt: timestamp }), { mode: 0o600, flag: 'wx' });
        fs.renameSync(temporaryPath, statePath);
      } finally {
        try { fs.unlinkSync(temporaryPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      return true;
    },
  };
}

// Accept a caller-owned Redis-compatible client; no Redis dependency or connection is created.
function createRedisCooldownStore({ client, key } = {}) {
  if (typeof client?.set !== 'function' || typeof key !== 'string' || !key.trim()) {
    throw new TypeError('A Redis-compatible client and a nonempty cooldown key are required.');
  }
  return {
    async claim(options) {
      validateClaim(options);
      const { timestamp, cooldownMs } = options;
      return await client.set(key, String(timestamp), 'PX', cooldownMs, 'NX') === 'OK';
    },
  };
}

function createCooldownNotifier({ send, prepare = (...args) => args[0], shouldNotify = () => true,
  store = createMemoryCooldownStore(), cooldownMs = DEFAULT_NOTIFICATION_COOLDOWN_MS,
  now = Date.now, onError = () => {} } = {}) {
  if (typeof send !== 'function' || typeof prepare !== 'function' || typeof shouldNotify !== 'function' ||
      typeof store?.claim !== 'function' || typeof now !== 'function' || typeof onError !== 'function') {
    throw new TypeError('Notifier callbacks and a cooldown store with claim() are required.');
  }
  validateClaim({ timestamp: 0, cooldownMs });
  let busy = false;
  return async function notify(...args) {
    if (busy) return false;
    busy = true;
    try {
      if (!await shouldNotify(...args)) return false;
      const message = await prepare(...args);
      // Missing credentials or recipients can skip a send without consuming a cooldown.
      if (message == null) return false;
      if (!await store.claim({ timestamp: now(), cooldownMs })) return false;
      // Reserve before delivery: an ambiguous transport failure still consumes the cooldown.
      await send(message);
      return true;
    } catch (error) {
      try { await onError(error); } catch { /* Error reporting must not reject a notification attempt. */ }
      return false;
    } finally { busy = false; }
  };
}

module.exports = { DEFAULT_NOTIFICATION_COOLDOWN_MS, createCooldownNotifier,
  createMemoryCooldownStore, createFileCooldownStore, createRedisCooldownStore };
