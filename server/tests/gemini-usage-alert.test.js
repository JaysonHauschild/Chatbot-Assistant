'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Redis = require('ioredis-mock');
const { COOLDOWN_MS, isUsageLimitError, createUsageLimitNotifier, sendGmail } = require('../lib/gemini-usage-alert');
const accounts = () => [{ role: 'dashboard', email: 'recipient@example.com' }];
const configuration = { GEMINI_ALERT_TO: 'recipient@example.com', GMAIL_USER: 'sender@gmail.com',
  GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop' };

test('detects Gemini quota responses without matching unrelated failures', () => {
  for (const error of [{ status: 429 }, { response: { status: '429' } }, { cause: { status: 429 } },
    { error: { status: 'RESOURCE_EXHAUSTED' } }, new Error('429 RESOURCE_EXHAUSTED')]) assert.equal(isUsageLimitError(error), true);
  for (const error of [null, { status: 503 }, new Error('Unauthorized')]) assert.equal(isUsageLimitError(error), false);
});

test('file cooldown survives notifier recreation and expires at exactly 24 hours', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-alert-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let time = 1000;
  const sent = [];
  const options = { env: { ...configuration, GEMINI_ALERT_STATE_PATH: path.join(directory, 'state.json') },
    redis: () => null, now: () => time, send: async message => { sent.push(message); } };
  const notify = createUsageLimitNotifier({ accounts, ...options });
  assert.equal(await notify({ status: 503 }), false);
  await Promise.all(Array.from({ length: 20 }, () => notify({ status: 429 })));
  assert.equal(sent.length, 1);
  const restarted = createUsageLimitNotifier({ accounts, ...options });
  time += COOLDOWN_MS - 1;
  assert.equal(await restarted({ status: 429 }), false);
  time += 1;
  assert.equal(await restarted({ status: 429 }), true);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].bcc, ['recipient@example.com']);
  assert.equal(sent[0].from, configuration.GMAIL_USER);
});

test('Redis suppresses simultaneous alerts from separate instances', async () => {
  const client = new Redis();
  let count = 0;
  const options = { env: configuration, redis: () => client, send: async () => { count++; } };
  await Promise.all(Array.from({ length: 20 }, () => createUsageLimitNotifier({ accounts, ...options })({ status: 429 })));
  assert.equal(count, 1);
  assert.ok(await client.pttl('oksbdc:gemini-usage-alert') > COOLDOWN_MS - 5000);
  client.disconnect();
});

test('delivery failures consume cooldown and storage failures do not send', async () => {
  const client = new Redis();
  await client.flushall();
  let attempts = 0;
  const options = { env: configuration, redis: () => client, logger: { error() {} },
    send: async () => { attempts++; throw new Error('delivery failed'); } };
  assert.equal(await createUsageLimitNotifier({ accounts, ...options })({ status: 429 }), false);
  assert.equal(await createUsageLimitNotifier({ accounts, ...options })({ status: 429 }), false);
  assert.equal(attempts, 1);
  assert.equal(await createUsageLimitNotifier({ accounts, ...options, redis: () => { throw new Error('unavailable'); } })({ status: 429 }), false);
  assert.equal(attempts, 1);
  client.disconnect();
});

test('missing configuration does not reserve cooldown', async () => {
  for (const env of [{}, { ...configuration, GMAIL_APP_PASSWORD: '' }, { ...configuration, GMAIL_USER: '' }]) {
    await createUsageLimitNotifier({ env, redis: () => assert.fail('must not claim') })({ status: 429 });
  }
});

test('Gmail delivery uses TLS, app-password authentication, and closes transport', async () => {
  let options;
  let submitted;
  let closed = 0;
  const createTransport = config => {
    options = config;
    return { sendMail: async message => { submitted = message; }, close: () => { closed++; } };
  };
  const message = { from: configuration.GMAIL_USER, to: configuration.GEMINI_ALERT_TO, subject: 'Alert', text: 'Limit reached' };
  await sendGmail(message, configuration, createTransport);
  assert.equal(options.host, 'smtp.gmail.com');
  assert.equal(options.port, 465);
  assert.equal(options.secure, true);
  assert.equal(options.auth.user, configuration.GMAIL_USER);
  assert.equal(options.auth.pass, 'abcdefghijklmnop');
  assert.deepEqual(submitted, message);
  assert.equal(closed, 1);
  await assert.rejects(sendGmail(message, configuration, () => ({
    sendMail: async () => { throw new Error('SMTP rejected'); }, close: () => { closed++; },
  })), /SMTP rejected/);
  assert.equal(closed, 2);
});

test('chat errors notify all dashboard emails, deduplicate addresses, and omit private error data', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-alert-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sent = [];
  const env = { ...configuration, GEMINI_ALERT_TO: '', GEMINI_ALERT_STATE_PATH: path.join(directory, 'state.json') };
  const notify = createUsageLimitNotifier({ env, chatErrors: true, redis: () => null,
    accounts: () => [
      { role: 'dashboard', email: ' First@example.com ' },
      { role: 'admin', email: 'second@example.com', active: false },
      { role: 'dashboard', email: 'FIRST@example.com' },
      { role: 'dashboard' },
      { role: 'dashboard', email: 'invalid' },
      { role: 'user', email: 'excluded@example.com' },
    ], send: async message => { sent.push(message); } });
  assert.equal(await notify(new Error('private user prompt'), 'Chat HTTP 400'), true);
  assert.equal(await notify({ status: 503 }, 'Chat response'), false);
  assert.deepEqual(sent[0].bcc, ['first@example.com', 'second@example.com']);
  assert.equal(sent[0].to, undefined);
  assert.match(sent[0].text, /Chat HTTP 400/);
  assert.doesNotMatch(sent[0].text, /private user prompt/);
});

test('missing dashboard emails do not claim cooldown and later account changes are picked up', async () => {
  let currentAccounts = [];
  let claims = 0;
  const notify = createUsageLimitNotifier({ env: configuration, chatErrors: true,
    accounts: () => currentAccounts,
    redis: () => ({ set: async () => { claims++; return 'OK'; } }), send: async () => {} });
  assert.equal(await notify({ status: 500 }), false);
  assert.equal(claims, 0);
  currentAccounts = accounts();
  assert.equal(await notify({ status: 500 }), true);
  assert.equal(claims, 1);
});
