'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function clearLoggerModules() {
  delete require.cache[require.resolve('../lib/state')];
  delete require.cache[require.resolve('../util/logger')];
}

test('appendAiResponseLog writes to a MM-DD-YYYY dated JSONL file', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-daily-log-test-'));
  const originalLogPath = process.env.AI_RESPONSE_LOG_PATH;
  process.env.AI_RESPONSE_LOG_PATH = path.join(tempDir, 'ai-responses.jsonl');
  clearLoggerModules();

  try {
    const logger = require('../util/logger');
    logger.appendAiResponseLog({ event: 'daily_log_test', ok: true });

    const expectedPath = logger.getDailyAiResponseLogPath();
    assert.equal(path.basename(expectedPath), `ai-responses-${new Date().toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    }).replace(/\//g, '-')}.jsonl`);
    assert.equal(fs.existsSync(process.env.AI_RESPONSE_LOG_PATH), false);
    assert.equal(fs.existsSync(expectedPath), true);

    const entries = fs.readFileSync(expectedPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    assert.deepEqual(entries, [{
      schema_version: 2,
      timestamp: entries[0].timestamp,
      event: 'daily_log_test',
      conversation_id: null,
      turn: null,
      details: { ok: true },
    }]);
  } finally {
    if (originalLogPath === undefined) delete process.env.AI_RESPONSE_LOG_PATH;
    else process.env.AI_RESPONSE_LOG_PATH = originalLogPath;
    clearLoggerModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('appendAiResponseLog also writes a dated human-readable Markdown companion', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-readable-log-test-'));
  const originalLogPath = process.env.AI_RESPONSE_LOG_PATH;
  const originalReadableLogPath = process.env.HUMAN_READABLE_LOG_PATH;
  process.env.AI_RESPONSE_LOG_PATH = path.join(tempDir, 'ai-responses.jsonl');
  delete process.env.HUMAN_READABLE_LOG_PATH;
  clearLoggerModules();

  try {
    const logger = require('../util/logger');
    logger.appendAiResponseLog({
      timestamp: '2026-07-22T14:30:00.000Z',
      event: 'chat_response',
      conversation_id: 'conv-readable',
      turn: 1,
      user_message_redacted: 'How do I start?\nI need a checklist.',
      bot_reply_redacted: 'Start with a business plan.',
      responseKind: 'model',
      message_intent: 'starting_business',
      user_intent: 'informational',
      model: 'gemini-test',
      token_total: 42,
    });
    logger.appendAiResponseLog({
      timestamp: '2026-07-22T14:31:00.000Z',
      event: 'chat_feedback',
      conversation_id: 'conv-readable',
      turn: 1,
      scope: 'response',
      feedback: 'up',
    });

    const expectedPath = logger.getDailyHumanReadableLogPath();
    assert.equal(path.basename(expectedPath), `conversation-transcript-${new Date().toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    }).replace(/\//g, '-')}.md`);
    assert.equal(fs.existsSync(expectedPath), true);

    const transcript = fs.readFileSync(expectedPath, 'utf8');
    assert.match(transcript, /^# Chat Audit Log \u2014 /);
    assert.match(transcript, /## Chat response/);
    assert.match(transcript, /\*\*Conversation:\*\* `conv-readable`/);
    assert.match(transcript, /### User\n\n> How do I start\?\n> I need a checklist\./);
    assert.match(transcript, /### Assistant\n\n> Start with a business plan\./);
    assert.match(transcript, /### Classification/);
    assert.match(transcript, /\*\*Message intent:\*\* `starting_business`/);
    assert.match(transcript, /### Feedback/);
    assert.equal((transcript.match(/^# Chat Audit Log/mg) || []).length, 1);

    const jsonlEntries = fs.readFileSync(logger.getDailyAiResponseLogPath(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(jsonlEntries.length, 2);
  } finally {
    if (originalLogPath === undefined) delete process.env.AI_RESPONSE_LOG_PATH;
    else process.env.AI_RESPONSE_LOG_PATH = originalLogPath;
    if (originalReadableLogPath === undefined) delete process.env.HUMAN_READABLE_LOG_PATH;
    else process.env.HUMAN_READABLE_LOG_PATH = originalReadableLogPath;
    clearLoggerModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('readAiResponseLogLines reads legacy and dated logs in order', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-read-daily-log-test-'));
  const originalLogPath = process.env.AI_RESPONSE_LOG_PATH;
  process.env.AI_RESPONSE_LOG_PATH = path.join(tempDir, 'ai-responses.jsonl');
  clearLoggerModules();

  try {
    const logger = require('../util/logger');
    fs.writeFileSync(path.join(tempDir, 'ai-responses.jsonl'), '{"event":"legacy"}\n', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'ai-responses-06-03-2026.jsonl'), '{"event":"older"}\n', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'ai-responses-06-04-2026.jsonl'), '{"event":"newer"}\n', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'other-06-04-2026.jsonl'), '{"event":"ignored"}\n', 'utf8');

    assert.deepEqual(logger.readAiResponseLogLines().filter(Boolean), [
      '{"event":"legacy"}',
      '{"event":"older"}',
      '{"event":"newer"}',
    ]);
  } finally {
    if (originalLogPath === undefined) delete process.env.AI_RESPONSE_LOG_PATH;
    else process.env.AI_RESPONSE_LOG_PATH = originalLogPath;
    clearLoggerModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('appendConversationStatusLog writes to a separate dated JSONL file', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-conversation-status-log-test-'));
  const originalLogPath = process.env.CONVERSATION_STATUS_LOG_PATH;
  process.env.CONVERSATION_STATUS_LOG_PATH = path.join(tempDir, 'conversation-status.jsonl');
  clearLoggerModules();

  try {
    const logger = require('../util/logger');
    logger.appendConversationStatusLog({
      event: 'conversation_invalidated',
      conversation_id: 'conv-test',
      active: false,
      reason: 'reset',
      last_message_at: '2026-06-10T00:00:00.000Z',
      invalidated_at: '2026-06-10T00:10:00.000Z',
      turn: 2,
    });

    const expectedPath = logger.getDailyConversationStatusLogPath();
    assert.equal(path.basename(expectedPath), `conversation-status-${new Date().toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    }).replace(/\//g, '-')}.jsonl`);
    assert.equal(fs.existsSync(process.env.CONVERSATION_STATUS_LOG_PATH), false);
    assert.equal(fs.existsSync(expectedPath), true);

    const entries = fs.readFileSync(expectedPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    assert.deepEqual(entries, [{
      schema_version: 1,
      timestamp: entries[0].timestamp,
      event: 'conversation_invalidated',
      conversation_id: 'conv-test',
      active: false,
      reason: 'reset',
      last_message_at: '2026-06-10T00:00:00.000Z',
      invalidated_at: '2026-06-10T00:10:00.000Z',
      turn: 2,
      source: null,
      details: null,
    }]);
  } finally {
    if (originalLogPath === undefined) delete process.env.CONVERSATION_STATUS_LOG_PATH;
    else process.env.CONVERSATION_STATUS_LOG_PATH = originalLogPath;
    clearLoggerModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
