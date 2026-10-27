'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getDailyLogPath } = require('server-kit');
const { getOperationalDataPaths } = require('../lib/operational-data-cleanup');
const { pruneExpiredLogs, startLogRetention } = require('../lib/log-retention');

test('90-day retention removes expired log families, preserving cutoff day and unrelated files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-retention-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = getOperationalDataPaths({}, root);
  fs.mkdirSync(path.dirname(config.aiResponseLogPath), { recursive: true });
  const now = new Date(2026, 9, 8, 12);
  const cutoff = new Date(now.getTime() - 90 * 86400000);
  const old = new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate() - 1);
  const expired = [];
  const retained = [];
  for (const base of [config.aiResponseLogPath, config.conversationStatusLogPath, config.humanReadableLogPath]) {
    expired.push(getDailyLogPath(base, old));
    retained.push(getDailyLogPath(base, cutoff), getDailyLogPath(base, now));
  }
  retained.push(path.join(root, 'logs', 'unrelated-01-01-2020.jsonl'));
  retained.push(path.join(root, 'logs', 'ai-responses-02-30-2020.jsonl'));
  for (const file of [...expired, ...retained]) fs.writeFileSync(file, 'test');
  const link = path.join(root, 'logs', 'conversation-status-01-01-2020.jsonl');
  fs.symlinkSync(retained[0], link);
  const result = pruneExpiredLogs(config, now);
  assert.equal(result.deleted.length, 3);
  assert.deepEqual(result.failed, []);
  for (const file of expired) assert.equal(fs.existsSync(file), false);
  for (const file of retained) assert.equal(fs.existsSync(file), true);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
});

test('shared and legacy JSONL logs lose only expired timestamped entries', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-retention-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = getOperationalDataPaths({}, root);
  fs.mkdirSync(path.dirname(config.aiResponseLogPath), { recursive: true });
  const now = new Date('2026-10-08T12:00:00Z');
  const cutoff = new Date(now.getTime() - 90 * 86400000).toISOString();
  const kept = '{"timestamp":"2026-10-08T12:00:00Z"}\n{"timestamp":"invalid"}\n{"event":"unknown age"}\nmalformed\n';
  for (const file of [config.aiResponseLogPath, config.dashboardAuditLogPath]) {
    fs.writeFileSync(file, `{"timestamp":"2020-01-01T00:00:00Z"}\n{"timestamp":"${cutoff}"}\n${kept}`, { mode: 0o600 });
  }
  fs.writeFileSync(config.humanReadableLogPath, 'legacy transcript');
  fs.utimesSync(config.humanReadableLogPath, new Date('2020-01-01'), new Date('2020-01-01'));
  const result = pruneExpiredLogs(config, now);
  assert.equal(result.pruned.length, 2);
  assert.deepEqual(result.failed, []);
  for (const file of [config.aiResponseLogPath, config.dashboardAuditLogPath]) {
    assert.equal(fs.readFileSync(file, 'utf8'), kept);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  assert.equal(fs.existsSync(config.humanReadableLogPath), false);
  assert.deepEqual(pruneExpiredLogs(config, now).pruned, []);
});

test('scheduler cleans at startup and every day without keeping the process alive', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-retention-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = getOperationalDataPaths({}, root);
  fs.mkdirSync(path.dirname(config.aiResponseLogPath), { recursive: true });
  const file = getDailyLogPath(config.aiResponseLogPath, new Date(2020, 0, 1));
  fs.writeFileSync(file, '{}');
  let callback;
  let unreferenced = false;
  startLogRetention(config, {
    now: () => new Date(2026, 9, 8),
    schedule: (run, interval) => {
      callback = run;
      assert.equal(interval, 86400000);
      return { unref: () => { unreferenced = true; } };
    },
    logger: { log() {}, error(message) { assert.fail(message); } },
  });
  assert.equal(fs.existsSync(file), false);
  fs.writeFileSync(file, '{}');
  callback();
  assert.equal(fs.existsSync(file), false);
  assert.equal(unreferenced, true);
});
