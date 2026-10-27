'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

test('GET /api/dashboard/conversation-context reconstructs full conversation turns', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-conversation-context-test-'));
  const logPath = path.join(tempDir, 'ai-responses.jsonl');

  fs.writeFileSync(
    logPath,
    [
      JSON.stringify({
        event: 'chat_response',
        conversation_id: 'conv-unsure-context',
        turn: 1,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: {
          user_redacted: 'I want to open a cafe.',
          assistant_redacted: 'Start with a simple business plan.',
        },
      }),
      JSON.stringify({
        event: 'chat_response_predefined',
        conversation_id: 'conv-unsure-context',
        turn: 2,
        timestamp: '2026-01-01T00:00:02.000Z',
        message: {
          user_redacted: 'What permits do I need?',
          assistant_redacted: 'Please contact an OKSBDC advisor for permit guidance.',
        },
        routing: { response_type: 'predefined', rule_id: 'permits' },
      }),
      JSON.stringify({
        event: 'chat_response',
        conversation_id: 'conv-unsure-context',
        turn: 3,
        timestamp: '2026-01-01T00:00:03.000Z',
        message: {
          user_redacted: 'What about employees?',
          assistant_redacted: 'I may need more detail about your hiring plan.',
        },
        classification: { unsure_response: true, unsure_category: 'insufficient_user_details' },
      }),
      '',
    ].join('\n'),
    'utf8',
  );

  process.env.AI_RESPONSE_LOG_PATH = logPath;
  process.env.JWT_SECRET = 'test-secret';

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

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/dashboard/conversation-context?conversationId=conv-unsure-context`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.conversationId, 'conv-unsure-context');
    assert.match(data.summary, /Showing 3 turns from turn 1 through 3/);
    assert.equal(data.turns.length, 3);
    assert.deepEqual(data.turns.map((turn) => turn.turn), [1, 2, 3]);
    assert.equal(data.turns[1].predefined, true);
    assert.equal(data.turns[1].ruleId, 'permits');
    assert.equal(data.turns[2].assistantReply, 'I may need more detail about your hiring plan.');
  } finally {
    server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.AI_RESPONSE_LOG_PATH;
    delete process.env.JWT_SECRET;
    clearModule('../routes/dashboard');
    clearModule('../routes/auth');
    clearModule('../lib/state');
    clearModule('../util/logger');
  }
});
