#!/usr/bin/env node
'use strict';

/**
 * load-test-chat.js — paced chat API load test.
 *
 * By default this script starts a local server with CHAT_RATE_LIMIT_DISABLED=1,
 * sends roughly 3000 mixed chat turns over 30 minutes, then reports latency,
 * response-kind counts, bot/degraded errors, and slow responses. Set
 * CHAT_LOAD_TEST_MODE=users to simulate many concurrent user conversations
 * (default: 100 users sending 10 messages each).
 */

const childProcess = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const DEFAULT_COUNT = 3000;
const DEFAULT_USER_COUNT = 100;
const DEFAULT_MESSAGES_PER_USER = 10;
const DEFAULT_DURATION_MS = 1_800_000; // 30 minutes
const DEFAULT_SLOW_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 30_000;

const regexMessages = [
  'Hello there!',
  'How do I get started with a business in Oklahoma?',
  'What licenses do I need before starting a business in Oklahoma?',
  'Do I need insurance before starting a business?',
  'What funding options are available when starting a business?',
  'Where is your nearest office? I am in Tulsa.',
  'Do you offer training workshops?',
  'How do I apply for government contract opportunities?',
  'I do not want a grant. What other financing options are there?',
  'What is the difference between personal and business loans?',
];

const llmMessages = [
  'Compare two possible target customer segments for my new Oklahoma mobile bookkeeping service.',
  'How should I sequence customer discovery before committing to one niche?',
  'What assumptions should I test before leasing equipment for a specialty food product?',
  'Help me think through whether my bakery should sell to offices or farmers markets first.',
  'What tradeoffs should I consider before turning my weekend repair work into a full-time operation?',
  'How can I decide whether a subscription or one-time purchase model fits my service?',
  'What should I validate before hiring my first part-time helper?',
  'How can I prioritize improvements when customers ask for several different services?',
  'What questions should I ask potential customers before building a prototype?',
  'How do I evaluate whether a rural delivery route is worth testing?',
];

function isTruthy(value) {
  return TRUE_VALUES.has(String(value || '').trim().toLowerCase());
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : null;
      server.close(() => (port ? resolve(port) : reject(new Error('Unable to allocate a port.'))));
    });
  });
}

