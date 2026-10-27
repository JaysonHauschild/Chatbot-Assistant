'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const serverDir = path.join(__dirname, '..');

function waitForStartup(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Server did not start in time. Output:\n${output}`));
    }, 10000);

    const onData = (chunk) => {
      output += chunk.toString();
      const portMatch = output.match(/Server listening on http:\/\/0\.0\.0\.0:(\d+)/);
      if (portMatch && /RAG: initialization verified at startup with \d+ chunks\./.test(output)) {
        clearTimeout(timeout);
        resolve({ port: Number(portMatch[1]), output });
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code !== null && code !== 0) {
        reject(new Error(`Server exited before startup completed with code ${code} signal ${signal}. Output:\n${output}`));
      }
    });
  });
}

function waitForServerListening(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Server did not start in time. Output:\n${output}`));
    }, 10000);

    const onData = (chunk) => {
      output += chunk.toString();
      const portMatch = output.match(/Server listening on http:\/\/0\.0\.0\.0:(\d+)/);
      if (!portMatch) return;

      clearTimeout(timeout);
      resolve({ port: Number(portMatch[1]), output });
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code !== null && code !== 0) {
        reject(new Error(`Server exited before startup completed with code ${code} signal ${signal}. Output:\n${output}`));
      }
    });
  });
}

