/**
 * lib/state.js — Shared mutable server state and path constants.
 *
 * Loaded once as a singleton module so all route files share the same
 * systemPrompt reference. Update state.systemPrompt to change the active
 * prompt without restarting the server.
 */

const fs = require('fs');
const path = require('path');

const systemPromptPath = process.env.SYSTEM_PROMPT_PATH || path.join(__dirname, '..', 'system-prompt.txt');

const aiResponseLogPath =
  process.env.AI_RESPONSE_LOG_PATH ||
  path.join(__dirname, '..', 'logs', 'ai-responses.jsonl');

const humanReadableLogPath =
  process.env.HUMAN_READABLE_LOG_PATH ||
  path.join(path.dirname(aiResponseLogPath), 'conversation-transcript.md');

const conversationStatusLogPath =
  process.env.CONVERSATION_STATUS_LOG_PATH ||
  path.join(__dirname, '..', 'logs', 'conversation-status.jsonl');

const ADVISING_REFERRAL_SENTENCE =
  'Please request advising through our website so a business advisor can assist you: https://www.oksbdc.org/about/';

const defaultSystemPrompt =
  process.env.SYSTEM_PROMPT ||
  'You are the OKSBDC assistant. Provide accurate, concise, and helpful guidance for small business topics.';

// Mutable state object. Import this reference and read/write state.systemPrompt.
const state = {
  systemPrompt: defaultSystemPrompt,
};

if (fs.existsSync(systemPromptPath)) {
  const fromFile = fs.readFileSync(systemPromptPath, 'utf8').trim();
  if (fromFile) {
    state.systemPrompt = fromFile;
  }
}

module.exports = {
  systemPromptPath,
  aiResponseLogPath,
  humanReadableLogPath,
  conversationStatusLogPath,
  ADVISING_REFERRAL_SENTENCE,
  state,
};
