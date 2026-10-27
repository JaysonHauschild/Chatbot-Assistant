import { createGeminiKit } from '../dist/index.js';

const gemini = createGeminiKit();

for await (const chunk of gemini.streamText('Write a four-line poem about software.')) {
  process.stdout.write(chunk);
}

process.stdout.write('\n');
