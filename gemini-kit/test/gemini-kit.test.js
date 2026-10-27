import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GeminiConfigurationError,
  GeminiKit,
  GeminiKitError,
  GeminiResponseError,
  cosineSimilarity,
  inlineData,
  isRetryableError,
} from '../dist/index.js';

function asyncChunks(chunks) {
  return (async function* generateChunks() {
    for (const chunk of chunks) yield chunk;
  }());
}

function createFakeClient(overrides = {}) {
  const calls = {
    generate: [],
    stream: [],
    embed: [],
    createChat: [],
    chatSend: [],
    chatStream: [],
    interact: [],
  };

  const rawChat = {
    async sendMessage(params) {
      calls.chatSend.push(params);
      return { text: `chat:${params.message}`, modelVersion: 'chat-model' };
    },
    async sendMessageStream(params) {
      calls.chatStream.push(params);
      return asyncChunks([{ text: 'chat ' }, { text: 'stream' }]);
    },
    getHistory(curated) {
      return [{ role: curated ? 'curated' : 'complete', parts: [] }];
    },
    ...overrides.rawChat,
  };

  const client = {
    models: {
      async generateContent(request) {
        calls.generate.push(request);
        return {
          text: 'generated text',
          modelVersion: 'resolved-model',
          usageMetadata: { totalTokenCount: 12 },
          candidates: [{ index: 0 }],
          responseId: 'response-1',
        };
      },
      async generateContentStream(request) {
        calls.stream.push(request);
        return asyncChunks([{ text: 'hello ' }, { text: 'world' }]);
      },
      async embedContent(request) {
        calls.embed.push(request);
        const count = Array.isArray(request.contents) ? request.contents.length : 1;
        return {
          embeddings: Array.from({ length: count }, (_, index) => ({ values: [index + 1, index + 2] })),
        };
      },
      ...overrides.models,
    },
    chats: {
      create(options) {
        calls.createChat.push(options);
        return rawChat;
      },
      ...overrides.chats,
    },
    interactions: {
      async create(request) {
        calls.interact.push(request);
        return {
          id: 'interaction-1',
          status: 'completed',
          model: request.model,
          output_text: 'interaction text',
          usage: { total_tokens: 8 },
        };
      },
      ...overrides.interactions,
    },
  };

  return { client, calls, rawChat };
}

