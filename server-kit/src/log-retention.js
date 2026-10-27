'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { parseDailyLogPath } = require('./jsonl');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOG_RETENTION_DAYS = 90;

function validateRetentionDays(retentionDays) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0 || !Number.isFinite(retentionDays * DAY_MS)) {
    throw new RangeError('Log retentionDays must be a positive finite number.');
  }
}

function normalizeSources(sources) {
  if (!Array.isArray(sources)) throw new TypeError('Log sources must be an array.');
  const bases = new Map();
  for (const source of sources) {
    const descriptor = typeof source === 'string' ? { filePath: source } : source;
    if (typeof descriptor?.filePath !== 'string' || !descriptor.filePath.trim()) {
      throw new TypeError('Each log source requires a nonempty filePath.');
    }
    const filePath = path.resolve(descriptor.filePath);
    bases.set(filePath, { filePath, daily: descriptor.daily === true || bases.get(filePath)?.daily === true });
  }
  return [...bases.values()];
}

function pruneExpiredLogs(sources, { now = new Date(), retentionDays = DEFAULT_LOG_RETENTION_DAYS,
  getTimestamp = entry => entry?.timestamp } = {}) {
  validateRetentionDays(retentionDays);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('Log retention requires a valid current date.');
  if (typeof getTimestamp !== 'function') throw new TypeError('getTimestamp must be a function.');
  const cutoff = now.getTime() - retentionDays * DAY_MS;
  const result = { deleted: [], pruned: [], failed: [] };
  const bases = normalizeSources(sources);
  const files = new Map(bases.map(source => [source.filePath, { filePath: source.filePath }]));

  for (const source of bases.filter(source => source.daily)) {
    try {
      for (const name of fs.readdirSync(path.dirname(source.filePath))) {
        const filePath = path.join(path.dirname(source.filePath), name);
        const stamp = parseDailyLogPath(filePath, source.filePath);
        if (stamp && !files.has(filePath)) files.set(filePath, { filePath, stamp });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') result.failed.push({ filePath: source.filePath, error: error.message });
    }
  }

  for (const { filePath, stamp } of files.values()) {
    try {
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile()) continue; // Never follow symlink entries.
      if (stamp) {
        const year = Math.floor(stamp / 10000);
        const month = Math.floor(stamp / 100) % 100;
        const day = stamp % 100;
        const start = new Date(year, month - 1, day);
        if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) continue;
        // Whole daily files stay until the end of their local calendar day expires.
        if (new Date(year, month - 1, day + 1).getTime() > cutoff) continue;
        fs.unlinkSync(filePath);
        result.deleted.push(filePath);
      } else if (path.extname(filePath).toLowerCase() === '.jsonl') {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n');
        const kept = lines.filter(line => {
          let entry;
          try { entry = JSON.parse(line); } catch { return true; }
          const value = getTimestamp(entry);
          const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
          return !Number.isFinite(timestamp) || timestamp > cutoff;
        });
        if (kept.length === lines.length) continue;
        const temporaryPath = `${filePath}.retention-${randomUUID()}.tmp`;
        try {
          fs.writeFileSync(temporaryPath, kept.join('\n'), { mode: stat.mode & 0o777, flag: 'wx' });
          fs.chmodSync(temporaryPath, stat.mode & 0o777);
          fs.renameSync(temporaryPath, filePath);
        } finally {
          try { fs.unlinkSync(temporaryPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        result.pruned.push(filePath);
      } else if (stat.mtimeMs <= cutoff) {
        fs.unlinkSync(filePath);
        result.deleted.push(filePath);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') result.failed.push({ filePath, error: error.message });
    }
  }
  return result;
}

function startLogRetention(sources, { now = () => new Date(), retentionDays = DEFAULT_LOG_RETENTION_DAYS,
  intervalMs = DAY_MS, schedule = setInterval, logger = console, getTimestamp } = {}) {
  validateRetentionDays(retentionDays);
  normalizeSources(sources);
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0 || intervalMs > 2147483647) {
    throw new RangeError('Log retention intervalMs must be a positive integer no greater than 2147483647.');
  }
  const run = () => {
    try {
      const result = pruneExpiredLogs(sources, { now: now(), retentionDays, getTimestamp });
      if (result.deleted.length || result.pruned.length) {
        logger.log(`Log retention (${retentionDays} days): deleted ${result.deleted.length} file(s), pruned ${result.pruned.length} file(s).`);
      }
      for (const failure of result.failed) logger.error('Log retention failed:', failure);
    } catch (error) { logger.error('Log retention failed:', error.message); }
  };
  run();
  const timer = schedule(run, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = { DEFAULT_LOG_RETENTION_DAYS, pruneExpiredLogs, startLogRetention };
