import { useEffect, useRef, useState } from 'react'

export function useChatFeedback({ apiBaseUrl, buildApiUrl, conversationId, messages, liveTestToken = '' }) {
  const [chatFeedback, setChatFeedback] = useState(null)
  const [isFeedbackClosing, setIsFeedbackClosing] = useState(false)
  const [showFeedbackThanks, setShowFeedbackThanks] = useState(false)
  const [lastRatedAssistantIndex, setLastRatedAssistantIndex] = useState(-1)
  const [closedChatFeedback, setClosedChatFeedback] = useState(null)
  const [showClosedFeedbackThanks, setShowClosedFeedbackThanks] = useState(false)
  const [hideClosedFeedbackUntilNextClose, setHideClosedFeedbackUntilNextClose] = useState(false)
  const [isWrittenFeedbackOpen, setIsWrittenFeedbackOpen] = useState(false)
  const [writtenFeedbackText, setWrittenFeedbackText] = useState('')
  const [writtenFeedbackError, setWrittenFeedbackError] = useState('')
  const feedbackTimeoutRef = useRef(null)

  useEffect(() => () => {
    if (feedbackTimeoutRef.current) {
      window.clearTimeout(feedbackTimeoutRef.current)
    }
  }, [])

  const buildFeedbackUrl = () => {
    const feedbackUrl = new URL(buildApiUrl(apiBaseUrl, '/api/feedback'), window.location.origin)
    const testMode = new URLSearchParams(window.location.search).get('test_mode')
    if (testMode === '1') {
      feedbackUrl.searchParams.set('test_mode', '1')
    }
    return feedbackUrl
  }

  const resetFeedbackState = () => {
    setChatFeedback(null)
    setIsFeedbackClosing(false)
    setShowFeedbackThanks(false)
    setClosedChatFeedback(null)
    setShowClosedFeedbackThanks(false)
    setHideClosedFeedbackUntilNextClose(false)
    setIsWrittenFeedbackOpen(false)
    setWrittenFeedbackText('')
    setWrittenFeedbackError('')
    setLastRatedAssistantIndex(-1)
    if (feedbackTimeoutRef.current) {
      window.clearTimeout(feedbackTimeoutRef.current)
      feedbackTimeoutRef.current = null
    }
  }

  const submitChatFeedback = (value, assistantIndex) => {
    if (isFeedbackClosing || showFeedbackThanks) return

    const assistantTurn = (() => {
      if (!Number.isInteger(assistantIndex) || assistantIndex < 1) return null

      let turnCounter = 0
      for (let index = 1; index <= assistantIndex; index += 1) {
        if (messages[index]?.role === 'assistant') {
          turnCounter += 1
        }
      }

      return turnCounter > 0 ? turnCounter : null
    })()

    void fetch(buildFeedbackUrl().toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(liveTestToken ? { 'X-Live-Chat-Test': liveTestToken } : {}),
      },
      body: JSON.stringify({
        scope: 'response',
        feedback: value,
        conversationId,
        turn: assistantTurn,
        assistantIndex,
      }),
    }).catch(() => {
      // Keep feedback UX responsive even if telemetry logging fails.
    })

    setChatFeedback(value)
    setIsFeedbackClosing(true)
    setLastRatedAssistantIndex(assistantIndex)

    feedbackTimeoutRef.current = window.setTimeout(() => {
      setShowFeedbackThanks(true)
      setIsFeedbackClosing(false)
      feedbackTimeoutRef.current = null
    }, 0)
  }

  const submitClosedChatFeedback = (value) => {
    if (showClosedFeedbackThanks) return

    void fetch(buildFeedbackUrl().toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(liveTestToken ? { 'X-Live-Chat-Test': liveTestToken } : {}),
      },
      body: JSON.stringify({
        scope: 'session',
        feedback: value,
        conversationId,
      }),
    }).catch(() => {
      // Keep feedback UX responsive even if telemetry logging fails.
    })

    setClosedChatFeedback(value)
    setShowClosedFeedbackThanks(true)
  }

  const submitWrittenChatFeedback = async (event) => {
    event.preventDefault()
    if (showClosedFeedbackThanks) return

    const trimmed = writtenFeedbackText.trim()
    if (!trimmed) {
      setWrittenFeedbackError('Please enter feedback before submitting.')
      return
    }

    if (trimmed.length > 1000) {
      setWrittenFeedbackError('Please keep feedback to 1000 characters or fewer.')
      return
    }

    setWrittenFeedbackError('')

    try {
      const response = await fetch(buildFeedbackUrl().toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        ...(liveTestToken ? { 'X-Live-Chat-Test': liveTestToken } : {}),
        },
        body: JSON.stringify({
          scope: 'session',
          feedback: 'written',
          comment: trimmed,
          conversationId,
        }),
      })

      if (!response.ok) {
        let errorMessage = 'Could not submit written feedback. Please try again.'
        try {
          const data = await response.json()
          if (typeof data?.error === 'string' && data.error.trim()) {
            errorMessage = data.error
          }
        } catch {
          // Keep generic message when response body is not JSON.
        }
        setWrittenFeedbackError(errorMessage)
        return
      }
    } catch {
      setWrittenFeedbackError('Could not submit written feedback. Please try again.')
      return
    }

    setClosedChatFeedback('written')
    setIsWrittenFeedbackOpen(false)
    setWrittenFeedbackText('')
  }

  return {
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
  }
}
