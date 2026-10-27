'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDailyLogPath, pruneExpiredLogs, startLogRetention } = require('..');

const DAY_MS = 86400000;
const fixture = t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'server-kit-retention-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
};

test('retention is configurable and touches only explicit log families, never symlinks', t => {
  const directory = fixture(t);
  const base = path.join(directory, 'events.jsonl');
  const now = new Date(2026, 9, 23, 12);
  const cutoff = new Date(now.getTime() - 7 * DAY_MS);
  const old = getDailyLogPath(base, new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate() - 1));
  const boundary = getDailyLogPath(base, cutoff);
  const unrelated = path.join(directory, 'unrelated-01-01-2020.jsonl');
  const invalid = path.join(directory, 'events-02-30-2020.jsonl');
  const link = path.join(directory, 'events-01-01-2020.jsonl');
  const broken = path.join(directory, 'events-01-02-2020.jsonl');
  for (const file of [old, boundary, unrelated, invalid]) fs.writeFileSync(file, 'test');
  fs.symlinkSync(unrelated, link);
  fs.symlinkSync(path.join(directory, 'missing-target'), broken);
  const result = pruneExpiredLogs([{ filePath: base, daily: true }], { now, retentionDays: 7 });
  assert.deepEqual(result.deleted, [old]);
  assert.deepEqual(result.failed, []);
  for (const file of [boundary, unrelated, invalid]) assert.equal(fs.existsSync(file), true);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(broken).isSymbolicLink(), true);
});

test('JSONL pruning preserves unknown ages, supports custom timestamp fields, and retains permissions', t => {
  const directory = fixture(t);
  const filePath = path.join(directory, 'audit.jsonl');
  const now = new Date('2026-10-23T12:00:00Z');
  const cutoff = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const kept = '{"at":"2026-10-23T12:00:00Z"}\n{"at":"invalid"}\n{"unknown":true}\nnull\nmalformed\n';
  fs.writeFileSync(filePath, `{"at":"2020-01-01T00:00:00Z"}\n{"at":"${cutoff}"}\n${kept}`, { mode: 0o640 });
  fs.chmodSync(filePath, 0o640);
  const options = { now, retentionDays: 7, getTimestamp: entry => entry?.at };
  const result = pruneExpiredLogs([filePath], options);
  assert.deepEqual(result.pruned, [filePath]);
  assert.equal(fs.readFileSync(filePath, 'utf8'), kept);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o640);
  assert.deepEqual(fs.readdirSync(directory), ['audit.jsonl']);
  assert.deepEqual(pruneExpiredLogs([filePath], options).pruned, []);
});

test('exact paths do not opt into daily discovery and non-JSONL logs use modification time', t => {
  const directory = fixture(t);
  const filePath = path.join(directory, 'transcript.md');
  const daily = getDailyLogPath(filePath, new Date(2020, 0, 1));
  for (const file of [filePath, daily]) fs.writeFileSync(file, 'legacy transcript');
  fs.utimesSync(filePath, new Date('2020-01-01'), new Date('2020-01-01'));
  const result = pruneExpiredLogs([filePath]);
  assert.deepEqual(result.deleted, [filePath]);
  assert.equal(fs.existsSync(daily), true);
});

test('one bad timestamp extractor leaves the file intact and reports failure', t => {
  const directory = fixture(t);
  const filePath = path.join(directory, 'audit.jsonl');
  const content = '{"timestamp":"2020-01-01"}\n';
  fs.writeFileSync(filePath, content);
  const result = pruneExpiredLogs([filePath], { getTimestamp() { throw new Error('invalid schema'); } });
  assert.equal(result.failed.length, 1);
  assert.equal(fs.readFileSync(filePath, 'utf8'), content);
});

test('scheduler runs at startup and at a custom interval without retaining the process', t => {
  const directory = fixture(t);
  const base = path.join(directory, 'events.jsonl');
  const old = getDailyLogPath(base, new Date(2020, 0, 1));
  fs.writeFileSync(old, '{}');
  let callback;
  let unreferenced = false;
  const timer = { unref() { unreferenced = true; } };
  const result = startLogRetention([{ filePath: base, daily: true }], {
    retentionDays: 30, intervalMs: 60000,
    schedule(run, interval) { callback = run; assert.equal(interval, 60000); return timer; },
    logger: { log() {}, error: error => assert.fail(error) },
  });
  assert.equal(fs.existsSync(old), false);
  assert.equal(result, timer);
  assert.equal(unreferenced, true);
  fs.writeFileSync(old, '{}'); callback();
  assert.equal(fs.existsSync(old), false);
});

test('invalid retention settings are rejected before deleting any files', () => {
  for (const retentionDays of [0, -1, NaN, Infinity]) {
    assert.throws(() => pruneExpiredLogs([], { retentionDays }), /retentionDays/);
  }
  assert.throws(() => pruneExpiredLogs([], { now: new Date(NaN) }), /valid current date/);
  assert.throws(() => pruneExpiredLogs([{}]), /filePath/);
  assert.throws(() => startLogRetention([], { intervalMs: 0 }), /intervalMs/);
});
