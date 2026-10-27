/**
 * App.jsx — Root React component for the OKSBDC Chatbot
 *
 * Renders two distinct UIs based on the current URL path:
 *   /           — The chat widget: a floating launcher button and slide-up chat
 *                 panel that overlays the host page.
 *   /chatbot/dashboard  — An account-protected admin panel for editing the AI system
 *                 prompt at runtime without restarting the server.
 *
 * All state is managed locally with React hooks — no external state library
 * (Redux, Zustand, etc.) is used.
 *
 * Key behaviours:
 *   - Theme (light/dark) persists to localStorage and defaults to the OS
 *     colour-scheme preference.
 *   - The AI disclaimer overlay must be accepted before any message can be
 *     sent. Acceptance is stored in sessionStorage (cleared on tab close).
 *   - A conversation ID is generated client-side on first render and reset
 *     when the user clears the chat. It is sent with every API request so
 *     all turns of one session are linked in the server-side audit log.
 *   - Adding ?test_mode=1 to the URL tags all server log entries as test
 *     traffic so they can be filtered out of production analytics.
 *
 * API base URL:
 *   Configured via VITE_API_BASE_URL. When VITE_EMBEDDED=true, the widget uses
 *   VITE_EMBED_API_BASE_URL first, then VITE_API_BASE_URL, then the current
 *   window origin; embedded mode coerces this value to an absolute server URL.
 */

import { readStreamingChatResponse, buildChatHistory, getRetryMessages } from './utils/chatRecovery.js'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { isWidgetServiceMessage, loadWidgetLanguage, translateWidgetText } from './utils/widgetLanguage.js'
import VersionBadge from './components/VersionBadge.jsx'
import ChatInput from './components/ChatInput.jsx'
import WidgetMenu from './components/WidgetMenu.jsx'
import { isEmbeddedContext, isTruthyEnvValue } from './utils/api.js'
import { normalizeAssistantMarkdown } from './utils/chatFormatting.js'
import { CHAT_IDLE_TIMEOUT_MS, CHAT_IDLE_WARNING_MS, useChatSession } from './hooks/useChatSession.js'
import { useChatFeedback } from './hooks/useChatFeedback.js'
import { useWidgetEmbedLayout } from './hooks/useWidgetEmbedLayout.js'

const IS_EMBEDDED = isEmbeddedContext()
const SHOW_EXPIRE_CONVERSATION_TEST_BUTTON = isTruthyEnvValue(import.meta.env.VITE_SHOW_EXPIRE_CONVERSATION_TEST_BUTTON)
const ALLOW_PII_DISCLAIMER_DISMISS = isTruthyEnvValue(import.meta.env.VITE_ALLOW_PII_DISCLAIMER_DISMISS)

const CHAT_WIDGET_DEFAULT_SIZE = Object.freeze({ width: 360, height: 510 })
const CHAT_WIDGET_MIN_SIZE = Object.freeze({ width: 320, height: 420 })
const CHAT_WIDGET_VIEWPORT_MARGIN = Object.freeze({ width: 24, height: 92 })
const CHAT_WIDGET_SIZE_STORAGE_KEY = 'chatbot_widget_size'
const CHAT_WIDGET_OPENED_STORAGE_KEY = 'chatbot_widget_has_opened'

const clampNumber = (value, min, max) => Math.min(Math.max(value, min), max)

const getConstrainedChatWidgetSize = (size) => {
  const viewportWidth = typeof window === 'undefined' ? CHAT_WIDGET_DEFAULT_SIZE.width + CHAT_WIDGET_VIEWPORT_MARGIN.width : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? CHAT_WIDGET_DEFAULT_SIZE.height + CHAT_WIDGET_VIEWPORT_MARGIN.height : window.innerHeight
  const maxWidth = Math.max(280, viewportWidth - CHAT_WIDGET_VIEWPORT_MARGIN.width)
  const maxHeight = Math.max(360, viewportHeight - CHAT_WIDGET_VIEWPORT_MARGIN.height)
  const minWidth = Math.min(CHAT_WIDGET_MIN_SIZE.width, maxWidth)
  const minHeight = Math.min(CHAT_WIDGET_MIN_SIZE.height, maxHeight)
  const requestedWidth = Number.isFinite(size?.width) ? size.width : CHAT_WIDGET_DEFAULT_SIZE.width
  const requestedHeight = Number.isFinite(size?.height) ? size.height : CHAT_WIDGET_DEFAULT_SIZE.height

  return {
    width: Math.round(clampNumber(requestedWidth, minWidth, maxWidth)),
    height: Math.round(clampNumber(requestedHeight, minHeight, maxHeight)),
  }
}


const loadStoredChatWidgetSize = () => {
  if (typeof window === 'undefined') return CHAT_WIDGET_DEFAULT_SIZE

  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_WIDGET_SIZE_STORAGE_KEY) || 'null')
    return getConstrainedChatWidgetSize(parsed)
  } catch {
    return getConstrainedChatWidgetSize(CHAT_WIDGET_DEFAULT_SIZE)
  }
}

// Maximum number of characters a user can type in the input field.
// Enforced both client-side (textarea maxLength) and by the server.
const MAX_MESSAGE_LENGTH = 400
const STREAM_TYPING_INTERVAL_MS = 28
const STREAM_TYPING_MAX_CHARS_PER_FRAME = 10
const DEFAULT_CHAT_REQUEST_TIMEOUT_MS = 90_000

const parsePositiveTimeout = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const CHAT_REQUEST_TIMEOUT_MS = parsePositiveTimeout(
  import.meta.env.VITE_CHAT_REQUEST_TIMEOUT_MS,
  DEFAULT_CHAT_REQUEST_TIMEOUT_MS,
)


/**
 * Generates a unique ID for a new chat conversation.
 *
 * Used to link all turns of one chat session in the server-side audit log.
 * Prefers the native crypto.randomUUID() API (all modern browsers) and falls
 * back to a timestamp + random string for older environments.
 *
 * @returns {string} A UUID or a unique fallback string.
 */
