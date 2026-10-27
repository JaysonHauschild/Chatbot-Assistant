import { useState } from 'react'

export const CHAT_IDLE_TIMEOUT_MS = 10 * 60 * 1000
export const CHAT_IDLE_WARNING_MS = 9 * 60 * 1000

const CHAT_SESSION_ID_KEY = 'oksbdc_chat_session_id'
const CHAT_VISIT_ID_KEY = 'oksbdc_chat_visit_id'

const createConversationId = () => {
  const cryptoApi = globalThis?.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    try {
      return cryptoApi.randomUUID()
    } catch {
      // Fall back to non-crypto UUID format when browser crypto API misbehaves.
    }
  }

  return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const getOrCreateChatSessionId = (key = CHAT_SESSION_ID_KEY) => {
  try {
    const existing = sessionStorage.getItem(key)
    if (existing && existing.trim()) return existing.trim()

    const next = createConversationId()
    sessionStorage.setItem(key, next)
    return next
  } catch {
    return createConversationId()
  }
}

export function useChatSession({ apiBaseUrl, buildApiUrl, liveTestToken = '' }) {
  const [chatSessionId, setChatSessionId] = useState(() => liveTestToken ? createConversationId() : getOrCreateChatSessionId())
  const [visitId] = useState(() => liveTestToken ? createConversationId() : getOrCreateChatSessionId(CHAT_VISIT_ID_KEY))
  const [conversationId, setConversationId] = useState('')

  const createNextChatSession = () => {
    const nextSessionId = createConversationId()
    try {
      if (!liveTestToken) sessionStorage.setItem(CHAT_SESSION_ID_KEY, nextSessionId)
    } catch {
      // Keep the in-memory session ID even if sessionStorage is unavailable.
    }
    setChatSessionId(nextSessionId)
    setConversationId('')
    return nextSessionId
  }

  const logConversationInvalidation = (conversationIdToInvalidate, sessionIdToInvalidate) => {
    const safeConversationId = typeof conversationIdToInvalidate === 'string'
      ? conversationIdToInvalidate.trim()
      : ''
    if (!safeConversationId) return

    const resetUrl = new URL(buildApiUrl(apiBaseUrl, '/api/chat/reset'), window.location.origin)
    fetch(resetUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(liveTestToken ? { 'X-Live-Chat-Test': liveTestToken } : {}),
      },
      body: JSON.stringify({
        conversationId: safeConversationId,
        sessionId: sessionIdToInvalidate,
      }),
      keepalive: true,
    }).catch(() => {
      // Conversation status logging is best-effort from the browser; the server
      // also expires idle conversations independently.
    })
  }

  return {
    chatSessionId,
    visitId,
    conversationId,
    setConversationId,
    createNextChatSession,
    logConversationInvalidation,
  }
}
