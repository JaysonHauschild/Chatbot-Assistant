import { createGeminiKit } from '../dist/index.js';

const gemini = createGeminiKit();
const answer = await gemini.generateText('Explain what an API is in two sentences.');

console.log(answer);
