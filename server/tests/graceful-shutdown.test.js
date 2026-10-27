'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkTracker } = require('../lib/work-tracker');
const { createShutdownHandler } = require('../lib/graceful-shutdown');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function fixture(options = {}) {
  const events = [];
  const tracker = createWorkTracker();
  const shutdown = createShutdownHandler({
    server: {
      close: (callback) => { events.push('close'); setImmediate(callback); },
      closeAllConnections: () => events.push('force-close'),
    },
    tracker,
    beginShutdown: () => events.push('reject-new-work'),
    cleanup: async () => events.push('cleanup'),
    forceCleanup: () => events.push('disconnect'),
    exit: (code) => events.push(`exit-${code}`),
    logger: { log() {}, error() {} },
    timeoutMs: 1000,
    ...options,
  });
  return { events, tracker, shutdown };
}

test('repeated signals drain all work before cleanup and successful exit', async () => {
  const { events, tracker, shutdown } = fixture();
  const request = deferred();
  const alert = deferred();
  const requestWork = tracker.trackHandler(() => request.promise)();
  const alertWork = tracker.trackBackgroundTask(() => alert.promise);
  const stopping = shutdown('SIGTERM');
  assert.equal(shutdown('SIGINT'), stopping);
  await tick();
  assert.deepEqual(events, ['reject-new-work', 'close']);
  request.resolve();
  await tick();
  assert.deepEqual(events, ['reject-new-work', 'close']);
  alert.resolve();
  await Promise.all([requestWork, alertWork, stopping]);
  assert.deepEqual(events, ['reject-new-work', 'close', 'cleanup', 'exit-0']);
});

test('deadline forces connections and resources closed when a handler never settles', async () => {
  const { events, tracker, shutdown } = fixture({ timeoutMs: 25 });
  void tracker.trackHandler(() => new Promise(() => {}))();
  await shutdown('SIGTERM');
  assert.deepEqual(events, ['reject-new-work', 'close', 'force-close', 'disconnect', 'exit-1']);
});

test('the same deadline also bounds hung resource cleanup', async () => {
  const { events, shutdown } = fixture({ timeoutMs: 25, cleanup: () => new Promise(() => {}) });
  await shutdown('SIGTERM');
  assert.deepEqual(events, ['reject-new-work', 'close', 'force-close', 'disconnect', 'exit-1']);
});

test('HTTP close errors force cleanup and a failure exit', async () => {
  const { events, shutdown } = fixture({
    server: {
      close: (callback) => callback(new Error('close failed')),
      closeAllConnections: () => {},
    },
  });
  await shutdown('SIGTERM');
  assert.deepEqual(events, ['reject-new-work', 'disconnect', 'exit-1']);
});

test('the server entry point handles SIGTERM and exits cleanly without creating external connections', { timeout: 15000 }, async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawn } = require('node:child_process');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-shutdown-'));
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: '0', GEMINI_API_KEY: 'test-key', JWT_SECRET: 'shutdown-test-secret',
      REDIS_URL: '', GMAIL_USER: '', GMAIL_APP_PASSWORD: '',
      RAG_PRELOAD_DISABLED: 'true', SHUTDOWN_TIMEOUT_MS: '1000',
      AI_RESPONSE_LOG_PATH: path.join(directory, 'ai-responses.jsonl'),
      HUMAN_READABLE_LOG_PATH: path.join(directory, 'transcript.md'),
      CONVERSATION_STATUS_LOG_PATH: path.join(directory, 'status.jsonl'),
      DASHBOARD_AUDIT_LOG_PATH: path.join(directory, 'audit.jsonl'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Startup timed out: ${output}`)), 10000);
      const onData = (chunk) => {
        output += chunk.toString();
        if (output.includes('Server listening on')) { clearTimeout(timer); resolve(); }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      exited.then(() => { clearTimeout(timer); reject(new Error(`Exited before startup: ${output}`)); });
    });
    child.kill('SIGTERM');
    assert.deepEqual(await exited, { code: 0, signal: null });
    assert.match(output, /Draining requests and background tasks/);
    assert.match(output, /Requests, background tasks, and resources drained/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
