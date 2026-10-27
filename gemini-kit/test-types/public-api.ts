import {
  GeminiChat,
  GeminiKit,
  cosineSimilarity,
  createGeminiKit,
  inlineData,
  type GenerationResult,
} from '@jaysonh/gemini-kit';

const kit: GeminiKit = createGeminiKit({
  apiKey: 'test-key',
  model: 'gemini-2.5-flash',
  retry: { maxRetries: 1 },
});

const textPromise: Promise<string> = kit.generateText('Hello');
const resultPromise: Promise<GenerationResult> = kit.generate('Hello');
const interactionTextPromise: Promise<string> = kit.interactText('Hello');
const jsonPromise: Promise<{ data: { name: string } }> = kit.generateJson<{ name: string }>('Return a name', {
  schema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  },
});
const embeddingPromise: Promise<number[]> = kit.embedText('Hello');
const embeddingsPromise: Promise<number[][]> = kit.embedMany(['One', 'Two']);
const chat: GeminiChat = kit.createChat();
const chatTextPromise: Promise<string> = chat.sendText('Hello');
const media = inlineData(new Uint8Array([1, 2, 3]), 'application/octet-stream');
const score: number = cosineSimilarity([1, 0], [0, 1]);

void textPromise;
void resultPromise;
void interactionTextPromise;
void jsonPromise;
void embeddingPromise;
void embeddingsPromise;
void chatTextPromise;
void media;
void score;
