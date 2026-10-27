'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCooldownNotifier, createMemoryCooldownStore, createFileCooldownStore,
  createRedisCooldownStore } = require('..');

test('memory cooldown is shared across notifiers and expires at the exact configured boundary', async () => {
  let timestamp = 0;
  const messages = [];
  const store = createMemoryCooldownStore();
  const options = { store, cooldownMs: 100, now: () => timestamp, send: async message => messages.push(message) };
  const first = createCooldownNotifier(options);
  const second = createCooldownNotifier(options);
  await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second)('hello')));
  assert.deepEqual(messages, ['hello']);
  timestamp = 99;
  assert.equal(await first('too soon'), false);
  timestamp = 100;
  assert.equal(await second('again'), true);
  assert.deepEqual(messages, ['hello', 'again']);
});

test('eligibility and message preparation can skip delivery without consuming cooldown', async () => {
  const sent = [];
  const notify = createCooldownNotifier({ cooldownMs: 1000, now: () => 0,
    shouldNotify: event => event.enabled,
    prepare: event => event.recipient ? { to: event.recipient, text: event.text } : null,
    send: message => sent.push(message) });
  assert.equal(await notify({ enabled: false }), false);
  assert.equal(await notify({ enabled: true }), false);
  assert.equal(await notify({ enabled: true, recipient: 'operator@example.com', text: 'test' }), true);
  assert.deepEqual(sent, [{ to: 'operator@example.com', text: 'test' }]);
});

test('a pending send suppresses duplicates and delivery failures consume cooldown', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  let sent = 0;
  const failures = [];
  const notify = createCooldownNotifier({ now: () => 0, cooldownMs: 1000,
    send: async () => { sent++; await pending; throw new Error('delivery failed'); },
    onError: error => failures.push(error.message) });
  const first = notify('test');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await notify('duplicate'), false);
  finish();
  assert.equal(await first, false);
  assert.equal(await notify('retry'), false);
  assert.equal(sent, 1);
  assert.deepEqual(failures, ['delivery failed']);
});

test('file cooldowns survive recreation, read legacy state, and leave no temporary files', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'server-kit-cooldown-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'cooldown.json');
  fs.writeFileSync(filePath, JSON.stringify({ lastAttemptAt: 0 }), { mode: 0o600 });
  let timestamp = 99;
  let sent = 0;
  const options = { cooldownMs: 100, now: () => timestamp, send: () => { sent++; } };
  const notify = () => createCooldownNotifier({ ...options, store: createFileCooldownStore({ filePath }) });
  assert.equal(await notify()('event'), false);
  timestamp = 100;
  assert.equal(await notify()('event'), true);
  assert.equal(await notify()('event'), false);
  assert.equal(sent, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), { lastAttemptAt: 100 });
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(directory), ['cooldown.json']);
});

test('invalid persistent state and storage failures prevent notification storms', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'server-kit-cooldown-invalid-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'cooldown.json');
  for (const content of ['not json', 'null', '[]', '{}', '{"lastAttemptAt":"yesterday"}']) {
    fs.writeFileSync(filePath, content);
    let failed = false;
    const notify = createCooldownNotifier({ store: createFileCooldownStore({ filePath }),
      send: () => assert.fail('must not send'), onError: () => { failed = true; } });
    assert.equal(await notify('event'), false);
    assert.equal(failed, true);
    assert.equal(fs.readFileSync(filePath, 'utf8'), content);
  }
  const notify = createCooldownNotifier({ store: { claim() { throw new Error('offline'); } },
    send: () => assert.fail('must not send'), onError: () => { throw new Error('reporting also failed'); } });
  assert.equal(await notify('event'), false);
});

test('Redis adapter uses caller-owned clients and atomic expiring claims across instances', async () => {
  const commands = [];
  const keys = new Map();
  let timestamp = 0;
  const client = { async set(key, value, px, duration, nx) {
    commands.push([key, value, px, duration, nx]);
    if (keys.get(key) > timestamp) return null;
    keys.set(key, timestamp + duration);
    return 'OK';
  } };
  let sent = 0;
  const options = { cooldownMs: 100, now: () => timestamp, send: () => { sent++; } };
  const notify = key => createCooldownNotifier({ ...options, store: createRedisCooldownStore({ client, key }) });
  await Promise.all([notify('first')('event'), notify('first')('event'), notify('second')('event')]);
  assert.equal(sent, 2);
  assert.deepEqual(commands[0], ['first', '0', 'PX', 100, 'NX']);
  timestamp = 100;
  assert.equal(await notify('first')('event'), true);
});

test('public factories reject invalid cooldown configuration', () => {
  for (const cooldownMs of [0, -1, NaN, Infinity, 1.5]) {
    assert.throws(() => createCooldownNotifier({ send() {}, cooldownMs }), /cooldown/i);
  }
  assert.throws(() => createCooldownNotifier(), /callbacks/);
  assert.throws(() => createFileCooldownStore(), /filePath/);
  assert.throws(() => createRedisCooldownStore({ client: {}, key: 'test' }), /Redis-compatible/);
});
