import { createGeminiKit } from '../dist/index.js';

const gemini = createGeminiKit();
const result = await gemini.generateJson('Create a two-item packing list for a day hike.', {
  schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['name', 'reason'],
        },
      },
    },
    required: ['items'],
  },
});

console.log(result.data);