test('server startup exposes health endpoints and enforces per-IP limits despite rotating User-Agent headers', { timeout: 15000 }, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-rag-startup-test-'));
  const accountsPath = path.join(tempDir, 'dashboard-accounts.json');
  const originalAccountsPath = process.env.DASHBOARD_ACCOUNTS_PATH;
  process.env.DASHBOARD_ACCOUNTS_PATH = accountsPath;
  delete require.cache[require.resolve('../lib/dashboard-accounts')];
  require('../lib/dashboard-accounts').createDashboardAccount({ username: 'admin', password: 'test-password-123' });
  if (originalAccountsPath === undefined) delete process.env.DASHBOARD_ACCOUNTS_PATH;
  else process.env.DASHBOARD_ACCOUNTS_PATH = originalAccountsPath;

  const child = spawn(process.execPath, ['index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: '0',
      GEMINI_API_KEY: 'test-key',
      REDIS_URL: '',
      GMAIL_USER: '',
      GMAIL_APP_PASSWORD: '',
      BAN_ENFORCEMENT_ENABLED: 'false',
      CHAT_RATE_LIMIT_DISABLED: 'false',
      BAN_STORE_PATH: path.join(tempDir, 'ban-store.json'),
      AI_RESPONSE_LOG_PATH: path.join(tempDir, 'ai-responses.jsonl'),
      CONVERSATION_STATUS_LOG_PATH: path.join(tempDir, 'conversation-status.jsonl'),
      DASHBOARD_AUDIT_LOG_PATH: path.join(tempDir, 'dashboard-audit.jsonl'),
      DASHBOARD_ACCOUNTS_PATH: accountsPath,
      JWT_SECRET: 'test-secret-for-rag-startup-test',
      RAG_PRELOAD_DISABLED: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const { port, output } = await waitForStartup(child);
    assert.match(output, /RagEngine: loaded \d+ chunks/);

    const liveResponse = await fetch(`http://127.0.0.1:${port}/chatbot/api/health/live`);
    assert.equal(liveResponse.status, 200);
    assert.match(liveResponse.headers.get('cache-control') || '', /no-store/);
    const liveData = await liveResponse.json();
    assert.equal(liveData.ok, true);
    assert.equal(liveData.status, 'alive');
    assert.equal(typeof liveData.uptimeSeconds, 'number');
    assert.equal('checks' in liveData, false);
    assert.equal('rag' in liveData, false);

    const unprefixedLiveResponse = await fetch(`http://127.0.0.1:${port}/api/health/live`);
    assert.equal(unprefixedLiveResponse.status, 404);
    const unprefixedPreflightResponse = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'OPTIONS',
    });
    assert.equal(unprefixedPreflightResponse.status, 404);

    const readyResponse = await fetch(`http://127.0.0.1:${port}/chatbot/api/health/ready`);
    assert.equal(readyResponse.status, 200);
    assert.match(readyResponse.headers.get('cache-control') || '', /no-store/);
    const readyData = await readyResponse.json();
    assert.equal(readyData.ok, true);
    assert.equal(readyData.status, 'ready');
    assert.equal(readyData.checks.gemini.configured, true);
    assert.equal(readyData.checks.rag.ready, true);
    assert.equal(readyData.checks.rag.hasEmbeddingModel, true);
    assert.ok(readyData.checks.rag.chunkCount > 0);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const loginResponse = await fetch(`http://127.0.0.1:${port}/chatbot/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': `login-agent-${attempt}` },
        body: JSON.stringify({ username: 'admin', password: `wrong-${attempt}` }),
      });
      assert.equal(loginResponse.status, 401);
    }

    const rateLimitedLogin = await fetch(`http://127.0.0.1:${port}/chatbot/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'new-login-agent' },
      body: JSON.stringify({ username: 'admin', password: 'wrong-6' }),
    });
    assert.equal(rateLimitedLogin.status, 429);
    assert.match((await rateLimitedLogin.json()).error, /too many login attempts/i);

    // Client-supplied entries before the trusted proxy's address cannot reset
    // the bucket. A different IP resolved by the trusted hop has its own bucket.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/chatbot/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `proxied-login-agent-${attempt}`,
          'X-Forwarded-For': `198.51.100.${attempt}, 192.0.2.10`,
        },
        body: JSON.stringify({ username: 'admin', password: 'wrong' }),
      });
      assert.equal(response.status, 401);
    }
    const limitedProxy = await fetch(`http://127.0.0.1:${port}/chatbot/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'User-Agent': 'another-proxied-agent',
        'X-Forwarded-For': '203.0.113.99, 192.0.2.10',
      },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });
    assert.equal(limitedProxy.status, 429);

    const dashboardToken = jwt.sign({ role: 'dashboard' }, 'test-secret-for-rag-startup-test', { expiresIn: '5m' });
    for (let requestNumber = 1; requestNumber <= 30; requestNumber += 1) {
      const dashboardResponse = await fetch(`http://127.0.0.1:${port}/chatbot/api/system-prompt`, {
        headers: { Authorization: `Bearer ${dashboardToken}`, 'User-Agent': `dashboard-agent-${requestNumber}` },
      });
      assert.equal(dashboardResponse.status, 200);
    }

    const rateLimitedDashboard = await fetch(`http://127.0.0.1:${port}/chatbot/api/system-prompt`, {
      headers: { Authorization: `Bearer ${dashboardToken}`, 'User-Agent': 'new-dashboard-agent' },
    });
    assert.equal(rateLimitedDashboard.status, 429);
    assert.match((await rateLimitedDashboard.json()).error, /too many dashboard requests/i);

    for (let requestNumber = 1; requestNumber <= 10; requestNumber += 1) {
      const feedbackResponse = await fetch(`http://127.0.0.1:${port}/chatbot/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': `feedback-agent-${requestNumber}` },
        body: JSON.stringify({
          conversationId: `feedback-rate-limit-${requestNumber}`,
          scope: 'session',
          feedback: 'happy',
        }),
      });
      assert.equal(feedbackResponse.status, 204);
    }

    const rateLimitedFeedback = await fetch(`http://127.0.0.1:${port}/chatbot/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'new-feedback-agent' },
      body: JSON.stringify({
        conversationId: 'feedback-rate-limit-11',
        scope: 'session',
        feedback: 'happy',
      }),
    });
    assert.equal(rateLimitedFeedback.status, 429);
    assert.match((await rateLimitedFeedback.json()).error, /too many feedback submissions/i);

    // Invalid chat bodies exercise the real limiter without Gemini requests.
    for (let requestNumber = 1; requestNumber <= 10; requestNumber += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/chatbot/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': `chat-agent-${requestNumber}` },
        body: '{}',
      });
      assert.equal(response.status, 400);
    }
    for (const userAgent of ['new-chat-agent', '']) {
      const response = await fetch(`http://127.0.0.1:${port}/chatbot/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent },
        body: '{}',
      });
      assert.equal(response.status, 429);
      assert.match((await response.json()).error, /too many messages/i);
    }
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('liveness stays healthy while readiness returns 503 when AI dependencies are unavailable', { timeout: 15000 }, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-health-degraded-test-'));
  const child = spawn(process.execPath, ['index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: '0',
      GEMINI_API_KEY: '',
      AI_RESPONSE_LOG_PATH: path.join(tempDir, 'ai-responses.jsonl'),
      DASHBOARD_ACCOUNTS_PATH: path.join(tempDir, 'dashboard-accounts.json'),
      JWT_SECRET: 'test-secret-for-degraded-health-test',
      RAG_PRELOAD_DISABLED: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const { port } = await waitForServerListening(child);

    const liveResponse = await fetch(`http://127.0.0.1:${port}/chatbot/api/health/live`);
    assert.equal(liveResponse.status, 200);
    const liveData = await liveResponse.json();
    assert.equal(liveData.ok, true);
    assert.equal(liveData.status, 'alive');

    const readyResponse = await fetch(`http://127.0.0.1:${port}/chatbot/api/health/ready`);
    assert.equal(readyResponse.status, 503);
    const readyData = await readyResponse.json();
    assert.equal(readyData.ok, false);
    assert.equal(readyData.status, 'not_ready');
    assert.equal(readyData.checks.gemini.configured, false);
    assert.equal(readyData.checks.rag.ready, false);

  } finally {
    child.kill('SIGTERM');
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
