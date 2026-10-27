'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

test('chat selects native replies, uses translated English rules as AI guidance, and keeps blocks', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-language-'));
  const settings = {
    GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'test-language-model', GEMINI_CLASSIFIER_MODEL: '',
    MESSAGE_FILTER_RULES_PATH: path.join(dir, 'rules.json'),
    AI_RESPONSE_LOG_PATH: path.join(dir, 'responses.jsonl'), HUMAN_READABLE_LOG_PATH: path.join(dir, 'transcript.md'),
    CONVERSATION_STATUS_LOG_PATH: path.join(dir, 'status.jsonl'), BAN_STORE_PATH: path.join(dir, 'bans.json'),
  };
  fs.writeFileSync(settings.MESSAGE_FILTER_RULES_PATH, JSON.stringify({ rules: [
    { id: 'english', action: 'respond', pattern: 'start a business', reply: 'Curated English guidance: build a plan.', priority: 99 },
    { id: 'spanish', action: 'respond', language: 'es', pattern: 'iniciar un negocio', reply: 'Respuesta guardada en español.' },
    { id: 'french', action: 'respond', language: 'fr', pattern: 'créer une entreprise', reply: 'Réponse enregistrée en français.' },
    { id: 'block', action: 'block', pattern: 'blocked', message: 'Stop.' },
  ] }));
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const sdk = require('@google/generative-ai');
  const originalSDK = sdk.GoogleGenerativeAI;
  const rag = require('../rag');
  const originalContext = rag.getRelevantContext;
  rag.getRelevantContext = async () => null;
  const instructions = []; const translations = [];
  let translation = 'How can I start a business?';
  let failTranslation = false;
  let generatedReply = 'Puede preparar un plan para su negocio.';
  sdk.GoogleGenerativeAI = class {
    getGenerativeModel(options) {
      return {
        async generateContent(message) {
          translations.push(message);
          if (failTranslation) throw new Error('Translation unavailable');
          return { response: { text: () => translation } };
        },
        startChat() {
          instructions.push(options.systemInstruction);
          return {
            async sendMessage() {
              return { response: { text: () => generatedReply, candidates: [{ finishReason: 'STOP' }] } };
            },
            async sendMessageStream() {
              return {
                stream: (async function* () { yield { text: () => generatedReply }; })(),
                response: Promise.resolve({ candidates: [{ finishReason: 'STOP' }] }),
              };
            },
          };
        },
      };
    }
  };
  const app = express(); app.use(express.json()); app.use('/api/chat', require('../routes/chat'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  let sequence = 0;
  async function send(message, language) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat?test_mode=1`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, language, history: [], conversationId: `language-${++sequence}` }),
    });
    return { status: response.status, data: await response.json() };
  }
  try {
    await t.test('native Spanish response skips AI and English default is compatible', async () => {
      const native = await send('Quiero iniciar un negocio', 'es');
      assert.equal(native.status, 200); assert.equal(native.data.aiGenerated, false);
      assert.equal(native.data.reply, 'Respuesta guardada en español.');
      const english = await send('How can I start a business?');
      assert.equal(english.data.aiGenerated, false);
      assert.match(english.data.reply, /Curated English/);
      assert.equal(instructions.length, 0);
      assert.equal(translations.length, 0);
    });
    await t.test('unmatched Spanish question looks up translated English and generates Spanish', async () => {
      const result = await send('¿Cómo puedo abrir una empresa?', 'es-MX');
      assert.equal(result.status, 200); assert.equal(result.data.aiGenerated, true);
      assert.match(result.data.reply, /Puede preparar/);
      assert.match(instructions.at(-1), /selected language \(es\)/);
      assert.match(instructions.at(-1), /Curated English guidance/);
      assert.ok(translations.includes('¿Cómo puedo abrir una empresa?'));
    });
    await t.test('French replies are direct and English fallback generates French', async () => {
      const before = translations.length;
      const native = await send('Je souhaite créer une entreprise', 'fr');
      assert.equal(native.status, 200);
      assert.equal(native.data.aiGenerated, false);
      assert.equal(native.data.reply, 'Réponse enregistrée en français.');
      assert.equal(translations.length, before);
      generatedReply = 'Vous pouvez préparer un plan pour votre entreprise.';
      const fallback = await send('Comment démarrer mon activité ?', 'fr-CA');
      assert.equal(fallback.status, 200);
      assert.equal(fallback.data.aiGenerated, true);
      assert.equal(fallback.data.reply, generatedReply);
      assert.match(instructions.at(-1), /selected language \(fr\)/);
      assert.match(instructions.at(-1), /Curated English guidance/);
      assert.ok(translations.includes('Comment démarrer mon activité ?'));
      generatedReply = 'Puede preparar un plan para su negocio.';
    });
    await t.test('streamed fallback preserves language guidance and returns an AI reply', async () => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat?test_mode=1`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '¿Cómo puedo abrir una empresa?', language: 'es', stream: true, conversationId: 'language-stream' }),
      });
      assert.equal(response.status, 200);
      const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
      assert.ok(events.some((event) => event.type === 'chunk' && /Puede preparar/.test(event.text)));
      assert.ok(events.some((event) => event.type === 'final' && event.aiGenerated === true));
      assert.match(instructions.at(-1), /Curated English guidance/);
    });
    await t.test('no English match uses ordinary AI generation with language instruction', async () => {
      translation = 'Explain customer retention';
      const result = await send('Explique cómo retener clientes', 'es');
      assert.equal(result.data.aiGenerated, true);
      assert.doesNotMatch(instructions.at(-1), /An English saved reply matched/);
      assert.match(instructions.at(-1), /selected language \(es\)/);
    });
    await t.test('translation failure still allows an answer without serving English text', async () => {
      failTranslation = true;
      const result = await send('Explique las ventas', 'es');
      assert.equal(result.data.aiGenerated, true);
      assert.doesNotMatch(instructions.at(-1), /An English saved reply matched/);
    });
    await t.test('blocks remain deterministic and invalid language is rejected', async () => {
      const count = translations.length;
      const result = await send('blocked', 'es');
      assert.equal(result.data.aiGenerated, false); assert.equal(result.data.reply, 'Stop.');
      assert.equal(translations.length, count);
      assert.equal((await send('hello', 'not a language')).status, 400);
    });
  } finally {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    sdk.GoogleGenerativeAI = originalSDK; rag.getRelevantContext = originalContext;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