test('requires an API key unless a configured client is injected', () => {
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalGoogleKey = process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;

  try {
    assert.throws(
      () => new GeminiKit(),
      (error) => error instanceof GeminiConfigurationError && error.code === 'MISSING_API_KEY',
    );
  } finally {
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
    if (originalGoogleKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = originalGoogleKey;
  }
});

test('generates normalized responses and merges generation configuration', async () => {
  const { client, calls } = createFakeClient();
  const gemini = new GeminiKit({
    client,
    model: 'default-model',
    generationConfig: { temperature: 0.2, maxOutputTokens: 100 },
  });

  const result = await gemini.generate('Explain APIs.', {
    model: 'request-model',
    systemInstruction: 'Be concise.',
    config: { maxOutputTokens: 50 },
  });

  assert.equal(result.text, 'generated text');
  assert.equal(result.model, 'resolved-model');
  assert.equal(result.usage.totalTokenCount, 12);
  assert.equal(result.raw.responseId, 'response-1');
  assert.deepEqual(calls.generate[0], {
    model: 'request-model',
    contents: 'Explain APIs.',
    config: {
      temperature: 0.2,
      maxOutputTokens: 50,
      systemInstruction: 'Be concise.',
    },
  });

  assert.equal(await gemini.generateText('Return text.'), 'generated text');
});

test('supports the current Interactions API with normalized output', async () => {
  const { client, calls } = createFakeClient();
  const gemini = new GeminiKit({ client, model: 'interaction-model' });

  const result = await gemini.interact('Explain APIs.', {
    systemInstruction: 'Be concise.',
    request: { store: true },
  });

  assert.equal(result.text, 'interaction text');
  assert.equal(result.id, 'interaction-1');
  assert.equal(result.status, 'completed');
  assert.deepEqual(calls.interact[0], {
    store: true,
    model: 'interaction-model',
    input: 'Explain APIs.',
    stream: false,
    system_instruction: 'Be concise.',
  });
  assert.equal(await gemini.interactText('Return text.'), 'interaction text');
});

test('generates, parses, and validates structured JSON', async () => {
  const { client, calls } = createFakeClient({
    models: {
      async generateContent(request) {
        calls.generate.push(request);
        return { text: '```json\n{"priority":3}\n```' };
      },
    },
  });
  const gemini = new GeminiKit({ client });
  const schema = {
    type: 'object',
    properties: { priority: { type: 'integer' } },
    required: ['priority'],
  };

  const result = await gemini.generateJson('Choose a priority.', {
    schema,
    config: { temperature: 0 },
    validate(data) {
      assert.equal(data.priority, 3);
      return { ...data, validated: true };
    },
  });

  assert.deepEqual(result.data, { priority: 3, validated: true });
  assert.deepEqual(calls.generate[0].config, {
    temperature: 0,
    responseMimeType: 'application/json',
    responseJsonSchema: schema,
  });
});

test('throws a typed response error for invalid JSON', async () => {
  const { client } = createFakeClient({
    models: { async generateContent() { return { text: 'not JSON' }; } },
  });
  const gemini = new GeminiKit({ client });

  await assert.rejects(
    () => gemini.generateJson('Return JSON.'),
    (error) => error instanceof GeminiResponseError && error.code === 'INVALID_JSON_RESPONSE',
  );
});

test('streams generated and chat text', async () => {
  const { client } = createFakeClient();
  const gemini = new GeminiKit({ client });

  const chunks = [];
  for await (const chunk of gemini.streamText('Stream this.')) chunks.push(chunk);
  assert.deepEqual(chunks, ['hello ', 'world']);

  const chat = gemini.createChat({
    model: 'chat-model',
    systemInstruction: 'Help the user.',
    history: [{ role: 'user', parts: [{ text: 'Hello' }] }],
  });

  assert.equal(await chat.sendText('Next'), 'chat:Next');
  const chatChunks = [];
  for await (const chunk of chat.streamText('Continue')) chatChunks.push(chunk);
  assert.deepEqual(chatChunks, ['chat ', 'stream']);
  assert.equal(chat.getHistory(true)[0].role, 'curated');
});

test('creates separate embedding inputs and returns vectors', async () => {
  const { client, calls } = createFakeClient();
  const gemini = new GeminiKit({ client, embeddingModel: 'embed-model' });

  assert.deepEqual(await gemini.embedText('one'), [1, 2]);
  assert.deepEqual(await gemini.embedMany(['one', 'two']), [[1, 2], [2, 3]]);
  assert.equal(calls.embed[1].model, 'embed-model');
  assert.deepEqual(calls.embed[1].contents, [
    { parts: [{ text: 'one' }] },
    { parts: [{ text: 'two' }] },
  ]);
});

test('retries transient failures and reports final attempt metadata', async () => {
  let attempts = 0;
  const retryEvents = [];
  const { client } = createFakeClient({
    models: {
      async generateContent() {
        attempts += 1;
        if (attempts < 3) throw Object.assign(new Error('busy'), { status: 503 });
        return { text: 'recovered' };
      },
    },
  });
  const gemini = new GeminiKit({
    client,
    retry: {
      maxRetries: 2,
      baseDelayMs: 0,
      jitter: 0,
      onRetry(event) { retryEvents.push(event.retryNumber); },
    },
  });

  assert.equal(await gemini.generateText('Try again.'), 'recovered');
  assert.equal(attempts, 3);
  assert.deepEqual(retryEvents, [1, 2]);

  const badClient = createFakeClient({
    models: {
      async generateContent() {
        throw Object.assign(new Error('bad request'), { status: 400 });
      },
    },
  }).client;

  await assert.rejects(
    () => new GeminiKit({ client: badClient }).generateText('Fail.'),
    (error) => (
      error instanceof GeminiKitError
      && error.status === 400
      && error.attempts === 1
      && error.retryable === false
    ),
  );
});

test('provides multimodal and vector helpers', () => {
  assert.deepEqual(inlineData(Buffer.from('hello'), 'text/plain'), {
    inlineData: { data: 'aGVsbG8=', mimeType: 'text/plain' },
  });
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(isRetryableError({ status: 429 }), true);
  assert.equal(isRetryableError({ status: 400 }), false);
});
