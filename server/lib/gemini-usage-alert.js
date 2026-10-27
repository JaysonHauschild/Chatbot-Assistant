'use strict';

const path = require('node:path');
const { createCooldownNotifier, createFileCooldownStore, createRedisCooldownStore } = require('server-kit/notifications');
const { getRedisClient } = require('./redis-client');
const { listDashboardAccounts } = require('./dashboard-accounts');
const { workTracker } = require('./work-tracker');

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

function isUsageLimitError(error) {
  const seen = new Set();
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error);
    if ([error.status, error.statusCode, error.code, error.response?.status].some(value => Number(value) === 429)
      || error.status === 'RESOURCE_EXHAUSTED' || error.code === 'RESOURCE_EXHAUSTED'
      || /\bRESOURCE_EXHAUSTED\b/.test(error.message || '')) return true;
    error = error.cause || error.error;
  }
  return false;
}

// Reserve before sending: even an ambiguous Gmail failure cannot produce an
// email storm. A failed delivery attempt also consumes the 24-hour cooldown.
function createUsageLimitNotifier({ env = process.env, now = Date.now, redis = getRedisClient,
  send, logger = console, accounts = listDashboardAccounts, chatErrors = false,
  cooldownMs = COOLDOWN_MS, subject, describe } = {}) {
  const fileStore = createFileCooldownStore({
    getFilePath: () => env.GEMINI_ALERT_STATE_PATH || path.join(__dirname, '../data/gemini-usage-alert.json'),
  });
  return createCooldownNotifier({
    now,
    cooldownMs,
    shouldNotify: error => (chatErrors || isUsageLimitError(error)) && Boolean(env.GMAIL_USER?.trim() && env.GMAIL_APP_PASSWORD?.trim()),
    store: { async claim(options) {
      const client = redis();
      return client ? createRedisCooldownStore({ client, key: env.GEMINI_ALERT_REDIS_KEY || 'oksbdc:gemini-usage-alert' }).claim(options)
        : fileStore.claim(options);
    } },
    prepare: (error, operation = 'Gemini request') => {
      const recipients = [...new Set(accounts()
        .filter(account => ['dashboard', 'admin'].includes(account.role))
        .map(account => typeof account.email === 'string' ? account.email.trim().toLowerCase() : '')
        .filter(email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
      if (!recipients.length) return null;
      const timestamp = now();
      return {
        from: env.GMAIL_USER,
        bcc: recipients,
        subject: subject || (chatErrors ? 'OKSBDC Chatbot: Chat request failed' : 'OKSBDC Chatbot: Gemini API usage limit reached'),
        text: describe ? describe(error, timestamp) : `${chatErrors ? 'A chat request encountered an error or unsuccessful response.' : 'Gemini reported a usage/rate limit (429 RESOURCE_EXHAUSTED).'}\nTime: ${new Date(timestamp).toISOString()}\nOperation: ${operation}\n\nCheck the server logs for details. Further alerts are suppressed for 24 hours.`,
      };
    },
    send: message => send ? send(message) : sendGmail(message, env),
    onError: () => {
      // Do not log Gmail credentials, API error bodies, or user prompts.
      logger.error('Chatbot email alert failed; check dashboard emails, Gmail configuration, and cooldown storage.');
    },
  });
}

async function sendGmail(message, env, createTransport = require('nodemailer').createTransport) {
  const transport = createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: env.GMAIL_USER.trim(), pass: env.GMAIL_APP_PASSWORD.replace(/\s/g, '') },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
  try {
    await transport.sendMail(message);
  } finally {
    transport.close();
  }
}

const usageLimitNotifier = createUsageLimitNotifier();
const chatErrorNotifier = createUsageLimitNotifier({ chatErrors: true });
const notifyUsageLimit = (...args) => workTracker.trackBackgroundTask(() => usageLimitNotifier(...args));
const notifyChatError = (...args) => workTracker.trackBackgroundTask(() => chatErrorNotifier(...args));
module.exports = { sendGmail, COOLDOWN_MS, isUsageLimitError, createUsageLimitNotifier, notifyUsageLimit, notifyChatError };
