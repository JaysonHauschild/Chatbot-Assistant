import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readStreamingChatResponse, buildChatHistory, getRetryMessages } from './chatRecovery.js'

const response = (events) => new Response(events.map(event => JSON.stringify(event)).join('\n'))

test('stream fallback clears partial primary text before accepting secondary answer', async () => {
  let text = ''
  let final
  await readStreamingChatResponse(response([
    { type: 'chunk', text: 'Incomplete primary' },
    { type: 'reset' },
    { type: 'chunk', text: 'Secondary answer' },
    { type: 'final', reply: 'Secondary answer', aiGenerated: true },
  ]), { onChunk: chunk => { text += chunk }, onReset: () => { text = '' }, onFinal: event => { final = event } })
  assert.equal(text, 'Secondary answer')
  assert.equal(final.aiGenerated, true)
})

test('a truncated stream is a retryable failure even when some text was received', async () => {
  await assert.rejects(readStreamingChatResponse(response([{ type: 'chunk', text: 'Partial answer' }]), {}), /interrupted/)
})

test('degraded final event preserves retry metadata', async () => {
  let final
  await readStreamingChatResponse(response([{ type: 'final', reply: 'Try again', aiGenerated: false, retryable: true }]), { onFinal: event => { final = event } })
  assert.equal(final.retryable, true)
})

test('retry keeps the original user message once and removes failed response', () => {
  const messages = [{ role: 'assistant', content: 'Hello' }, { role: 'user', content: 'Original question' }, { role: 'assistant', content: 'Error', failed: true, retryable: true }]
  assert.deepEqual(getRetryMessages(messages), messages.slice(0, -1))
  assert.equal(messages.length, 3)
  assert.equal(getRetryMessages([...messages, { role: 'user', content: 'New question' }]), null)
  assert.equal(getRetryMessages([{ role: 'user', content: 'Q' }, { role: 'assistant', content: 'Success' }]), null)
})

test('future history excludes failed pairs and client metadata while keeping successful context', () => {
  const messages = [
    { role: 'user', content: 'Failed question' },
    { role: 'assistant', content: 'Error', failed: true, retryable: true },
    { role: 'user', content: 'Successful question' },
    { role: 'assistant', content: 'Answer', aiGenerated: true, id: 'stream-1' },
  ]
  assert.deepEqual(buildChatHistory(messages), [{ role: 'user', content: 'Successful question' }, { role: 'assistant', content: 'Answer' }])
})

test('stream parsing tolerates split JSON lines and multibyte text split across network reads', async () => {
  const bytes = new TextEncoder().encode([
    { type: 'meta', conversationId: 'recovery-session' },
    { type: 'chunk', text: 'Asesoría útil 🌱' },
    { type: 'final', reply: 'Asesoría útil 🌱', aiGenerated: true },
  ].map(JSON.stringify).join('\n'))
  const network = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
      controller.close()
    },
  })
  let text = ''
  let conversationId
  let final
  await readStreamingChatResponse(new Response(network), {
    onMeta: event => { conversationId = event.conversationId },
    onChunk: chunk => { text += chunk },
    onFinal: event => { final = event },
  })
  assert.equal(conversationId, 'recovery-session')
  assert.equal(text, 'Asesoría útil 🌱')
  assert.equal(final.reply, text)
})

test('empty, malformed and unreadable streams surface errors instead of a successful answer', async () => {
  await assert.rejects(readStreamingChatResponse(new Response(''), {}), /interrupted/)
  await assert.rejects(readStreamingChatResponse(new Response('{invalid JSON}\n'), {}), SyntaxError)
  await assert.rejects(readStreamingChatResponse(new Response(null), {}), /not available/)
})
