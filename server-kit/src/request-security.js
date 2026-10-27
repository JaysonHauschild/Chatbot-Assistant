'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function getRequestIdentity(request, options = {}) {
  const sourceIp = request?.ip;
  const userAgent =
    typeof request?.headers?.['user-agent'] === 'string'
      ? request.headers['user-agent']
      : '';
  const maximumUserAgentLength = Number.isFinite(options.maximumUserAgentLength)
    ? options.maximumUserAgentLength
    : 180;
  const keyLength = Number.isFinite(options.keyLength)
    ? options.keyLength
    : 24;
  const fingerprint = `${sourceIp}|${userAgent.slice(0, maximumUserAgentLength)}`;
  const banKey = crypto
    .createHash('sha256')
    .update(fingerprint, 'utf8')
    .digest('hex')
    .slice(0, keyLength);

  return { sourceIp, banKey };
}

function createTemporaryBanStore(options = {}) {
  const durationMs = Number.isFinite(options.durationMs)
    ? options.durationMs
    : 24 * 60 * 60 * 1000;
  const threshold = Number.isFinite(options.threshold)
    ? options.threshold
    : 5;
  const windowMs = Number.isFinite(options.windowMs)
    ? options.windowMs
    : 60 * 60 * 1000;
  const identifyRequest =
    options.identifyRequest || getRequestIdentity;
  const now = typeof options.now === 'function'
    ? options.now
    : () => Date.now();
  const onError =
    typeof options.onError === 'function'
      ? options.onError
      : (message, error) => console.error(message, error);

  let bans = new Map();
  const violationLog = new Map();

  function getFilePath() {
    const filePath =
      typeof options.getFilePath === 'function'
        ? options.getFilePath()
        : options.filePath;
    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw new Error('A temporary ban store filePath is required.');
    }
    return filePath;
  }

  function save() {
    try {
      const filePath = getFilePath();
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        `${JSON.stringify({ bans: [...bans.values()] }, null, 2)}\n`,
        'utf8',
      );
      return true;
    } catch (error) {
      onError('Unable to write temporary ban store:', error);
      return false;
    }
  }

  function load() {
    const filePath = getFilePath();
    if (!fs.existsSync(filePath)) {
      bans = new Map();
      return;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const rows = Array.isArray(parsed?.bans) ? parsed.bans : [];
      const currentTime = now();
      bans = new Map(
        rows
          .filter(
            (row) =>
              row &&
              typeof row === 'object' &&
              typeof row.banKey === 'string' &&
              Number.isFinite(row.expiresAt) &&
              row.expiresAt > currentTime,
          )
          .map((row) => [row.banKey, row]),
      );
    } catch (error) {
      onError('Unable to read temporary ban store:', error);
      bans = new Map();
    }
  }

  function pruneExpired() {
    const currentTime = now();
    let changed = false;

    for (const [banKey, entry] of bans.entries()) {
      if (
        !Number.isFinite(entry?.expiresAt) ||
        entry.expiresAt <= currentTime
      ) {
        bans.delete(banKey);
        changed = true;
      }
    }

    if (changed) save();
  }

  function getActiveForRequest(request) {
    pruneExpired();
    const identity = identifyRequest(request);
    const entry = bans.get(identity.banKey);
    return entry ? { ...entry, ...identity } : null;
  }

  function applyForRequest(request, metadata = {}) {
    pruneExpired();
    const identity = identifyRequest(request);
    const createdAt = now();
    const entry = {
      ...metadata,
      ...identity,
      createdAt,
      expiresAt: createdAt + durationMs,
    };

    bans.set(identity.banKey, entry);
    save();
    return {
      ...identity,
      expiresAt: entry.expiresAt,
    };
  }

  function recordViolation(banKey) {
    const currentTime = now();
    const cutoff = currentTime - windowMs;
    const timestamps = (violationLog.get(banKey) || []).filter(
      (timestamp) => timestamp > cutoff,
    );
    timestamps.push(currentTime);
    violationLog.set(banKey, timestamps);
    return timestamps.length;
  }

  function list() {
    pruneExpired();
    return [...bans.values()].sort(
      (left, right) => right.createdAt - left.createdAt,
    );
  }

  function remove(banKey) {
    const existed = bans.delete(banKey);
    if (existed) save();
    return existed;
  }

  function clear() {
    const count = bans.size;
    bans.clear();
    save();
    return count;
  }

  load();

  return Object.freeze({
    applyForRequest,
    clear,
    durationMs,
    getActiveForRequest,
    getRequestIdentity: identifyRequest,
    list,
    recordViolation,
    remove,
    threshold,
    windowMs,
  });
}

module.exports = {
  createTemporaryBanStore,
  getRequestIdentity,
};
