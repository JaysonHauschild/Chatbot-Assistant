export const readStreamingChatResponse = async (response, {
  onMeta,
  onChunk,
  onFinal,
  onReset,
}) => {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Streaming response is not available in this browser.')

  const decoder = new TextDecoder()
  let buffered = ''
  let receivedFinal = false

  const handleLine = (line) => {
    const trimmedLine = line.trim()
    if (!trimmedLine) return

    const event = JSON.parse(trimmedLine)
    if (event.type === 'meta') {
      onMeta?.(event)
    } else if (event.type === 'chunk') {
      onChunk?.(typeof event.text === 'string' ? event.text : '')
    } else if (event.type === 'reset') {
      onReset?.()
    } else if (event.type === 'final') {
      receivedFinal = true
      onFinal?.(event)
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffered += decoder.decode(value, { stream: true })
    const lines = buffered.split('\n')
    buffered = lines.pop() || ''
    lines.forEach(handleLine)
  }

  buffered += decoder.decode()
  handleLine(buffered)
  if (!receivedFinal) throw new Error('The response was interrupted. Please try again.')
}


// Failed request/response pairs stay visible in the widget but are not context
// for future model calls. Send only the content fields the server consumes.
export function buildChatHistory(messages) {
  return messages.filter((message, index) => (
    !message.failed && !(message.role === 'user' && messages[index + 1]?.failed)
  )).map(({ role, content }) => ({ role, content }))
}

export function getRetryMessages(messages) {
  const last = messages.at(-1)
  const user = messages.at(-2)
  if (!last?.retryable || user?.role !== 'user') return null
  return messages.slice(0, -1)
}
