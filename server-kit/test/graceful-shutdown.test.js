'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkTracker } = require('..');
const { createShutdownHandler } = require('..');

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

test('application hook failures force cleanup once instead of escaping a signal handler', async () => {
  const { events, shutdown } = fixture({ beginShutdown: () => { throw new Error('failed to mark shutdown'); } });
  const first = shutdown('SIGTERM');
  assert.equal(shutdown('SIGINT'), first);
  await first;
  assert.deepEqual(events, ['force-close', 'disconnect', 'exit-1']);
});

test('resource cleanup errors force a failure exit and invalid deadlines are rejected', async () => {
  const { events, shutdown } = fixture({ cleanup: async () => { throw new Error('cleanup failed'); } });
  await shutdown('SIGTERM');
  assert.deepEqual(events, ['reject-new-work', 'close', 'force-close', 'disconnect', 'exit-1']);
  for (const timeoutMs of [0, -1, Infinity, 1.5, 2147483648]) {
    assert.throws(() => fixture({ timeoutMs }), /timeoutMs/);
  }
  assert.throws(() => createShutdownHandler(), /server and work tracker/);
});

