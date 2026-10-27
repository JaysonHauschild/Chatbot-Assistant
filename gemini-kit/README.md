# gemini-kit

A small, server-side Node.js package that makes common Gemini features easy to add without hiding the official SDK.

It provides:

- Text and multimodal generation
- The current Gemini Interactions API
- Async text streaming
- Structured JSON output with optional validation
- Stateful chat sessions
- Single and batch embeddings
- Exponential retries for transient API failures
- Normalized responses and typed errors
- Direct access to the underlying `@google/genai` client for advanced features

`gemini-kit` uses Google's current `@google/genai` SDK. It requires Node.js 20 or newer.

## Origin and independent maintenance

`gemini-kit` was created by Jayson Hauschild, the original developer of the OKSBDC Chatbot. It grew out of legacy Gemini utilities originally hardwired into this codebase, which were extracted into a reusable package for Gemini development. It is available on npm for use in separate projects.

Package updates may be released through npm independently of the OKSBDC Chatbot's release schedule, including after Jayson leaves development of this project. Maintenance will aim to preserve core functionality and tooling on a best-effort basis as the package evolves.

The chatbot uses this local package for query, crawler, and document embeddings and log-response evaluation through `server/lib/gemini-adapter.js`. Chat generation and classification still call `@google/generative-ai` directly. New npm releases of this toolkit do not automatically change the chatbot's behavior; adopting them requires an explicit integration or dependency change.

## Install

Install the npm package in a separate project:

```bash
npm install @jaysonh/gemini-kit
```

From this repository during local development:

```bash
npm install ../gemini-kit
```

Set an API key on the server:

```bash
GEMINI_API_KEY=your_api_key
```

Do not put Gemini API keys in browser code. Call Gemini from a trusted server or serverless function.

## Quick start

```js
import { createGeminiKit } from '@jaysonh/gemini-kit';

const gemini = createGeminiKit();
const answer = await gemini.generateText('Explain cash flow in two sentences.');

console.log(answer);
```

You can also pass configuration directly:

```js
const gemini = createGeminiKit({
  apiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-2.5-flash',
  embeddingModel: 'gemini-embedding-2',
  generationConfig: {
    temperature: 0.2,
    maxOutputTokens: 500,
  },
  retry: {
    maxRetries: 3,
    baseDelayMs: 300,
  },
});
```

The package reads these environment variables when explicit values are omitted:

- `GEMINI_API_KEY`, then `GOOGLE_API_KEY`
- `GEMINI_MODEL`
- `GEMINI_EMBEDDING_MODEL`

## Text generation

`generateText` returns just the generated text:

```js
const text = await gemini.generateText('Write three product taglines.', {
  systemInstruction: 'You are a concise brand copywriter.',
  config: { temperature: 0.7 },
});
```

`generate` returns normalized metadata alongside the raw SDK response:

```js
const result = await gemini.generate('Summarize this meeting transcript...');

console.log(result.text);
console.log(result.model);
console.log(result.usage);
console.log(result.raw);
```

Any valid `@google/genai` content can be passed through, including multimodal content:

```js
import { readFile } from 'node:fs/promises';
import { inlineData } from '@jaysonh/gemini-kit';

const image = await readFile('./receipt.png');
const text = await gemini.generateText([
  'Extract the merchant and total from this receipt.',
  inlineData(image, 'image/png'),
]);
```

## Interactions API

For projects using Google's newer Interactions API, `interactText` returns the output text and `interact` returns IDs, status, usage, and the raw response:

```js
const first = await gemini.interact('Explain dependency injection briefly.', {
  systemInstruction: 'You are a patient programming teacher.',
});

const followUp = await gemini.interact('Show a JavaScript example.', {
  request: { previous_interaction_id: first.id },
});

console.log(followUp.text);
```

The generation, chat, and embedding helpers remain available because they cover SDK features and compatibility needs that do not all map to Interactions.

## Streaming

```js
for await (const chunk of gemini.streamText('Write a short story.')) {
  process.stdout.write(chunk);
}
```

Use `gemini.stream(...)` when you need the raw SDK chunks.

Retries apply while establishing a stream. A stream that fails after output begins is not replayed because doing so could duplicate text.

## Structured JSON

```js
const productSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    category: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'category', 'keywords'],
  additionalProperties: false,
};

const result = await gemini.generateJson('Describe a reusable water bottle.', {
  schema: productSchema,
});

console.log(result.data);
```

An optional validation callback can return a transformed or validated value:

```js
const result = await gemini.generateJson('Return a priority from 1 to 5.', {
  schema: {
    type: 'object',
    properties: { priority: { type: 'integer', minimum: 1, maximum: 5 } },
    required: ['priority'],
  },
  validate(data) {
    if (!Number.isInteger(data.priority)) throw new Error('Invalid priority');
    return data;
  },
});
```

Gemini's structured-output mode guarantees valid JSON syntax, but applications should still validate values before using them for important actions.

## Chat

```js
const chat = gemini.createChat({
  systemInstruction: 'You are a helpful support assistant.',
});

console.log(await chat.sendText('My order arrived damaged.'));
console.log(await chat.sendText('What information do you need from me?'));

const history = chat.getHistory(true);
```

Chat messages can also be streamed with `chat.streamText(...)`.

## Embeddings

```js
import { cosineSimilarity } from '@jaysonh/gemini-kit';

const vectors = await gemini.embedMany([
  'How do I create a business plan?',
  'Help me write a plan for my company.',
  'What temperature should I bake bread at?',
]);

console.log(cosineSimilarity(vectors[0], vectors[1]));
```

Use `embedText` for a single vector, or `embed` for the complete normalized response and multimodal embedding inputs.

```js
const vector = await gemini.embedText('semantic search query', {
  config: { outputDimensionality: 768 },
});
```

## Errors and retries

Transient network errors and HTTP 408, 409, 425, 429, 500, 502, 503, and 504 responses are retried by default. Each request receives up to two retries with exponential backoff and jitter.

```js
import { GeminiKitError } from '@jaysonh/gemini-kit';

try {
  await gemini.generateText('Hello');
} catch (error) {
  if (error instanceof GeminiKitError) {
    console.error(error.code, error.status, error.attempts, error.retryable);
  }
}
```

Disable retries for a request when duplicate execution would be unsafe:

```js
await gemini.generateText('Run a tool-backed workflow', {
  retry: { maxRetries: 0 },
});
```

## Advanced SDK access

The official SDK remains available for features that this convenience layer does not wrap:

```js
const models = await gemini.client.models.list();
```

You can also inject a configured `GoogleGenAI` client:

```js
import { GoogleGenAI } from '@google/genai';
import { createGeminiKit } from '@jaysonh/gemini-kit';

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const gemini = createGeminiKit({ client });
```

Gemini Enterprise Agent Platform/Vertex configuration can be passed through `clientOptions`.

## Development

The implementation lives in `src/*.ts`. The build emits ESM, CommonJS, and
TypeScript declarations into `dist/` from the same source.

```bash
npm test
npm run check
npm run pack:check
```

The test suite uses an injected fake SDK client and does not make billable Gemini API calls.