function ChatWidget({ apiBaseUrl, buildApiUrl, theme, toggleTheme, liveTestToken = '', liveTestLiteMode = false, testControlsTarget = null }) {
  const requestHeaders = liveTestToken ? { 'X-Live-Chat-Test': liveTestToken } : {}
  const [language, setLanguage] = useState(loadWidgetLanguage)
  const t = (text) => translateWidgetText(text, language)
  const changeLanguage = (nextLanguage) => {
    setLanguage(nextLanguage)
    try {
      localStorage.setItem('chatbot_language', nextLanguage)
    } catch {
      // Keep the selection in memory when storage is unavailable.
    }
  }

  // Font size preference — persisted to localStorage.
  // Values: 'small' | 'medium' | 'large'. Defaults to 'medium'.
  const FONT_SIZES = ['small', 'medium', 'large']
  const [fontSize, setFontSize] = useState(() => {
    const stored = localStorage.getItem('chatbot_font_size')
    return FONT_SIZES.includes(stored) ? stored : 'medium'
  })
  const cycleFontSize = (size) => {
    localStorage.setItem('chatbot_font_size', size)
    setFontSize(size)
  }

  // The page on the embedding site that loaded this widget.
  // Embedding sites can pass it explicitly via ?page_url= on the iframe src;
  // otherwise we fall back to document.referrer (set by the browser for iframes).
  const pageUrl = (() => {
    const param = new URLSearchParams(window.location.search).get('page_url')
    if (param) {
      try { return new URL(param).href } catch { /* ignore malformed value */ }
    }
    return document.referrer || null
  })()
  // ── Chat widget state ───────────────────────────────────────────────────────
  const [isOpen, setIsOpen] = useState(Boolean(liveTestToken))
  const widgetShellRef = useWidgetEmbedLayout({ isOpen, enabled: IS_EMBEDDED })
  const [hasOpenedWidget, setHasOpenedWidget] = useState(() => {
    try {
      return localStorage.getItem(CHAT_WIDGET_OPENED_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })
  const openWidget = () => {
    setIsOpen(true)
    setHasOpenedWidget(true)
    try {
      localStorage.setItem(CHAT_WIDGET_OPENED_STORAGE_KEY, 'true')
    } catch {
      // Keep the prompt dismissed in memory when storage is unavailable.
    }
  }
  const [isWidgetMenuOpen, setIsWidgetMenuOpen] = useState(false)
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [simulationWaitSeconds, setSimulationWaitSeconds] = useState('15')
  const [serverLiteMode, setServerLiteMode] = useState(false)
  const isLiteMode = serverLiteMode || (Boolean(liveTestToken) && liveTestLiteMode)
  const [replyAnnouncement, setReplyAnnouncement] = useState('')
  const [slowResponseMessage, setSlowResponseMessage] = useState('')
  const [chatWidgetSize, setChatWidgetSize] = useState(loadStoredChatWidgetSize)
  const [isResizingChat, setIsResizingChat] = useState(false)
  const [idleWarningVisible, setIdleWarningVisible] = useState(false)
  const [idleTimerResetCount, setIdleTimerResetCount] = useState(0)
  const [isStreamingResponse, setIsStreamingResponse] = useState(false)

  //  The full conversation displayed in the widget. The first message is the
  // assistant greeting. The server receives a slice of this array starting from
  // the first user message (the greeting is not sent to the API).
  const [conversationExpiredNotice, setConversationExpiredNotice] = useState(null)
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      localText: true,
        content: 'Hi there! I am your OKSBDC assistant. How can I help today?',
    },
  ])


  // Tracks whether the user intentionally closed the chat (vs. it opening
  // closed by default), so the feedback widget only shows after a real session.
  const [hasManuallyClosedChat, setHasManuallyClosedChat] = useState(false)
  // ── Refs ─────────────────────────────────────────────────────────────────────
  const messageListRef = useRef(null)     // Scrollable message list container
  const chatWidgetRef = useRef(null)      // Outer widget element
  const widgetMenuRef = useRef(null)      // Options dropdown menu
  const widgetMenuButtonRef = useRef(null) // Button that opens the options menu
  const textareaRef = useRef(null)        // Input textarea (for auto-resize)
  const resizeSessionRef = useRef(null)   // Active chat-window resize drag state
  const slowResponseTimeoutRefs = useRef([]) // Timeouts for long-running response notices
  const streamAnimationRef = useRef(null)
  const streamTypingStateRef = useRef(null)
  const streamMessageIdCounterRef = useRef(0)
  const chatRequestRef = useRef(null)

  // Check on opening and periodically so mode changes appear before the next question.
  useEffect(() => {
    if (!isOpen) return undefined
    const controller = new AbortController()
    let checking = false
    const checkMode = async () => {
      if (checking) return
      checking = true
      try {
        const response = await fetch(buildApiUrl(apiBaseUrl, 'api/chat/mode'), {
          headers: liveTestToken ? { 'X-Live-Chat-Test': liveTestToken } : {},
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!response.ok) return
        const data = await response.json()
        if (!controller.signal.aborted && typeof data.liteMode === 'boolean') setServerLiteMode(data.liteMode)
      } catch {
        // The message endpoint still enforces lite mode when status checks fail.
      } finally { checking = false }
    }
    void checkMode()
    const interval = window.setInterval(checkMode, 30_000)
    return () => { controller.abort(); window.clearInterval(interval) }
  }, [apiBaseUrl, buildApiUrl, isOpen, liveTestToken])

  const {
    chatSessionId,
    visitId,
    conversationId,
    setConversationId,
    createNextChatSession,
    logConversationInvalidation,
  } = useChatSession({ apiBaseUrl, buildApiUrl, liveTestToken })

  const {
    chatFeedback,
    isFeedbackClosing,
    showFeedbackThanks,
    setShowFeedbackThanks,
    lastRatedAssistantIndex,
    closedChatFeedback,
    setClosedChatFeedback,
    showClosedFeedbackThanks,
    setShowClosedFeedbackThanks,
    hideClosedFeedbackUntilNextClose,
    setHideClosedFeedbackUntilNextClose,
    isWrittenFeedbackOpen,
    setIsWrittenFeedbackOpen,
    writtenFeedbackText,
    setWrittenFeedbackText,
    writtenFeedbackError,
    setWrittenFeedbackError,
    resetFeedbackState,
    submitChatFeedback,
    submitClosedChatFeedback,
    submitWrittenChatFeedback,
  } = useChatFeedback({ apiBaseUrl, buildApiUrl, conversationId, messages, liveTestToken })

  // The disclaimer overlay blocks all input until the user clicks "I Agree".
  const [hasAgreedToDisclaimer, setHasAgreedToDisclaimer] = useState(
    () => sessionStorage.getItem('chatbot_disclaimer_agreed') === 'true'
  )
  const [isPiiDisclaimerVisible, setIsPiiDisclaimerVisible] = useState(
    () => !ALLOW_PII_DISCLAIMER_DISMISS ||
      sessionStorage.getItem('chatbot_pii_disclaimer_dismissed') !== 'true'
  )
  const canInteractWithChat = hasAgreedToDisclaimer

  const agreeToDisclaimer = () => {
    sessionStorage.setItem('chatbot_disclaimer_agreed', 'true')
    setHasAgreedToDisclaimer(true)
  }

  const dismissPiiDisclaimer = () => {
    if (!ALLOW_PII_DISCLAIMER_DISMISS) return
    sessionStorage.setItem('chatbot_pii_disclaimer_dismissed', 'true')
    setIsPiiDisclaimerVisible(false)
  }

  // Show feedback only on the newest assistant reply after the intro message.
  const latestFeedbackAssistantIndex = (() => {
    for (let index = messages.length - 1; index >= 1; index -= 1) {
      if (messages[index]?.role === 'assistant') {
        return index
      }
    }
    return -1
  })()
  const hasSentUserMessage = messages.some((message) => message.role === 'user')
  // Stream headers and metadata can arrive well before any reply text.
  const isWaitingForResponse = isSending && (
    !isStreamingResponse || !messages.at(-1)?.content.trim()
  )

  // Scroll the message list to the bottom whenever a new message is added or
  // the widget is opened, so the latest message is always visible.
  useEffect(() => {
    if (isOpen) {
      messageListRef.current?.scrollTo({
        top: messageListRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [messages, isOpen, isWaitingForResponse, slowResponseMessage, idleWarningVisible, conversationExpiredNotice])

  // Show escalating reassurance text beside the typing indicator when an API
  // response takes longer than expected, then clear it when the response ends.
  useEffect(() => {
    slowResponseTimeoutRefs.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    slowResponseTimeoutRefs.current = []

    if (!isWaitingForResponse) {
      const timeoutId = window.setTimeout(() => setSlowResponseMessage(''), 0)
      slowResponseTimeoutRefs.current = [timeoutId]
      return undefined
    }

    slowResponseTimeoutRefs.current = [
      window.setTimeout(() => {
        setSlowResponseMessage('')
      }, 0),
      window.setTimeout(() => {
        setSlowResponseMessage('Taking a little longer than usual...')
      }, 7000),
      window.setTimeout(() => {
        setSlowResponseMessage("We're working on it")
      }, 12000),
    ]

    return () => {
      slowResponseTimeoutRefs.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
      slowResponseTimeoutRefs.current = []
    }
  }, [isWaitingForResponse])

  // Clean up feedback timeouts when the component unmounts to prevent state
  // updates on an unmounted component (which logs warnings in development).
  useEffect(() => {
    return () => {
      slowResponseTimeoutRefs.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
      slowResponseTimeoutRefs.current = []
      const activeRequest = chatRequestRef.current
      if (activeRequest) {
        activeRequest.reason = 'unmounted'
        window.clearTimeout(activeRequest.timeoutId)
        activeRequest.controller.abort()
        chatRequestRef.current = null
      }
      if (streamAnimationRef.current) {
        window.cancelAnimationFrame(streamAnimationRef.current)
        streamAnimationRef.current = null
      }
    }
  }, [])

  const stopStreamingAnimation = () => {
    if (streamAnimationRef.current) {
      window.cancelAnimationFrame(streamAnimationRef.current)
      streamAnimationRef.current = null
    }
    streamTypingStateRef.current = null
  }

  const abortActiveChatRequest = (reason = 'cancelled') => {
    const activeRequest = chatRequestRef.current
    if (!activeRequest || activeRequest.controller.signal.aborted) return

    activeRequest.reason = reason
    window.clearTimeout(activeRequest.timeoutId)
    activeRequest.controller.abort()
  }

  const updateStreamingAssistantMessage = (messageId, content, extra = {}) => {
    setMessages((current) => current.map((message) => (
      message.id === messageId ? { ...message, content, ...extra } : message
    )))
  }

  const startStreamingAnimation = (messageId) => {
    stopStreamingAnimation()
    streamTypingStateRef.current = {
      messageId,
      queuedText: '',
      visibleText: '',
      lastFrameAt: 0,
    }

    const tick = (timestamp) => {
      const state = streamTypingStateRef.current
      if (!state || state.messageId !== messageId) return

      if (state.queuedText && timestamp - state.lastFrameAt >= STREAM_TYPING_INTERVAL_MS) {
        const takeCount = Math.min(
          STREAM_TYPING_MAX_CHARS_PER_FRAME,
          Math.max(1, Math.ceil(state.queuedText.length / 18)),
        )
        state.visibleText += state.queuedText.slice(0, takeCount)
        state.queuedText = state.queuedText.slice(takeCount)
        state.lastFrameAt = timestamp
        updateStreamingAssistantMessage(messageId, state.visibleText || ' ')
      }

      streamAnimationRef.current = window.requestAnimationFrame(tick)
    }

    streamAnimationRef.current = window.requestAnimationFrame(tick)
  }

  const queueStreamingText = (messageId, text) => {
    const state = streamTypingStateRef.current
    if (!state || state.messageId !== messageId || !text) return
    state.queuedText += text
  }

  const finishStreamingAnimation = (messageId, finalText, extra = {}) => {
    const state = streamTypingStateRef.current
    if (state && state.messageId === messageId && !finalText) {
      updateStreamingAssistantMessage(messageId, state.visibleText + state.queuedText || 'No response returned.', extra)
    } else {
      updateStreamingAssistantMessage(messageId, finalText || 'No response returned.', { localText: !finalText, ...extra })
    }
    stopStreamingAnimation()
  }

  // Auto-dismiss the feedback "thanks" message after a short delay and reset the
  // hasManuallyClosedChat flag so the feedback widget is hidden cleanly.
  useEffect(() => {
    if (!showFeedbackThanks) return

    const timeoutId = window.setTimeout(() => {
      setShowFeedbackThanks(false)
      setHasManuallyClosedChat(false)
    }, 2500)

    return () => window.clearTimeout(timeoutId)
  }, [setShowFeedbackThanks, showFeedbackThanks])

  useEffect(() => {
    if (!showClosedFeedbackThanks) return

    const timeoutId = window.setTimeout(() => {
      setShowClosedFeedbackThanks(false)
      setHideClosedFeedbackUntilNextClose(true)
    }, 2500)

    return () => window.clearTimeout(timeoutId)
  }, [setHideClosedFeedbackUntilNextClose, setShowClosedFeedbackThanks, showClosedFeedbackThanks])

  // Keep the textarea between 2 and 5 lines tall. Recalculate when the widget
  // opens or changes width so a measurement taken while it is closed (and has
  // zero width) cannot leave the empty input several lines tall.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const styles = getComputedStyle(el)
    const lineHeight = parseFloat(styles.lineHeight)
    const paddingTop = parseFloat(styles.paddingTop)
    const paddingBottom = parseFloat(styles.paddingBottom)
    const borderTop = parseFloat(styles.borderTopWidth)
    const borderBottom = parseFloat(styles.borderBottomWidth)
    const verticalChrome = paddingTop + paddingBottom + borderTop + borderBottom
    const minHeight = lineHeight * 2 + verticalChrome
    const maxHeight = lineHeight * 5 + verticalChrome
    const contentHeight = el.scrollHeight + borderTop + borderBottom
    el.style.height = Math.max(minHeight, Math.min(contentHeight, maxHeight)) + 'px'
    el.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden'
  }, [chatWidgetSize.width, fontSize, input, isOpen])


  useEffect(() => {
    if (IS_EMBEDDED) {
      document.documentElement.setAttribute('data-embedded', '')
    }
  }, [])

  useEffect(() => {
    if (IS_EMBEDDED) return
    try {
      localStorage.setItem(CHAT_WIDGET_SIZE_STORAGE_KEY, JSON.stringify(chatWidgetSize))
    } catch {
      // Storage can be unavailable in private browsing or embedded contexts.
      // Resizing should still work for the current session.
    }
  }, [chatWidgetSize])

  useEffect(() => {
    const handleResize = () => {
      setChatWidgetSize((currentSize) => getConstrainedChatWidgetSize(currentSize))
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!isResizingChat) return undefined

    const handlePointerMove = (event) => {
      const session = resizeSessionRef.current
      if (!session) return

      setChatWidgetSize(getConstrainedChatWidgetSize({
        width: session.startWidth + (session.startX - event.clientX),
        height: session.startHeight + (session.startY - event.clientY),
      }))
    }

    const stopResizing = () => {
      setIsResizingChat(false)
      resizeSessionRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('pointercancel', stopResizing)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('pointercancel', stopResizing)
    }
  }, [isResizingChat])

  const startChatResize = (event) => {
    event.preventDefault()
    setIsWidgetMenuOpen(false)
    resizeSessionRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: chatWidgetSize.width,
      startHeight: chatWidgetSize.height,
    }
    setIsResizingChat(true)
  }

  const handleChatResizeKeyDown = (event) => {
    const step = event.shiftKey ? 40 : 16
    const keyDeltas = {
      ArrowLeft: { width: step, height: 0 },
      ArrowRight: { width: -step, height: 0 },
      ArrowUp: { width: 0, height: step },
      ArrowDown: { width: 0, height: -step },
    }

    if (event.key === 'Home') {
      event.preventDefault()
      setChatWidgetSize(getConstrainedChatWidgetSize(CHAT_WIDGET_DEFAULT_SIZE))
      return
    }

    const delta = keyDeltas[event.key]
    if (!delta) return

    event.preventDefault()
    setChatWidgetSize((currentSize) => getConstrainedChatWidgetSize({
      width: currentSize.width + delta.width,
      height: currentSize.height + delta.height,
    }))
  }

  /**
   * Submits the message on Enter (without Shift). Shift+Enter inserts a
   * newline, allowing multi-line messages.
   */
  const handleTextareaKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage(event)
    }
  }

  // Close the options dropdown when the user clicks anywhere outside the
  // menu or its trigger button. Uses pointerdown (not click) so it fires
  // before any click handlers on the document and feels responsive.
  useEffect(() => {
    const handleDocumentPointerDown = (event) => {
      if (!isWidgetMenuOpen) return

      const menuEl = widgetMenuRef.current
      const buttonEl = widgetMenuButtonRef.current
      const target = event.target

      if (menuEl?.contains(target) || buttonEl?.contains(target)) {
        return
      }

      setIsWidgetMenuOpen(false)
    }

    document.addEventListener('pointerdown', handleDocumentPointerDown)
    return () => document.removeEventListener('pointerdown', handleDocumentPointerDown)
  }, [isWidgetMenuOpen])

  /**
   * Sends the current input to the chat API and appends the response to the
   * message list.
   *
   * History sent to the API:
   *   - Starts from the first user message (the initial assistant greeting is
   *     omitted because it is not part of the conversation context the model
   *     needs to see).
   *   - Does not include the message being sent in the current turn — that is
   *     passed as the `message` field separately.
   *
   * On network or server errors, a generic error message is appended so the
   * user is always shown something rather than a silent failure.
   */
  const sendMessage = async (event, retry = false, simulatedWaitMs = null) => {
    event.preventDefault()
    const isSimulation = Boolean(liveTestToken) && Number.isFinite(simulatedWaitMs) && simulatedWaitMs >= 0
    const retryMessages = retry ? getRetryMessages(messages) : null
    if (retry && !retryMessages) return
    const trimmed = retry ? retryMessages.at(-1).content : input.trim() || (isSimulation ? 'Test a delayed response.' : '')
    if (!trimmed || isSending || chatRequestRef.current || conversationExpiredNotice) return

    const nextMessages = retryMessages || [...messages, { role: 'user', content: trimmed }]
    setMessages(nextMessages)
    if (!retry) {
      setInput('')
    }
    setIsSending(true)
    // Keep the live region quiet during streaming and clear previous text so
    // identical replies on later turns can be announced again.
    setReplyAnnouncement('')
    setIdleWarningVisible(false)
    let streamingAssistantMessageId = ''
    abortActiveChatRequest('replaced')

    const controller = new AbortController()
    const activeRequest = {
      controller,
      reason: null,
      timeoutId: null,
    }
    if (!isSimulation) activeRequest.timeoutId = window.setTimeout(() => {
      activeRequest.reason = 'timeout'
      controller.abort()
    }, CHAT_REQUEST_TIMEOUT_MS)
    chatRequestRef.current = activeRequest

    try {
      if (isSimulation) {
        await new Promise((resolve, reject) => {
          const onAbort = () => {
            window.clearTimeout(timer)
            reject(new DOMException('Aborted', 'AbortError'))
          }
          const timer = window.setTimeout(() => {
            controller.signal.removeEventListener('abort', onAbort)
            resolve()
          }, simulatedWaitMs)
          controller.signal.addEventListener('abort', onAbort, { once: true })
        })
        const reply = `Simulated response after ${simulatedWaitMs / 1000} seconds.`
        setMessages((current) => [...current, { role: 'assistant', content: reply, aiGenerated: false }])
        setReplyAnnouncement(reply)
        return
      }

      const historyForApi = buildChatHistory(nextMessages.slice(0, -1))
      const firstUserIndex = historyForApi.findIndex((item) => item.role === 'user')
      const chatUrl = new URL(buildApiUrl(apiBaseUrl, 'api/chat'), window.location.origin)
      const testMode = new URLSearchParams(window.location.search).get('test_mode')
      if (testMode === '1') {
        chatUrl.searchParams.set('test_mode', '1')
      }

      const response = await fetch(
        chatUrl.toString(),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...requestHeaders,
          },
          body: JSON.stringify({
            message: trimmed,
            language,
            history: firstUserIndex >= 0 ? historyForApi.slice(firstUserIndex) : [],
            sessionId: chatSessionId,
            visitId,
            stream: true,
            ...(liveTestToken ? { liteMode: liveTestLiteMode } : {}),
            ...(conversationId ? { conversationId } : {}),
            ...(pageUrl ? { pageUrl } : {}),
          }),
          signal: controller.signal,
        },
      )

      if (!response.ok) {
        let errorMessage = 'Failed to get response from server.'
        try {
          const errorData = await response.json()
          if (typeof errorData?.error === 'string' && errorData.error.trim()) {
            errorMessage = errorData.error
          }
        } catch {
          // Keep generic message when response is not valid JSON.
        }

        const error = new Error(errorMessage)
        error.retryable = [408, 429].includes(response.status) || response.status >= 500
        throw error
      }

      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('application/x-ndjson')) {
        streamMessageIdCounterRef.current += 1
        const assistantMessageId = `stream-${streamMessageIdCounterRef.current}`
        streamingAssistantMessageId = assistantMessageId
        let streamedReply = ''
        let finalReply = ''
        let completedAnnouncement = ''

        setIsStreamingResponse(true)
        setMessages((current) => [
          ...current,
          {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            aiGenerated: true,
          },
        ])
        startStreamingAnimation(assistantMessageId)

        await readStreamingChatResponse(response, {
          onMeta: (event) => {
            if (typeof event?.liteMode === 'boolean') setServerLiteMode(event.liteMode && event.liteModeReason !== 'test')
            if (typeof event?.conversationId === 'string' && event.conversationId.trim()) {
              setConversationId(event.conversationId.trim())
            }
          },
          onReset: () => {
            streamedReply = ''
            finalReply = ''
            startStreamingAnimation(assistantMessageId)
            updateStreamingAssistantMessage(assistantMessageId, '')
          },
          onChunk: (text) => {
            if (!text) return
            streamedReply += text
            queueStreamingText(assistantMessageId, text)
          },
          onFinal: (event) => {
            if (typeof event?.liteMode === 'boolean') setServerLiteMode(event.liteMode && event.liteModeReason !== 'test')
            finalReply = typeof event?.reply === 'string' ? event.reply : streamedReply
            completedAnnouncement = finalReply || streamedReply || t('No response returned.')
            if (event?.aiGenerated !== true && isWidgetServiceMessage(completedAnnouncement)) {
              completedAnnouncement = t(completedAnnouncement)
            }
            if (typeof event?.conversationId === 'string' && event.conversationId.trim()) {
              setConversationId(event.conversationId.trim())
            }
            finishStreamingAnimation(
              assistantMessageId,
              finalReply || streamedReply || 'No response returned.',
              {
                aiGenerated: event?.aiGenerated === true,
                localText: !finalReply && !streamedReply,
                failed: event?.retryable === true || !finalReply.trim(),
                retryable: event?.retryable === true || !finalReply.trim(),
              },
            )
          },
        })

        if (!finalReply && !streamedReply) {
          finishStreamingAnimation(assistantMessageId, 'No response returned.', { localText: true })
        }
        setReplyAnnouncement(completedAnnouncement)
        return
      }

      const data = await response.json()
      if (typeof data?.liteMode === 'boolean') setServerLiteMode(data.liteMode && data.liteModeReason !== 'test')
      if (data?.conversationExpired === true) {
        createNextChatSession()
        showConversationExpiredNotice({
          title: 'Conversation expired',
          detail: data.reply || 'This conversation has expired. Please start a new chat to continue.',
          reason: 'server_expired',
        })
        return
      }

      if (typeof data?.conversationId === 'string' && data.conversationId.trim()) {
        setConversationId(data.conversationId.trim())
      }
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: data.reply || 'No response returned.',
          localText: !data.reply,
          aiGenerated: data.aiGenerated === true,
          failed: data.retryable === true || !data.reply?.trim(),
          retryable: data.retryable === true || !data.reply?.trim(),
        },
      ])
      setReplyAnnouncement(!data.reply
        ? t('No response returned.')
        : data.aiGenerated !== true && isWidgetServiceMessage(data.reply) ? t(data.reply) : data.reply)
    } catch (error) {
      const abortReason = activeRequest.reason
      const wasSilentlyCancelled = controller.signal.aborted && [
        'conversation_expired',
        'replaced',
        'reset',
        'unmounted',
      ].includes(abortReason)
      if (wasSilentlyCancelled) return

      const errorMessage = abortReason === 'timeout'
        ? 'The request took too long and was cancelled. Please try again.'
        : error?.message ||
        'I am having trouble reaching the assistant service right now. Please try again in a moment.'
      setReplyAnnouncement(t(errorMessage))
      if (streamingAssistantMessageId) {
        finishStreamingAnimation(streamingAssistantMessageId, errorMessage, { aiGenerated: false, localText: true, failed: true, retryable: error.retryable !== false })
      } else {
        setMessages((current) => [
          ...current,
          {
            role: 'assistant',
            content: errorMessage,
            localText: true,
            failed: true,
            retryable: error.retryable !== false,
          },
        ])
      }
    } finally {
      window.clearTimeout(activeRequest.timeoutId)
      if (chatRequestRef.current === activeRequest) {
        chatRequestRef.current = null
        setIsStreamingResponse(false)
        setIsSending(false)
      }
    }
  }

  const showConversationExpiredNotice = ({ title, detail, reason = 'expired' } = {}) => {
    abortActiveChatRequest('conversation_expired')
    setReplyAnnouncement('')
    setIdleWarningVisible(false)
    setConversationExpiredNotice({
      title: title || 'Conversation expired',
      detail: detail || 'For your privacy and to keep guidance accurate, this chat has been closed. Start a new chat to continue.',
      reason,
    })
    setInput('')
    setIsSending(false)
    setIsStreamingResponse(false)
    stopStreamingAnimation()
  }

  const startNewChatFromExpiredNotice = () => {
    setConversationExpiredNotice(null)
    resetChat({ notifyServer: false })
  }

  /**
   * Resets the chat to its initial state: clears messages, feedback, timers,
   * the input field, and generates a new conversation ID so the next session
   * is tracked separately in the audit log.
   */
  const resetChat = ({ notifyServer = true } = {}) => {
    abortActiveChatRequest('reset')
    setReplyAnnouncement('')
    const previousConversationId = conversationId
    const previousSessionId = chatSessionId
    if (notifyServer) {
      logConversationInvalidation(previousConversationId, previousSessionId)
    }
    setConversationExpiredNotice(null)
    setIdleWarningVisible(false)
    setMessages([
      {
        role: 'assistant',
        localText: true,
        content: 'Hi there! I am the OKSBDC assistant. How can I help today?'
      },
    ])
    resetFeedbackState()
    setIsWidgetMenuOpen(false)
    setInput('')
    setIsSending(false)
    setIsStreamingResponse(false)
    stopStreamingAnimation()
    createNextChatSession()
    setHasManuallyClosedChat(false)
    setIdleTimerResetCount((count) => count + 1)
  }

  useEffect(() => {
    if (!conversationId || isSending) return undefined

    const hasUserMessage = messages.some((message) => message.role === 'user')
    if (!hasUserMessage) return undefined

    const resetWarningTimeoutId = window.setTimeout(() => {
      setIdleWarningVisible(false)
    }, 0)

    const warningTimeoutId = window.setTimeout(() => {
      setIdleWarningVisible(true)
    }, CHAT_IDLE_WARNING_MS)

    const expirationTimeoutId = window.setTimeout(() => {
      logConversationInvalidation(conversationId, chatSessionId)
      createNextChatSession()
      showConversationExpiredNotice({
        title: 'Conversation timed out',
        detail: 'This chat was closed after 10 minutes without a new message. Start a new chat when you are ready to continue.',
        reason: 'idle_timeout',
      })
    }, CHAT_IDLE_TIMEOUT_MS)

    return () => {
      window.clearTimeout(resetWarningTimeoutId)
      window.clearTimeout(warningTimeoutId)
      window.clearTimeout(expirationTimeoutId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSessionId, conversationId, idleTimerResetCount, isSending, messages])

  const restartIdleTimer = () => {
    setIdleWarningVisible(false)
    setIdleTimerResetCount((count) => count + 1)
  }

  const expireConversationForTesting = () => {
    if (!conversationId) return
    logConversationInvalidation(conversationId, chatSessionId)
    createNextChatSession()
    showConversationExpiredNotice({
      title: 'Conversation expired for testing',
      detail: 'The active conversation ID was invalidated. Use Start a new chat to continue with a fresh conversation.',
      reason: 'manual_test_expire',
    })
    setIsWidgetMenuOpen(false)
  }

  /**
   * Collapses the chat widget to the launcher bubble. Sets hasManuallyClosedChat
   * so the feedback widget is shown (only after the user has sent at least one
   * message — see the render logic below).
   */
  const closeChat = () => {
    setIsOpen(false)
    setIsWidgetMenuOpen(false)
    setClosedChatFeedback(null)
    setShowClosedFeedbackThanks(false)
    setHideClosedFeedbackUntilNextClose(false)
    setIsWrittenFeedbackOpen(false)
    setWrittenFeedbackText('')
    setWrittenFeedbackError('')
    setHasManuallyClosedChat(true)
  }

  const logLinkClick = (url, turn) => {
    const clickUrl = new URL(buildApiUrl(apiBaseUrl, 'api/chat/link-click'), window.location.origin)
    const testMode = new URLSearchParams(window.location.search).get('test_mode')
    if (testMode === '1') clickUrl.searchParams.set('test_mode', '1')
    void fetch(clickUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...requestHeaders },
      body: JSON.stringify({ url, conversationId, turn }),
    }).catch(() => {})
  }

  return (
    <main
      ref={widgetShellRef}
      className={`widget-shell${isOpen ? ' is-open' : ''}${IS_EMBEDDED ? ' is-embedded' : ''}`}
      data-font-size={fontSize}
      lang={language}
    >
      <div className="sr-only chat-reply-announcement" role="status" aria-live="polite" aria-atomic="true">
        {replyAnnouncement && (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Announcements must not introduce invisible tab stops.
              a: ({ children }) => <span>{children}</span>,
              img: ({ alt }) => <span>{alt}</span>,
            }}
          >
            {`${t('Assistant:')} ${normalizeAssistantMarkdown(replyAnnouncement)}`}
          </ReactMarkdown>
        )}
      </div>

      <section
        id="chat-widget"
        ref={chatWidgetRef}
        className={`chat-widget ${isOpen ? 'open' : ''} ${isResizingChat ? 'is-resizing' : ''} ${!hasAgreedToDisclaimer ? 'has-pending-disclaimer' : ''}`}
        aria-hidden={!isOpen}
        style={!IS_EMBEDDED && isOpen && !liveTestToken ? {
          width: `${chatWidgetSize.width}px`,
          height: `${chatWidgetSize.height}px`,
        } : undefined}
      >
        <header className="chat-header">
          <div className="chat-header-title">
            <div className="chat-header-logo-wrap">
              <img className="chat-header-logo" src={`${import.meta.env.BASE_URL}chatbot-logo.png`} alt="" aria-hidden="true" />
            </div>
            <div className="chat-header-name">
              <div className="chat-header-labels">
                <h1>{t("OKSBDC Assistant")}</h1>
                {isLiteMode && <span className="chat-lite-badge">{t('Lite mode')}</span>}
              </div>
              <VersionBadge className="chat-header-version" />
            </div>
          </div>
          <div className="chat-header-actions">
            {SHOW_EXPIRE_CONVERSATION_TEST_BUTTON && (
              <button
                type="button"
                className="chat-icon-btn chat-expire-test-btn"
                aria-label={t("Expire current conversation for testing")}
                title={t(conversationId ? 'Expire current conversation for testing' : 'Send a message before expiring a conversation')}
                disabled={!conversationId || Boolean(conversationExpiredNotice)}
                onClick={expireConversationForTesting}
              >
                <i className="fa-solid fa-hourglass-end" aria-hidden="true"></i>
              </button>
            )}
            <button
              type="button"
              ref={widgetMenuButtonRef}
              className="chat-icon-btn"
              aria-label={t("Open chat options")}
              aria-expanded={isWidgetMenuOpen}
              aria-haspopup="menu"
              onClick={() => setIsWidgetMenuOpen((open) => !open)}
            >
              <i className="fa-solid fa-gear"></i>
            </button>
            <button
              type="button"
              className="chat-icon-btn"
              aria-label={t("Close chat")}
              onClick={closeChat}
            >
              <i className="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>

            {isWidgetMenuOpen && (
              <WidgetMenu
                t={t}
                language={language}
                onLanguageChange={changeLanguage}
                fontSizes={FONT_SIZES}
                fontSize={fontSize}
                onCycleFontSize={cycleFontSize}
                onResetChat={resetChat}
                onToggleTheme={toggleTheme}
                setIsWidgetMenuOpen={setIsWidgetMenuOpen}
                theme={theme}
                widgetMenuRef={widgetMenuRef}
              />
            )}
          </div>
        </header>

        {!IS_EMBEDDED && !liveTestToken && (
          <button
            type="button"
            className="chat-resize-handle"
            aria-label={t("Resize chat window. Drag, or use arrow keys. Press Home to reset.")}
            title={t("Drag to resize chat window")}
            onPointerDown={startChatResize}
            onKeyDown={handleChatResizeKeyDown}
          />
        )}

        {!hasAgreedToDisclaimer && (
          <div className="disclaimer-overlay" role="dialog" aria-label={t("AI Disclaimer")}>
            <div className="disclaimer-box">
              <p className="disclaimer-title">{t("⚠ Before You Begin")}</p>
              <VersionBadge />
              <label className="disclaimer-language">
                <span>{t('Language')}</span>
                <select value={language} onChange={(event) => changeLanguage(event.target.value)}>
                  <option value="en" lang="en">English</option>
                  <option value="es" lang="es">Español</option>
                  <option value="fr" lang="fr">Français</option>
                </select>
              </label>
              <p className="disclaimer-body">
                {t("This chatbot is powered by artificial intelligence and is designed to assist with general questions about OKSBDC services.")}
              </p>
              <p className="disclaimer-body">
                {t("AI can sometimes provide incomplete or inaccurate information. Do not rely solely on this chatbot for legal, financial, or tax advice. Always verify important information with a qualified professional.")}
              </p>
              <p className="disclaimer-body">
                {t("Please do not share sensitive personal, financial, tax, legal, or confidential business information in this chat.")}
              </p>
              <button type="button" className="disclaimer-agree-btn" onClick={agreeToDisclaimer}>
                {t('I Understand & Agree')}
              </button>
            </div>
          </div>
        )}

        <div className="chat-messages" ref={messageListRef}>
          <div className="chat-notices">
            {isLiteMode && (
              <div className="chat-lite-notice" role="status" aria-live="polite">
                <strong>{t('Lite mode')}</strong>
                <span>{t('Only saved answers are available right now. Some questions may not be answered. Please try again later.')}</span>
              </div>
            )}
            {isPiiDisclaimerVisible && (
              <div className="chat-precaution" role="note" aria-live="polite">
                <span>
                  {t("Please do not share sensitive personal, financial, tax, legal, or confidential business information in this chat.")}
                </span>
                {ALLOW_PII_DISCLAIMER_DISMISS && (
                  <button
                    type="button"
                    className="chat-precaution-dismiss"
                    onClick={dismissPiiDisclaimer}
                    aria-label={t("Dismiss sensitive information notice")}
                  >
                    <span aria-hidden="true">&times;</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {messages.map((message, index) => {
            if (isSending && message.id && !message.content.trim()) return null

            if (message.role === 'assistant') {
              return (
                <div key={`assistant-stack-${index}`} className="assistant-message-stack">
                  <div className="message message-assistant">
                    <span className="sr-only">{t('Assistant:')} </span>
                    <div className="message-markdown">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ href, children }) => {
                            const isOksbdcLink = typeof href === 'string' && /oksbdc\.org/i.test(href)
                            const handleClick = isOksbdcLink ? () => {
                              let turnCounter = 0
                              for (let i = 0; i <= index; i++) {
                                if (messages[i]?.role === 'assistant') turnCounter++
                              }
                              logLinkClick(href, turnCounter || null)
                            } : undefined
                            return (
                              <a href={href} target="_blank" rel="noopener noreferrer" onClick={handleClick}>{children}</a>
                            )
                          },
                        }}
                      >
                        {normalizeAssistantMarkdown(
                          message.localText || (message.aiGenerated === false && isWidgetServiceMessage(message.content))
                            ? t(message.content)
                            : message.content,
                        )}
                      </ReactMarkdown>
                    </div>
                    {message.aiGenerated && (
                      <p className="message-ai-badge" aria-label={t("AI generated response label")}>
                        {t("AI generated response")}
                      </p>
                    )}
                  </div>
                  {index === messages.length - 1 && message.retryable && !isSending && !conversationExpiredNotice && (
                    <button
                      type="button"
                      className="message-retry"
                      onClick={(event) => sendMessage(event, true)}
                      aria-label={t("Retry last message")}
                    >
                      <i className="fa-solid fa-rotate-right" aria-hidden="true"></i>
                      {t("Retry")}
                    </button>
                  )}
                  {!message.failed && index === latestFeedbackAssistantIndex && index !== lastRatedAssistantIndex && !showFeedbackThanks && (
                    <div
                      className={`message-feedback ${isFeedbackClosing ? 'is-closing' : ''}`}
                      role="group"
                      aria-label={t("Rate this response")}
                    >
                      <span className="message-feedback-label">{t("Was this response helpful?")}</span>
                      <button
                        type="button"
                        aria-label={t("Helpful")}
                        className={chatFeedback === 'up' ? 'active' : ''}
                        onClick={() => submitChatFeedback('up', index)}
                      >
                        <i className="fa-regular fa-thumbs-up"></i>
                      </button>
                      <button
                        type="button"
                        aria-label={t("Not helpful")}
                        className={chatFeedback === 'down' ? 'active' : ''}
                        onClick={() => submitChatFeedback('down', index)}
                      >
                        <i className="fa-regular fa-thumbs-down"></i>
                      </button>
                    </div>
                  )}
                  {index === latestFeedbackAssistantIndex && showFeedbackThanks && (
                    <p className="chat-feedback-thanks" role="status" aria-live="polite">
                      {t("Thanks for your feedback.")}
                    </p>
                  )}
                </div>
              )
            }

            return (
              <div
                key={`${message.role}-${index}`}
                className={`message message-${message.role}`}
              >
                <span className="sr-only">{t('You:')} </span>
                {message.content}
              </div>
            )
          })}
          {conversationExpiredNotice && (
            <div className="conversation-expired-card" role="status" aria-live="assertive">
              <div className="conversation-expired-icon" aria-hidden="true">⏳</div>
              <div className="conversation-expired-copy">
                <p className="conversation-expired-eyebrow">{t("Session closed")}</p>
                <h2>{t(conversationExpiredNotice.title)}</h2>
                <p>{t(conversationExpiredNotice.detail)}</p>
              </div>
              <button type="button" className="conversation-expired-start-btn" onClick={startNewChatFromExpiredNotice}>
                {t("Start a new chat")}
              </button>
            </div>
          )}
          {idleWarningVisible && !conversationExpiredNotice && (
            <div className="conversation-idle-warning-card" role="status" aria-live="polite">
              <div className="conversation-idle-warning-icon" aria-hidden="true">
                <i className="fa-solid fa-hourglass-half"></i>
              </div>
              <div className="conversation-idle-warning-copy">
                <p className="conversation-idle-warning-eyebrow">{t("Session warning")}</p>
                <h2>{t("Your session is about to expire.")}</h2>
                <p>{t("This chat will close after 10 minutes without a new message.")}</p>
              </div>
              <button type="button" className="conversation-idle-warning-btn" onClick={restartIdleTimer}>
                {t("Restart timer")}
              </button>
            </div>
          )}
          {isWaitingForResponse && (
            <div className="thinking-indicator-row">
              <div className="message message-assistant message-thinking" role="status" aria-live="polite" aria-label={t(slowResponseMessage || 'Assistant is thinking')}>
                <span className="thinking-dot" aria-hidden="true" />
                <span className="thinking-dot" aria-hidden="true" />
                <span className="thinking-dot" aria-hidden="true" />
              </div>
              {slowResponseMessage && (
                <span className="thinking-delay-message">{t(slowResponseMessage)}</span>
              )}
            </div>
          )}
        </div>

        <ChatInput
          t={t}
          canInteractWithChat={canInteractWithChat}
          conversationExpiredNotice={conversationExpiredNotice}
          input={input}
          isSending={isSending}
          maxMessageLength={MAX_MESSAGE_LENGTH}
          onInputChange={setInput}
          onSubmit={sendMessage}
          onTextareaKeyDown={handleTextareaKeyDown}
          textareaRef={textareaRef}
        />

      </section>

      {liveTestToken && testControlsTarget && createPortal(
        <div className="live-chat-test-simulation">
          <label htmlFor="simulation-wait-seconds">Response delay (seconds)</label>
          <input
            id="simulation-wait-seconds"
            type="number"
            min="0"
            max="2147483"
            step="any"
            value={simulationWaitSeconds}
            onChange={(event) => setSimulationWaitSeconds(event.target.value)}
            disabled={isSending}
          />
          <button
            type="button"
            disabled={isSending || !canInteractWithChat || Boolean(conversationExpiredNotice) || simulationWaitSeconds.trim() === '' || !Number.isFinite(Number(simulationWaitSeconds)) || Number(simulationWaitSeconds) < 0 || Number(simulationWaitSeconds) > 2147483}
            onClick={(event) => sendMessage(event, false, Number(simulationWaitSeconds) * 1000)}
          >Simulate delayed response</button>
          <small>Uses your message or a sample message. Simulates waiting locally without calling the AI service.</small>
        </div>,
        testControlsTarget,
      )}

      {!isOpen && hasManuallyClosedChat && hasSentUserMessage && !showClosedFeedbackThanks && !hideClosedFeedbackUntilNextClose && (
        <div className="chat-feedback-wrap">
          <div className="chat-feedback" role="group" aria-label={t("Rate this chat session")}>
            <span>{t("How was this chat?")}</span>
            <button
              type="button"
              aria-label={t("Happy")}
              className={closedChatFeedback === 'happy' ? 'active' : ''}
              onClick={() => submitClosedChatFeedback('happy')}
            >
              <img
                src={`${import.meta.env.BASE_URL}positive_feedback_face.png`}
                alt=""
                aria-hidden="true"
                className="closed-feedback-icon"
              />
            </button>
            <button
              type="button"
              aria-label={t("Neutral")}
              className={closedChatFeedback === 'neutral' ? 'active' : ''}
              onClick={() => submitClosedChatFeedback('neutral')}
            >
              <img
                src={`${import.meta.env.BASE_URL}neutral_feedback_face.png`}
                alt=""
                aria-hidden="true"
                className="closed-feedback-icon"
              />
            </button>
            <button
              type="button"
              aria-label={t("Sad")}
              className={closedChatFeedback === 'sad' ? 'active' : ''}
              onClick={() => submitClosedChatFeedback('sad')}
            >
              <img
                src={`${import.meta.env.BASE_URL}negative_feedback_face.png`}
                alt=""
                aria-hidden="true"
                className="closed-feedback-icon"
              />
            </button>
            <button
              type="button"
              className={`chat-feedback-write-btn ${closedChatFeedback === 'written' ? 'active' : ''}`}
              onClick={() => {
                setIsWrittenFeedbackOpen((current) => !current)
                setWrittenFeedbackError('')
              }}
            >
              {t("Write Feedback")}
            </button>
            <button
              type="button"
              aria-label={t("Dismiss feedback")}
              className="chat-feedback-dismiss"
              onClick={() => setHideClosedFeedbackUntilNextClose(true)}
            >
              <i className="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          </div>

          {isWrittenFeedbackOpen && (
            <form className="chat-written-feedback" onSubmit={submitWrittenChatFeedback}>
              <label htmlFor="chatWrittenFeedback">{t("Share your feedback")}</label>
              <textarea
                id="chatWrittenFeedback"
                value={writtenFeedbackText}
                onChange={(event) => {
                  setWrittenFeedbackText(event.target.value)
                  if (writtenFeedbackError) {
                    setWrittenFeedbackError('')
                  }
                }}
                rows={3}
                maxLength={1000}
                placeholder={t("Tell us what worked or what needs improvement...")}
              />
              <div className="chat-written-feedback-actions">
                <button type="submit">{t("Send Feedback")}</button>
                <button
                  type="button"
                  onClick={() => {
                    setIsWrittenFeedbackOpen(false)
                    setWrittenFeedbackError('')
                  }}
                >
                  {t("Cancel")}
                </button>
              </div>
              <p className="chat-written-feedback-counter" aria-live="polite">
                {writtenFeedbackText.length}/1000
              </p>
              {writtenFeedbackError && (
                <p className="chat-written-feedback-error" role="alert">
                  {t(writtenFeedbackError)}
                </p>
              )}
            </form>
          )}
        </div>
      )}

      {!isOpen && hasManuallyClosedChat && hasSentUserMessage && showClosedFeedbackThanks && (
        <p className="chat-feedback-thanks chat-feedback-thanks-card" role="status" aria-live="polite">
          {t("Thanks for your feedback.")}
        </p>
      )}

      {!isOpen && !hasOpenedWidget && (
        <button type="button" className="chat-launcher-prompt" onClick={openWidget} aria-label={t("Open chat")}>
          {t("Click me!")}
        </button>
      )}

      {!isOpen && (
        <button
          type="button"
          className="chat-bubble"
          aria-label={t("Open chat")}
          onClick={openWidget}
        >
          <img className="chat-bubble-logo" src={`${import.meta.env.BASE_URL}chatbot-logo.png`} alt="" aria-hidden="true" />
          <VersionBadge className="chat-launcher-version" />
        </button>
      )}
    </main>
  )
}

export default ChatWidget
