import { createGeminiKit } from '../dist/index.js';

const gemini = createGeminiKit();

const answer = await gemini.generateText(
    'Explain cash flow in two sentences.'
);

console.log(answer);
