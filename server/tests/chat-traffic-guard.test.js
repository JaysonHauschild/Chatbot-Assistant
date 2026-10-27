'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Redis = require('ioredis-mock');
const { createChatTrafficGuard, createTrafficAlertNotifier } = require('../lib/chat-traffic-guard');

const settings = { CHAT_TRAFFIC_WINDOW_MS: '1000', CHAT_TRAFFIC_MAX_REQUESTS: '3', CHAT_LITE_MODE_HOLD_MS: '5000' };
const silent = { warn() {}, error() {} };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('global traffic activates at the threshold, extends on breaches, and recovers after quiet traffic', async () => {
  let time = 0;
  const alerts = [];
  const events = [];
  const guard = createChatTrafficGuard({ env: settings, redis: () => null, now: () => time,
    notify: async details => alerts.push(details), logger: { ...silent, warn: event => events.push(event) } });
  assert.equal((await guard.observe()).liteMode, false);
  assert.equal((await guard.observe()).liteMode, false);
  assert.equal((await guard.observe()).liteMode, true);
  await tick();
  assert.equal(alerts.length, 1);
  assert.match(events[0], /possible_ddos_lite_mode_enabled/);
  time = 500;
  await guard.observe();
  time = 5000;
  assert.equal((await guard.getStatus()).liteMode, true);
  time = 5500;
  assert.equal((await guard.getStatus()).liteMode, false);
  await guard.observe();
  await tick();
  assert.equal(alerts.length, 1);
});

test('only chat submissions count; authenticated dashboard tests do not activate public protection', async () => {
  const guard = createChatTrafficGuard({ env: { ...settings, CHAT_TRAFFIC_MAX_REQUESTS: '1' },
    redis: () => null, logger: silent, notify: async () => {} });
  for (const req of [
    { method: 'GET', path: '/' }, { method: 'POST', path: '/reset' },
    { method: 'POST', path: '/', liveChatTest: { prefix: 'verified' } },
  ]) {
    let continued = false;
    await guard.middleware(req, {}, () => { continued = true; });
    assert.equal(continued, true);
    assert.equal((await guard.getStatus()).liteMode, false);
  }
  const publicRequest = { method: 'POST', path: '/', body: { liteMode: false } };
  await guard.middleware(publicRequest, {}, () => {});
  assert.equal(publicRequest.chatTrafficMode.liteMode, true);
});

test('Redis aggregates separate instances and elects one incident notification', async () => {
  const client = new Redis();
  await client.flushall();
  let alerts = 0;
  const options = { env: settings, redis: () => client, logger: silent, notify: async () => { alerts++; } };
  const first = createChatTrafficGuard(options);
  const second = createChatTrafficGuard(options);
  await Promise.all([first.observe(), second.observe(), first.observe(), second.observe()]);
  await tick();
  assert.equal((await first.getStatus()).liteMode, true);
  assert.equal((await second.getStatus()).liteMode, true);
  assert.equal(alerts, 1);
  assert.ok(await client.pttl('oksbdc:chat-traffic:lite') > 0);
  client.disconnect();
});

test('Redis failure falls back to bounded local protection and notification failures do not break chat', async () => {
  let warnings = 0;
  const guard = createChatTrafficGuard({ env: settings,
    redis: () => { throw new Error('offline'); },
    logger: { ...silent, error: () => { warnings++; } }, notify: async () => { throw new Error('SMTP unavailable'); } });
  await guard.observe(); await guard.observe();
  assert.equal((await guard.observe()).liteMode, true);
  await tick();
  assert.equal((await guard.getStatus()).liteMode, true);
  assert.equal(warnings, 2); // One Redis warning and one delivery warning.
});

test('traffic email goes only to active administrators and has its own durable one-hour cooldown', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'traffic-alert-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sent = [];
  let time = Date.now();
  const options = {
    env: { GMAIL_USER: 'test@example.com', GMAIL_APP_PASSWORD: 'test', CHAT_TRAFFIC_ALERT_STATE_PATH: path.join(directory, 'alert.json') },
    now: () => time, redis: () => null, send: async message => sent.push(message),
    accounts: () => [
      { role: 'admin', email: 'admin@example.com' },
      { role: 'admin', active: false, email: 'disabled@example.com' },
      { role: 'dashboard', email: 'editor@example.com' },
    ],
  };
  const details = { count: 300, windowMs: 60_000, holdMs: 600_000 };
  assert.equal(await createTrafficAlertNotifier(options)(details), true);
  assert.equal(await createTrafficAlertNotifier(options)(details), false);
  assert.deepEqual(sent[0].bcc, ['admin@example.com']);
  assert.match(sent[0].subject, /Possible DDoS/);
  assert.match(sent[0].text, /300 requests/);
  time += 60 * 60_000;
  assert.equal(await createTrafficAlertNotifier(options)(details), true);
});
