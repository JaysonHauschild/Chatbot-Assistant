import UnsavedChangesIndicator from './UnsavedChangesIndicator.jsx'
import { useUnsavedForm } from '../hooks/useUnsavedForm.js'
import DashboardHelp from './DashboardHelp.jsx'
import { useRef, useState } from 'react'

import { reviewLabels } from '../utils/conversationReview.js'
const defaultReview = { status: 'to_review', version: 0, updates: [] }

export default function ConversationReview({ conversationId, review = defaultReview, apiBaseUrl, buildApiUrl, authToken, onUnauthorized, onSaved, disabled, readOnly = false }) {
  const [current, setCurrent] = useState(review)
  const [status, setStatus] = useState(review.status)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const pending = useRef(false)
  const dirty = !readOnly && (status !== current.status || Boolean(note.trim()))
  const formRef = useUnsavedForm('conversation-review', 'Conversation review', dirty)
  // Refreshes can bring in another staff member's changes without clearing a draft note.
  if (review.version !== current.version) {
    setCurrent(review)
    setStatus(review.status)
  }

  async function save(event) {
    event.preventDefault()
    if (readOnly || pending.current) return
    pending.current = true
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, '/api/dashboard/conversations/review'), {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, status, note, expectedVersion: current.version }),
      })
      if (response.status === 401) { onUnauthorized(); return }
      const data = await response.json()
      if (response.status === 409 && data.review) {
        onSaved(data.review)
        throw new Error(data.error)
      }
      if (!response.ok) throw new Error(data.error || 'Unable to save the review. Please try again.')
      onSaved(data.review)
      setNote('')
      setMessage('Review saved.')
    } catch (failure) { setError(failure.message) }
    finally { pending.current = false; setSaving(false) }
  }

  return <section className="conversation-review-tracking" aria-label="Review tracking">
    <h4 aria-label="Review tracking">Review tracking<DashboardHelp label="About review tracking">Track your team’s progress here. Internal notes are only for dashboard staff and are not sent to visitors or the chatbot. Resolving a review keeps the conversation in its current location.</DashboardHelp></h4>

    {readOnly ? <p className="history-meta">{reviewLabels[current.status]}</p> : <form ref={formRef} onSubmit={save}>
      <UnsavedChangesIndicator dirty={dirty} />
      <label>Review progress<select aria-label="Review progress" value={status} onChange={(event) => { setStatus(event.target.value); setMessage('') }} disabled={disabled || saving}>
        {Object.entries(reviewLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Add an internal note<textarea rows={3} maxLength={4000} value={note} onChange={(event) => { setNote(event.target.value); setMessage('') }} placeholder="What did you find? What should happen next?" disabled={disabled || saving} /></label>
      <button type="submit" className="conversation-search-button" disabled={disabled || saving || (status === current.status && !note.trim())}>{saving ? 'Saving review…' : 'Save review'}</button>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </form>}
    {current.updates.length > 0 && <>
      <h5>Review history</h5>
      <ol className="conversation-review-updates">
        {[...current.updates].reverse().map((update, index) => <li key={`${current.version - index}`}>
          <strong>{reviewLabels[update.status]}</strong>
          <p className="history-meta">{update.updatedBy} · {new Date(update.updatedAt).toLocaleString()}</p>
          {update.note && <p className="conversation-review-note">{update.note}</p>}
        </li>)}
      </ol>
    </>}
  </section>
}
