import { cosineSimilarity, createGeminiKit } from '../dist/index.js';

const gemini = createGeminiKit();
const [first, second] = await gemini.embedMany([
  'How do I write a business plan?',
  'Help me plan a new company.',
]);

console.log(cosineSimilarity(first, second));
