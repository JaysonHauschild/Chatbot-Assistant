'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');
const { GoogleGenerativeAI } = require('@google/generative-ai');

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function serializeRuleStore(rules) {
  return `${JSON.stringify({ version: 1, rules }, null, 2)}\n`;
}

function loadDashboardApp(tempDir) {
  const messageFilterRulesPath = path.join(tempDir, 'message-filter-rules.json');
  const rollbackDir = path.join(tempDir, 'rollback');
  const logPath = path.join(tempDir, 'ai-responses.jsonl');
  const originalRulesFile = serializeRuleStore([
    { id: 'existing_rule', pattern: 'existing', flags: 'i', action: 'respond', reply: 'Existing' },
  ]);

  fs.writeFileSync(messageFilterRulesPath, originalRulesFile, 'utf8');
  process.env.MESSAGE_FILTER_RULES_PATH = messageFilterRulesPath;
  process.env.DASHBOARD_ROLLBACK_DIR = rollbackDir;
  process.env.AI_RESPONSE_LOG_PATH = logPath;
  process.env.JWT_SECRET = 'test-secret';
  delete process.env.GEMINI_API_KEY;

  clearModule('../lib/state');
  clearModule('../util/logger');
  clearModule('../routes/dashboard');
  clearModule('../routes/auth');
  const dashboardRouter = require('../routes/dashboard');

  const app = express();
  app.use(express.json());
  app.use('/api', dashboardRouter);

  const token = jwt.sign({ role: 'dashboard' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const server = app.listen(0);
  const { port } = server.address();

  return { server, port, token, messageFilterRulesPath, rollbackDir, originalRulesFile };
}

function cleanup(tempDir) {
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env.MESSAGE_FILTER_RULES_PATH;
  delete process.env.DASHBOARD_ROLLBACK_DIR;
  delete process.env.AI_RESPONSE_LOG_PATH;
  delete process.env.JWT_SECRET;
  delete process.env.GEMINI_API_KEY;
  clearModule('../routes/dashboard');
  clearModule('../routes/auth');
  clearModule('../lib/state');
  clearModule('../util/logger');
}

test('dashboard can sandbox a message-filter rule draft without saving it', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-dashboard-sandbox-rule-test-'));
  const { server, port, token, messageFilterRulesPath, rollbackDir, originalRulesFile } = loadDashboardApp(tempDir);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dashboard/message-filter/rules/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        keywords: 'grant, SBA loan',
        reply: 'Here is the draft safe response.',
        action: 'respond',
        testMessage: 'Can I get an SBA loan for my business?',
      }),
    });

    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.persisted, false);
    assert.equal(data.matched, true);
    assert.equal(data.source, 'keywords');
    assert.equal(data.reply, 'Here is the draft safe response.');
    assert.equal(fs.readFileSync(messageFilterRulesPath, 'utf8'), originalRulesFile);
    assert.equal(fs.existsSync(rollbackDir), false);
  } finally {
    server.close();
    cleanup(tempDir);
  }
});

test('dashboard prompt sandbox validates drafts without requiring Gemini in tests', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-dashboard-sandbox-prompt-test-'));
  const { server, port, token, rollbackDir } = loadDashboardApp(tempDir);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dashboard/system-prompt/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        systemPrompt: 'You are a safe OKSBDC assistant. Give concise, controlled guidance.',
        message: 'How do I start a business in Oklahoma?',
      }),
    });

    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.persisted, false);
    assert.equal(data.aiGenerated, false);
    assert.match(data.reply, /GEMINI_API_KEY/);
    assert.equal(fs.existsSync(rollbackDir), false);
  } finally {
    server.close();
    cleanup(tempDir);
  }
});

test('prompt sandbox sends requests to the configured model and honors an explicit sandbox override', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-dashboard-sandbox-model-test-'));
  const originalEnv = Object.fromEntries(['GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_SANDBOX_MODEL']
    .map((key) => [key, process.env[key]]));
  const { server, port, token } = loadDashboardApp(tempDir);
  const calls = [];
  t.mock.method(GoogleGenerativeAI.prototype, 'getGenerativeModel', (options) => {
    calls.push(options);
    return { generateContent: async (message) => {
      assert.equal(message, 'How do I start a business?');
      return { response: { text: () => 'Draft preview response.' } };
    } };
  });

  try {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_MODEL = 'gemini-3-flash-preview';
    delete process.env.GEMINI_SANDBOX_MODEL;
    for (const override of [null, 'sandbox-model-override']) {
      if (override) process.env.GEMINI_SANDBOX_MODEL = override;
      const response = await fetch(`http://127.0.0.1:${port}/api/dashboard/system-prompt/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ systemPrompt: 'Draft system prompt.', message: 'How do I start a business?' }),
      });
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.model, override || 'gemini-3-flash-preview');
      assert.equal(data.aiGenerated, true);
      assert.equal(data.persisted, false);
      assert.equal(data.reply, 'Draft preview response.');
      assert.deepEqual(calls.at(-1), { model: data.model, systemInstruction: 'Draft system prompt.' });
    }
    assert.equal(calls.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    cleanup(tempDir);
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
