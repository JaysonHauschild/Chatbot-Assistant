'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWorkTracker } = require('../lib/work-tracker');

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('drain waits for handler work after the response finishes and background work added during draining', async () => {
  const tracker = createWorkTracker();
  const res = new EventEmitter();
  const classification = deferred();
  const alert = deferred();
  tracker.requestMiddleware({}, res, () => {});
  const handler = tracker.trackHandler(async () => {
    res.emit('finish');
    await classification.promise;
    return tracker.trackBackgroundTask(() => alert.promise);
  });
  const operation = handler({}, res, () => {});
  let drained = false;
  const drain = tracker.waitForDrain().then(() => { drained = true; });
  await tick();
  assert.equal(drained, false);
  assert.equal(tracker.getCounts().requests, 1);
  classification.resolve();
  await tick();
  assert.equal(drained, false);
  assert.equal(tracker.getCounts().backgroundTasks, 1);
  alert.resolve();
  await Promise.all([operation, drain]);
  assert.deepEqual(tracker.getCounts(), { requests: 0, backgroundTasks: 0 });
});

test('finish listeners can register deferred alerts without a false empty drain', async () => {
  const tracker = createWorkTracker();
  const res = new EventEmitter();
  const alert = deferred();
  tracker.requestMiddleware({}, res, () => {});
  res.once('finish', () => { void tracker.trackBackgroundTask(() => alert.promise); });
  let drained = false;
  const drain = tracker.waitForDrain().then(() => { drained = true; });
  res.emit('finish');
  await tick();
  assert.equal(drained, false);
  alert.resolve();
  await drain;
});

test('failures and disconnects release tracking without swallowing handler errors', async () => {
  const tracker = createWorkTracker();
  const error = new Error('expected');
  assert.throws(() => tracker.trackHandler(() => { throw error; })(), /expected/);
  await assert.rejects(tracker.trackHandler(async () => { throw error; })(), /expected/);
  await assert.rejects(tracker.trackBackgroundTask(async () => { throw error; }), /expected/);
  const res = new EventEmitter();
  tracker.requestMiddleware({}, res, () => {});
  res.emit('close');
  res.emit('finish');
  await tracker.waitForDrain();
  assert.deepEqual(tracker.getCounts(), { requests: 0, backgroundTasks: 0 });
});
