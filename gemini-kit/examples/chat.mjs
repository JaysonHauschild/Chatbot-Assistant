import { createGeminiKit } from '../dist/index.js';

const gemini = createGeminiKit();
const chat = gemini.createChat({
  systemInstruction: 'You are a concise customer-support assistant.',
});

console.log(await chat.sendText('I forgot my password.'));
console.log(await chat.sendText('What should I do first?'));