async function waitForHealth(baseUrl, timeoutMs = 20_000) {
  const start = performance.now();
  let lastError = null;

  while (performance.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/chatbot/api/health/live`);
      if (response.ok) return;
      lastError = new Error(`Health check returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  throw new Error(`Server did not become healthy within ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ''}`);
}

function buildMessagePlan(count) {
  const runId = Date.now();
  return Array.from({ length: count }, (_, index) => {
    const useRegex = index % 2 === 0;
    const pool = useRegex ? regexMessages : llmMessages;
    return {
      index,
      expectedKind: useRegex ? 'regex' : 'llm',
      message: pool[Math.floor(index / 2) % pool.length],
      conversationId: `load-test-${runId}-${index}`,
    };
  });
}

function buildUserConversationPlans(userCount, messagesPerUser) {
  const runId = Date.now();

  return Array.from({ length: userCount }, (_, userIndex) => {
    const sessionId = `load-test-session-${runId}-${userIndex}`;

    return Array.from({ length: messagesPerUser }, (_, turnIndex) => {
      const useRegex = turnIndex % 2 === 0;
      const pool = useRegex ? regexMessages : llmMessages;
      const message = pool[(userIndex + Math.floor(turnIndex / 2)) % pool.length];

      return {
        index: (turnIndex * userCount) + userIndex,
        userIndex,
        turnIndex,
        expectedKind: useRegex ? 'regex' : 'llm',
        message,
        sessionId,
        conversationId: null,
      };
    });
  });
}

function detectBotError(reply) {
  return /temporarily experiencing high demand|having trouble reaching|failed to get response|no response returned|try again in (a )?(minute|moment)/i.test(reply || '');
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((percentileValue / 100) * sortedValues.length) - 1;
  return sortedValues[Math.min(Math.max(index, 0), sortedValues.length - 1)];
}

function summarize(results, elapsedMs, slowMs, scenario) {
  const durations = results.map((item) => item.durationMs).filter(Number.isFinite).sort((a, b) => a - b);
  const counts = results.reduce((acc, item) => {
    acc.total += 1;
    acc[item.responseKind] = (acc[item.responseKind] || 0) + 1;
    if (item.expectedKind === 'regex') acc.expectedRegex += 1;
    if (item.expectedKind === 'llm') acc.expectedLlm += 1;
    if (item.status === 429) acc.rateLimited += 1;
    if (item.error) acc.errors += 1;
    if (item.botError) acc.botErrors += 1;
    if (item.durationMs > slowMs) acc.slow += 1;
    return acc;
  }, {
    total: 0,
    expectedRegex: 0,
    expectedLlm: 0,
    llm: 0,
    regex_or_predefined: 0,
    degraded: 0,
    http_error: 0,
    fetch_error: 0,
    invalid_json: 0,
    empty_reply: 0,
    rateLimited: 0,
    errors: 0,
    botErrors: 0,
    slow: 0,
  });

  return {
    startedAt: new Date().toISOString(),
    scenario,
    elapsedMs: Math.round(elapsedMs),
    slowThresholdMs: slowMs,
    counts,
    latencyMs: {
      min: Math.round(durations[0] || 0),
      p50: Math.round(percentile(durations, 50)),
      p90: Math.round(percentile(durations, 90)),
      p95: Math.round(percentile(durations, 95)),
      max: Math.round(durations[durations.length - 1] || 0),
      average: Math.round(durations.reduce((sum, value) => sum + value, 0) / Math.max(durations.length, 1)),
    },
    slowResponses: results
      .filter((item) => item.durationMs > slowMs)
      .map(({ index, userIndex, turnIndex, expectedKind, responseKind, durationMs, status, message }) => ({
        index,
        userIndex,
        turnIndex,
        expectedKind,
        responseKind,
        durationMs: Math.round(durationMs),
        status,
        message,
      })),
    errors: results
      .filter((item) => item.error || item.botError)
      .map(({ index, userIndex, turnIndex, expectedKind, responseKind, durationMs, status, error, botError, message, replyPreview }) => ({
        index,
        userIndex,
        turnIndex,
        expectedKind,
        responseKind,
        durationMs: Math.round(durationMs),
        status,
        error,
        botError,
        message,
        replyPreview,
      })),
  };
}

function attachReplyForHistory(result, reply) {
  Object.defineProperty(result, 'replyForHistory', {
    value: reply,
    enumerable: false,
  });
  return result;
}

async function sendChatTurn(baseUrl, planItem, timeoutMs, history = []) {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chatbot/api/chat?test_mode=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        message: planItem.message,
        history,
        ...(planItem.sessionId ? { sessionId: planItem.sessionId } : {}),
        ...(planItem.conversationId ? { conversationId: planItem.conversationId } : {}),
        pageUrl: 'https://load-test.local/expected-chat-load',
      }),
    });

    const durationMs = performance.now() - started;
    let data;
    try {
      data = await response.json();
    } catch (error) {
      return {
        ...planItem,
        status: response.status,
        durationMs,
        responseKind: 'invalid_json',
        error: `Invalid JSON response: ${error.message}`,
      };
    }

    const reply = typeof data?.reply === 'string' ? data.reply : '';
    const botError = detectBotError(reply);

    if (!response.ok) {
      return {
        ...planItem,
        status: response.status,
        durationMs,
        responseKind: 'http_error',
        error: data?.error || `HTTP ${response.status}`,
        replyPreview: reply.slice(0, 160),
      };
    }

    if (!reply.trim()) {
      return {
        ...planItem,
        status: response.status,
        durationMs,
        responseKind: 'empty_reply',
        error: 'Empty bot reply.',
      };
    }

    return attachReplyForHistory({
      ...planItem,
      status: response.status,
      durationMs,
      conversationId: typeof data?.conversationId === 'string' && data.conversationId.trim()
        ? data.conversationId.trim()
        : planItem.conversationId,
      responseKind: data.aiGenerated === true ? 'llm' : (botError ? 'degraded' : 'regex_or_predefined'),
      botError,
      replyPreview: reply.slice(0, 160),
    }, reply);
  } catch (error) {
    return {
      ...planItem,
      status: null,
      durationMs: performance.now() - started,
      responseKind: 'fetch_error',
      error: error.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}


async function runUserConversation(baseUrl, userPlan, timeoutMs, started, intervalMs) {
  const history = [];
  const results = [];
  let conversationId = null;

  for (const item of userPlan) {
    const plannedAt = started + (item.index * intervalMs);
    const delay = plannedAt - performance.now();
    if (delay > 0) await sleep(delay);

    const result = await sendChatTurn(baseUrl, { ...item, conversationId }, timeoutMs, history);
    if (result.conversationId) conversationId = result.conversationId;
    results.push(result);

    history.push({ role: 'user', content: item.message });
    if (result.replyForHistory) {
      history.push({ role: 'assistant', content: result.replyForHistory });
    }

    while (history.length > 16) history.shift();
  }

  return results;
}

async function startManagedServer() {
  const port = await getFreePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-chat-load-'));
  const serverRoot = path.join(__dirname, '..');
  const child = childProcess.spawn(process.execPath, ['index.js'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      PORT: String(port),
      JWT_SECRET: process.env.JWT_SECRET || 'load-test-jwt-secret-32-chars',
      CHAT_RATE_LIMIT_DISABLED: 'true',
      AI_RESPONSE_LOG_PATH: process.env.AI_RESPONSE_LOG_PATH || path.join(tempDir, 'ai-responses.jsonl'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl);

  return {
    baseUrl,
    async stop() {
      if (!child.killed) child.kill('SIGTERM');
      await sleep(250);
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

async function main() {
  const loadMode = String(process.env.CHAT_LOAD_TEST_MODE || '').trim().toLowerCase();
  const isUserMode = loadMode === 'users'
    || Object.prototype.hasOwnProperty.call(process.env, 'CHAT_LOAD_TEST_USERS')
    || Object.prototype.hasOwnProperty.call(process.env, 'CHAT_LOAD_TEST_MESSAGES_PER_USER');
  const count = parsePositiveInteger(process.env.CHAT_LOAD_TEST_COUNT, DEFAULT_COUNT);
  const userCount = parsePositiveInteger(process.env.CHAT_LOAD_TEST_USERS, DEFAULT_USER_COUNT);
  const messagesPerUser = parsePositiveInteger(process.env.CHAT_LOAD_TEST_MESSAGES_PER_USER, DEFAULT_MESSAGES_PER_USER);
  const totalMessages = isUserMode ? userCount * messagesPerUser : count;
  const durationMs = parsePositiveInteger(process.env.CHAT_LOAD_TEST_DURATION_MS, DEFAULT_DURATION_MS);
  const slowMs = parsePositiveInteger(process.env.CHAT_LOAD_TEST_SLOW_MS, DEFAULT_SLOW_MS);
  const timeoutMs = parsePositiveInteger(process.env.CHAT_LOAD_TEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const failOnSlow = isTruthy(process.env.CHAT_LOAD_TEST_FAIL_ON_SLOW);
  const requireLlm = Object.prototype.hasOwnProperty.call(process.env, 'CHAT_LOAD_TEST_REQUIRE_LLM')
    ? isTruthy(process.env.CHAT_LOAD_TEST_REQUIRE_LLM)
    : Boolean(process.env.GEMINI_API_KEY);
  const outputPath = process.env.CHAT_LOAD_TEST_OUTPUT || '';

  let managedServer = null;
  const baseUrl = process.env.CHAT_LOAD_TEST_URL || '';

  try {
    const serverInfo = baseUrl
      ? { baseUrl: baseUrl.replace(/\/+$/, ''), stop: async () => {} }
      : await startManagedServer();
    managedServer = serverInfo;

    if (baseUrl && !isTruthy(process.env.CHAT_RATE_LIMIT_DISABLED)) {
      console.warn('Using CHAT_LOAD_TEST_URL. Ensure that server was started with CHAT_RATE_LIMIT_DISABLED=true, otherwise 100/minute will hit the chat limiter.');
    }

    const intervalMs = totalMessages > 1 ? durationMs / (totalMessages - 1) : 0;
    const started = performance.now();
    const scenario = isUserMode
      ? { mode: 'users', users: userCount, messagesPerUser, totalMessages }
      : { mode: 'messages', totalMessages };

    console.log(`Sending ${totalMessages} chat messages to ${serverInfo.baseUrl}/chatbot/api/chat over ~${durationMs}ms (${Math.round(intervalMs)}ms spacing).`);
    if (isUserMode) {
      console.log(`User load mode: ${userCount} users sending ${messagesPerUser} messages each with per-user conversation history.`);
    }
    console.log(`Slow threshold: ${slowMs}ms. Per-request timeout: ${timeoutMs}ms. Rate limiter disabled for managed server: ${!baseUrl}.`);

    const tasks = isUserMode
      ? buildUserConversationPlans(userCount, messagesPerUser)
          .map((userPlan) => runUserConversation(serverInfo.baseUrl, userPlan, timeoutMs, started, intervalMs))
      : buildMessagePlan(count).map((item) => (async () => {
        const plannedAt = started + (item.index * intervalMs);
        const delay = plannedAt - performance.now();
        if (delay > 0) await sleep(delay);
        return sendChatTurn(serverInfo.baseUrl, item, timeoutMs);
      })());

    const taskResults = await Promise.all(tasks);
    const results = isUserMode ? taskResults.flat() : taskResults;
    const elapsedMs = performance.now() - started;
    const summary = summarize(results, elapsedMs, slowMs, scenario);

    console.log('\nChat load test summary');
    console.log(JSON.stringify(summary, null, 2));

    if (outputPath) {
      fs.writeFileSync(outputPath, `${JSON.stringify({ summary, results }, null, 2)}\n`);
      console.log(`Wrote detailed load-test results to ${outputPath}`);
    }

    let failed = false;
    if (summary.counts.errors > 0 || summary.counts.rateLimited > 0) failed = true;
    if (requireLlm && summary.counts.llm === 0) {
      console.error('Expected at least one aiGenerated=true LLM response, but none were observed. Check GEMINI_API_KEY/model availability.');
      failed = true;
    }
    if (failOnSlow && summary.counts.slow > 0) failed = true;

    if (summary.counts.degraded > 0 && !process.env.GEMINI_API_KEY) {
      console.warn('LLM-targeted messages returned degraded replies because GEMINI_API_KEY is not set in this environment.');
    }

    process.exitCode = failed ? 1 : 0;
  } finally {
    if (managedServer) await managedServer.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
