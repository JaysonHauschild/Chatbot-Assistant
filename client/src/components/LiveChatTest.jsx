import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import ChatWidget from '../ChatWidget.jsx'
import './LiveChatTest.css'

export default function LiveChatTest({ apiBaseUrl, buildApiUrl, authToken, theme, toggleTheme }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expired, setExpired] = useState(false)
  const [liteMode, setLiteMode] = useState(false)
  const [testControlsTarget, setTestControlsTarget] = useState(null)
  const dialogRef = useRef(null)
  const buttonRef = useRef(null)

  useEffect(() => {
    if (!session) return
    dialogRef.current.showModal()
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, Date.parse(session.expiresAt) - Date.now()))
    return () => window.clearTimeout(timer)
  }, [session])

  const start = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, '/api/dashboard/live-chat-test'), {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to start a live test.')
      if (!data.token || !Number.isFinite(Date.parse(data.expiresAt))) throw new Error('Unable to start a live test.')
      setExpired(false)
      setLiteMode(false)
      setSession(data)
    } catch (failure) {
      setError(failure.message || 'Unable to start a live test.')
    } finally {
      setLoading(false)
    }
  }

  const close = () => {
    dialogRef.current?.close()
    setSession(null)
    buttonRef.current?.focus()
  }

  return <>
    <button ref={buttonRef} type="button" className="dashboard-attention-btn" onClick={start} disabled={loading}>
      {loading ? 'Starting test…' : 'Test live chatbot'}
    </button>
    {error && <span role="alert">{error}</span>}
    {session && createPortal(<dialog ref={dialogRef} className="live-chat-test" aria-labelledby="live-chat-test-title" onCancel={close}>
      <div className="live-chat-test-heading">
        <h2 id="live-chat-test-title">Test live chatbot</h2>
        <button type="button" className="live-chat-test-close" onClick={close}>Close test</button>
      </div>
      <p className="live-chat-test-intro">Uses current saved settings. Test conversations and feedback are not saved.</p>
      <details className="live-chat-test-details">
        <summary>Session details</summary>
        <p>Sessions last 30 minutes. Minimal failure diagnostics are retained. Normal usage limits apply. Close this window when finished.</p>
      </details>
      {expired ? <p role="status">This test session has expired. Close it and start a new test.</p> : <>
        <div className="live-chat-test-workspace">
          <ChatWidget apiBaseUrl={apiBaseUrl} buildApiUrl={buildApiUrl} theme={theme} toggleTheme={toggleTheme} liveTestToken={session.token} liveTestLiteMode={liteMode} testControlsTarget={testControlsTarget} />
          <aside className="live-chat-test-controls" aria-label="Test controls">
            <h3>Test controls</h3>
            <label className="live-chat-test-lite-toggle">
              <input type="checkbox" checked={liteMode} onChange={(event) => setLiteMode(event.target.checked)} />
              Enable lite mode for this test (saved responses only)
            </label>
            <div ref={setTestControlsTarget} />
          </aside>
        </div>
      </>}
    </dialog>, document.body)}
  </>
}
