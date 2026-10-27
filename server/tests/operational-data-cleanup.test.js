'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getOperationalDataPaths,
  collectOperationalDataFiles,
  flushOperationalDataFiles,
} = require('../lib/operational-data-cleanup');
const { parseArgs, formatBytes } = require('../scripts/flush-dashboard-data');

function writeFile(filePath, content = '{}\n') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

test('dashboard data cleanup finds only configured operational log families', () => {
  const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-dashboard-flush-test-'));
  const logsDir = path.join(serverRoot, 'logs');

  try {
    const config = getOperationalDataPaths({}, serverRoot);
    const expectedFiles = [
      path.join(logsDir, 'ai-responses.jsonl'),
      path.join(logsDir, 'ai-responses-08-13-2026.jsonl'),
      path.join(logsDir, 'conversation-status-08-14-2026.jsonl'),
      path.join(logsDir, 'conversation-transcript-08-14-2026.md'),
      path.join(logsDir, 'dashboard-audit.jsonl'),
    ];
    const protectedFiles = [
      path.join(serverRoot, 'data', 'dashboard-accounts.json'),
      path.join(serverRoot, 'data', 'message-filter-rules.json'),
      path.join(serverRoot, 'data', 'ban-store.json'),
      path.join(serverRoot, 'data', 'vector-store.json'),
      path.join(logsDir, 'unrelated.jsonl'),
    ];

    for (const filePath of [...expectedFiles, ...protectedFiles]) writeFile(filePath);

    const files = collectOperationalDataFiles(config);
    assert.deepEqual(files.map((file) => file.filePath).sort(), expectedFiles.sort());

    const dryRun = flushOperationalDataFiles(files, { dryRun: true });
    assert.equal(dryRun.wouldDelete.length, expectedFiles.length);
    assert.ok(expectedFiles.every((filePath) => fs.existsSync(filePath)));

    const result = flushOperationalDataFiles(files);
    assert.equal(result.deleted.length, expectedFiles.length);
    assert.equal(result.failed.length, 0);
    assert.ok(expectedFiles.every((filePath) => !fs.existsSync(filePath)));
    assert.ok(protectedFiles.every((filePath) => fs.existsSync(filePath)));
  } finally {
    fs.rmSync(serverRoot, { recursive: true, force: true });
  }
});

test('dashboard data cleanup resolves configured paths and validates CLI options', () => {
  const serverRoot = path.join(os.tmpdir(), 'oksbdc-dashboard-flush-config');
  const config = getOperationalDataPaths({
    AI_RESPONSE_LOG_PATH: 'custom/audit.jsonl',
    HUMAN_READABLE_LOG_PATH: 'custom/readable.md',
    CONVERSATION_STATUS_LOG_PATH: 'custom/status.jsonl',
    DASHBOARD_AUDIT_LOG_PATH: 'custom/dashboard.jsonl',
  }, serverRoot);

  assert.equal(config.aiResponseLogPath, path.join(serverRoot, 'custom', 'audit.jsonl'));
  assert.equal(config.humanReadableLogPath, path.join(serverRoot, 'custom', 'readable.md'));
  assert.deepEqual(parseArgs(['--dry-run', '--yes']), { dryRun: true, yes: true, help: false });
  assert.deepEqual(parseArgs(['-h']), { dryRun: false, yes: false, help: true });
  assert.throws(() => parseArgs(['--everything']), /Unknown option/);
  assert.equal(formatBytes(1024), '1.0 KiB');
});
