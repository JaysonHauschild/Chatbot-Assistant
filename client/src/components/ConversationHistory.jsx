import { useUnsavedChanges } from '../hooks/useUnsavedForm.js'
import DashboardHelp from './DashboardHelp.jsx'
import { useEffect, useRef, useState } from 'react'
import { dashboardTerm } from '../utils/dashboardLanguage.js'
import ConversationGraph from './ConversationGraph.jsx'
import ConversationReview from './ConversationReview.jsx'
import { reviewLabels } from '../utils/conversationReview.js'
import './ConversationHistory.css'

const emptyFilters = () => ({ dateFrom: '', dateTo: '', topic: '', rating: '', blocked: '', page: '', reviewStatus: '', quality: '' })
const formatTime = (value) => value ? new Date(value).toLocaleString() : 'Time unavailable'

function ConversationItem({ item, selectedId, onSelect, archiving }) {
  return <li>
    <button type="button" disabled={archiving} aria-pressed={item.conversationId === selectedId} onClick={() => onSelect(item.conversationId)}>
      <strong>{item.preview}</strong>
      <span className="history-conversation-id">{item.conversationId}</span>
      <span>{formatTime(item.updatedAt)}</span>
      {item.archived && <span>Archived conversation</span>}
      <span>Review: {reviewLabels[item.reviewStatus || 'to_review']}</span>
      <span>{item.messageCount} messages · {item.responseCount} replies · {item.feedbackCount} feedback</span>
      {item.ratings?.length > 0 && <span>Ratings: {item.ratings.map(dashboardTerm).join(', ')}</span>}
      {(item.topics?.length > 0 || item.hasBlockedMessages) && <span>{(item.topics || []).slice(0, 2).map(dashboardTerm).join(' · ')}{item.hasBlockedMessages ? `${item.topics?.length ? ' · ' : ''}Includes blocked messages` : ''}</span>}
    </button>
  </li>
}

export default function ConversationHistory({ apiBaseUrl, buildApiUrl, authToken, onUnauthorized, initialFilters, readOnly = false }) {
  const { confirmNavigation } = useUnsavedChanges()
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState(() => ({ ...emptyFilters(), ...initialFilters }))
  const [appliedFilters, setAppliedFilters] = useState(() => ({ ...emptyFilters(), ...initialFilters }))
  const [searchError, setSearchError] = useState('')
  const [offset, setOffset] = useState(0)
  const [revision, setRevision] = useState(0)
  const [reviewRevision, setReviewRevision] = useState(0)
  const [showArchived, setShowArchived] = useState(false)
  const [groupByVisit, setGroupByVisit] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(Boolean(initialFilters?.quality))
  const [list, setList] = useState({ conversations: [], total: 0, limit: 25 })
  const [selectedId, setSelectedId] = useState('')
  const [history, setHistory] = useState(null)
  const [listStatus, setListStatus] = useState('loading')
  const [historyStatus, setHistoryStatus] = useState('idle')
  const [historyRevision, setHistoryRevision] = useState(0)
  const [translationResult, setTranslationResult] = useState(null)
  const [translationRevision, setTranslationRevision] = useState(0)
  const [listError, setListError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const [archiveMessage, setArchiveMessage] = useState('')
  const archivePending = useRef(false)
  const translationKey = JSON.stringify([selectedId, historyRevision, revision, showArchived, includeArchived, translationRevision, apiBaseUrl, authToken])
  const translationStatus = historyStatus !== 'ready' || !selectedId ? 'idle'
    : translationResult?.key === translationKey ? translationResult.status : 'loading'

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ q: query, offset: String(offset), archived: includeArchived ? 'all' : String(showArchived) })
    if (groupByVisit) params.set('groupBy', 'visit')
    Object.entries(appliedFilters).forEach(([key, value]) => { if (value) params.set(key, value) })
    fetch(buildApiUrl(apiBaseUrl, `/api/dashboard/conversations?${params}`), {
      headers: { Authorization: `Bearer ${authToken}` }, signal: controller.signal,
    }).then(async (response) => {
      if (response.status === 401) { onUnauthorized(); return }
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load conversations.')
      if (controller.signal.aborted) return
      if (offset > 0 && offset >= data.total) {
        setOffset(Math.max(0, Math.floor((data.total - 1) / data.limit) * data.limit))
        return
      }
      setList(data)
      setListStatus('ready')
    }).catch((error) => {
      if (controller.signal.aborted) return
      setListError(error.message)
      setListStatus('error')
    })
    return () => controller.abort()
  }, [apiBaseUrl, buildApiUrl, authToken, onUnauthorized, query, appliedFilters, offset, revision, reviewRevision, showArchived, includeArchived, groupByVisit])

  useEffect(() => {
    if (!selectedId) return
    const controller = new AbortController()
    const params = new URLSearchParams({ conversationId: selectedId, archived: includeArchived ? 'all' : String(showArchived) })
    fetch(buildApiUrl(apiBaseUrl, `/api/dashboard/conversations?${params}`), {
      headers: { Authorization: `Bearer ${authToken}` }, signal: controller.signal,
    }).then(async (response) => {
      if (response.status === 401) { onUnauthorized(); return }
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load history.')
      if (controller.signal.aborted) return
      setHistory(data)
      setHistoryRevision((value) => value + 1)
      setHistoryStatus('ready')
    }).catch((error) => {
      if (controller.signal.aborted) return
      setHistoryError(error.message)
      setHistoryStatus('error')
    })
    return () => controller.abort()
  }, [apiBaseUrl, buildApiUrl, authToken, onUnauthorized, selectedId, revision, showArchived, includeArchived])

  useEffect(() => {
    if (historyStatus !== 'ready' || !selectedId) return
    const controller = new AbortController()
    const params = new URLSearchParams({ conversationId: selectedId, archived: includeArchived ? 'all' : String(showArchived), translate: 'true' })
    fetch(buildApiUrl(apiBaseUrl, `/api/dashboard/conversations?${params}`), {
      headers: { Authorization: `Bearer ${authToken}` }, signal: controller.signal,
    }).then(async (response) => {
      if (response.status === 401) { onUnauthorized(); return }
      const data = await response.json()
      if (!response.ok) throw new Error('Unable to translate messages.')
      if (controller.signal.aborted) return
      setHistory((current) => current?.conversationId === selectedId ? { ...current, events: data.events } : current)
      setTranslationResult({ key: translationKey, status: data.translationStatus === 'complete' ? 'complete' : 'unavailable' })
    }).catch(() => {
      if (!controller.signal.aborted) setTranslationResult({ key: translationKey, status: 'unavailable' })
    })
    return () => controller.abort()
  }, [apiBaseUrl, buildApiUrl, authToken, onUnauthorized, selectedId, historyStatus, revision, showArchived, includeArchived, translationRevision, translationKey])

  function selectConversation(id) {
    if (id === selectedId || !confirmNavigation(null, { only: 'conversation-review' })) return
    setSelectedId(id)
    setHistory(null)
    setHistoryStatus('loading')
    setArchiveError('')
    setArchiveMessage('')
  }

  async function changeSelectedArchiveStatus() {
    if (readOnly || !selectedId || archivePending.current) return
    if (!confirmNavigation(null, { only: 'conversation-review' })) return
    archivePending.current = true
    setArchiving(true)
    setArchiveError('')
    setArchiveMessage('')
    const restoring = history?.archived ?? showArchived
    const action = restoring ? 'restore' : 'archive'
    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, `/api/dashboard/conversations/${action}`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: selectedId }),
      })
      if (response.status === 401) { onUnauthorized(); return }
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || `Unable to ${action} conversation.`)
      setSelectedId('')
      setHistory(null)
      setHistoryStatus('idle')
      setArchiveMessage(restoring ? 'Conversation restored. It is available in Conversation History.' : 'Conversation archived. Its chat history is saved.')
      setListStatus('loading')
      setRevision((value) => value + 1)
    } catch (error) {
      setArchiveError(error.message || `Unable to ${action} conversation.`)
    } finally {
      archivePending.current = false
      setArchiving(false)
    }
  }

  function refresh() {
    if (!confirmNavigation(null, { only: 'conversation-review' })) return
    setListStatus('loading')
    if (selectedId) setHistoryStatus('loading')
    setRevision((value) => value + 1)
  }

  function toggleArchiveView() {
    if (!confirmNavigation(null, { only: 'conversation-review' })) return
    setIncludeArchived(false)
    setShowArchived((value) => !value)
    setOffset(0)
    setSearch('')
    setQuery('')
    setFilters(emptyFilters())
    setAppliedFilters(emptyFilters())
    setSearchError('')
    setSelectedId('')
    setHistory(null)
    setHistoryStatus('idle')
    setListStatus('loading')
    setArchiveError('')
    setArchiveMessage('')
  }

  function applySearch(event) {
    event.preventDefault()
    if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
      setSearchError('The end date must be on or after the start date.')
      return
    }
    if (!confirmNavigation(null, { only: 'conversation-review' })) return
    setSearchError('')
    setQuery(search.trim())
    setAppliedFilters({ ...filters })
    resetSearchResults()
  }

  function resetSearchResults() {
    setOffset(0)
    setSelectedId('')
    setHistory(null)
    setHistoryStatus('idle')
    setListStatus('loading')
    setListError('')
    setArchiveError('')
    setArchiveMessage('')
    setRevision((value) => value + 1)
  }

  function clearSearch() {
    if (!confirmNavigation(null, { only: 'conversation-review' })) return
    setSearch('')
    setQuery('')
    setFilters(emptyFilters())
    setAppliedFilters(emptyFilters())
    setSearchError('')
    resetSearchResults()
  }

  const topicOptions = [...new Set([...(list.filterOptions?.topics || []), filters.topic, appliedFilters.topic].filter(Boolean))]
  const visibleItems = groupByVisit ? (list.visits || []) : (list.conversations || [])
  const hasSearch = Boolean(query || Object.values(appliedFilters).some(Boolean))

  return (
    <section className="conversation-review" aria-labelledby="conversation-review-title">
      <div className="dashboard-blocked-header">
        <h2 id="conversation-review-title">{showArchived ? 'Archived Conversations' : 'Conversation History'}</h2>
        <div className="history-header-actions">
        <button type="button" className="flow-archive-button" onClick={toggleArchiveView} disabled={archiving} aria-pressed={showArchived}>
          <i className={`fa-solid ${showArchived ? 'fa-arrow-left' : 'fa-box-archive'}`} aria-hidden="true" />
          {showArchived ? 'Back to conversation history' : 'View archived conversations'}
        </button>
        <button type="button" className="history-icon-button" onClick={refresh} title="Refresh conversations" aria-label="Refresh conversations" disabled={listStatus === 'loading' || archiving}>
          <i className="fa-solid fa-rotate-right" aria-hidden="true" />
        </button>
        </div>
      </div>
      {!showArchived && <label className="history-meta"><input type="checkbox" checked={includeArchived} disabled={archiving} onChange={(event) => {
        if (!confirmNavigation(null, { only: 'conversation-review' })) return
        setIncludeArchived(event.target.checked)
        resetSearchResults()
      }} /> Include archived conversations</label>}
      <div className="history-group-toggle"><label><input type="checkbox" checked={groupByVisit} disabled={archiving} onChange={(event) => {
        if (!confirmNavigation(null, { only: 'conversation-review' })) return
        setGroupByVisit(event.target.checked)
        resetSearchResults()
      }} /> Group conversations by visit</label><DashboardHelp label="About grouping conversations by visit">A recorded visit can contain several chats, including chats started with Reset Chat. Expand a visit to open its conversations. Filters apply to conversations inside each group; only matching conversations appear. Conversations without reliable visit details stay separate. A visit is recorded browser activity, not a unique person.</DashboardHelp></div>
      {showArchived && <p className="history-meta">Browse archived conversations and restore them to Conversation History.</p>}
      {archiveMessage && <p role="status">{archiveMessage}</p>}
      <form className="conversation-search" onSubmit={applySearch} aria-label="Search conversations" aria-describedby="conversation-search-help">
        <div className="conversation-search-main">
          <input aria-label="Search conversation reference or message text" placeholder="Search messages or conversation reference" value={search} maxLength={500} onChange={(event) => setSearch(event.target.value)} disabled={archiving} />
          <button type="submit" className="conversation-search-button" disabled={archiving}><i className="fa-solid fa-magnifying-glass" aria-hidden="true" /> Search conversations</button>
          <button type="button" className="conversation-search-button" onClick={clearSearch} disabled={archiving}>Clear search</button>
        </div>
        <div className="conversation-search-filters">
          <label>From date<input type="date" value={filters.dateFrom} disabled={archiving} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} /></label>
          <label>Through date<input type="date" value={filters.dateTo} min={filters.dateFrom || undefined} disabled={archiving} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} /></label>
          <label>Question topic<select aria-label="Question topic" value={filters.topic} disabled={archiving} onChange={(event) => setFilters({ ...filters, topic: event.target.value })}>
            <option value="">All topics</option>{topicOptions.map((topic) => <option key={topic} value={topic}>{dashboardTerm(topic)}</option>)}
          </select></label>
          <label>Visitor rating<select aria-label="Visitor rating" value={filters.rating} disabled={archiving} onChange={(event) => setFilters({ ...filters, rating: event.target.value })}>
            {[['', 'All ratings'], ['negative', 'Negative ratings'], ['positive', 'Positive ratings'], ['unrated', 'No ratings'], ['down', 'Thumbs down'], ['up', 'Thumbs up'], ['sad', 'Sad'], ['neutral', 'Neutral'], ['happy', 'Happy']].map(([value, title]) => <option key={value} value={value}>{title}</option>)}
          </select></label>
          <label>Answer quality<select aria-label="Answer quality" value={filters.quality} disabled={archiving} onChange={(event) => setFilters({ ...filters, quality: event.target.value })}>
            <option value="">All answers</option><option value="help">Questions needing help</option><option value="negative_reply">Negative reply ratings</option><option value="negative_chat">Negative chat ratings</option>
          </select></label>
          <label>Blocked messages<select aria-label="Blocked messages" value={filters.blocked} disabled={archiving} onChange={(event) => setFilters({ ...filters, blocked: event.target.value })}>
            <option value="">All conversations</option><option value="yes">Includes blocked messages</option><option value="no">No blocked messages</option>
          </select></label>
          <label>Website page contains<input value={filters.page} maxLength={500} list="conversation-page-options" placeholder="Website address or page name" disabled={archiving} onChange={(event) => setFilters({ ...filters, page: event.target.value })} /></label>
          <label>Review status<select aria-label="Review status" value={filters.reviewStatus} disabled={archiving} onChange={(event) => setFilters({ ...filters, reviewStatus: event.target.value })}>
            <option value="">All review statuses</option><option value="unfinished">Unfinished reviews</option>
            {Object.entries(reviewLabels).map(([value, title]) => <option key={value} value={value}>{title}</option>)}
          </select></label>
          <datalist id="conversation-page-options">{(list.filterOptions?.pages || []).map((page) => <option key={page} value={page} />)}</datalist>
        </div>
        <DashboardHelp id="conversation-search-help" label="About searching conversations">Choose any combination, then select Search conversations. Dates include any saved message or feedback on those days, in Coordinated Universal Time (UTC). Topics, ratings, and blocked messages can match anywhere in a conversation. Ratings use the latest recorded choice. Answer quality uses the analytics rules, excludes test chats, and counts ratings with the original question dates. Website search ignores address details after ? or #.</DashboardHelp>
        {searchError && <p role="alert">{searchError}</p>}
      </form>
      <div className="conversation-workspace">
        <div className="conversation-browser">

          {listStatus === 'loading' && <p role="status">Loading conversations...</p>}
          {listStatus === 'error' && <p role="alert">{listError}</p>}
          {listStatus === 'ready' && <>
            {groupByVisit ? <p className="history-meta">{list.total} visit {list.total === 1 ? 'group' : 'groups'} · {list.conversationTotal || 0} {hasSearch ? 'matching ' : ''}conversations</p> : <p className="history-meta">{list.total} {showArchived ? 'archived' : includeArchived ? 'saved' : 'active'} {list.total === 1 ? 'conversation' : 'conversations'}{hasSearch ? ' matching your search' : ''}</p>}
            {groupByVisit && list.unlinkedConversationCount > 0 && <p className="history-meta">{list.unlinkedConversationCount} {list.unlinkedConversationCount === 1 ? 'conversation has' : 'conversations have'} no reliable visit details. Each appears separately.</p>}
            {groupByVisit ? <ul className="conversation-visit-list" aria-label="Visits">
              {(list.visits || []).map((visit) => <li key={visit.id}>
                <details className="conversation-visit">
                  <summary>
                    <strong>{visit.visitReference ? `Visit ${visit.visitReference.slice(0, 8)}` : 'Visit details unavailable'}</strong>
                    <span>{visit.conversationCount} {hasSearch ? 'matching ' : ''}{visit.conversationCount === 1 ? 'conversation' : 'conversations'} · {visit.messageCount} messages</span>
                    <span>{formatTime(visit.startedAt)} – {formatTime(visit.updatedAt)}</span>
                    {!visit.visitReference && <span>{visit.conversations[0]?.conversationId}</span>}
                  </summary>
                  <ul className="conversation-list" aria-label={`Conversations in ${visit.visitReference ? `visit ${visit.visitReference.slice(0, 8)}` : visit.conversations[0]?.conversationId}`}>
                    {visit.conversations.map((item) => <ConversationItem key={item.conversationId} item={item}
                      selectedId={selectedId} onSelect={selectConversation} archiving={archiving} />)}
                  </ul>
                </details>
              </li>)}
            </ul> : <ul className="conversation-list" aria-label="Conversations">
              {(list.conversations || []).map((item) => <ConversationItem key={item.conversationId} item={item}
                selectedId={selectedId} onSelect={selectConversation} archiving={archiving} />)}
            </ul>}
            {!visibleItems.length && <p>{showArchived ? 'No archived conversations found.' : 'No conversations found.'}</p>}
            {!visibleItems.length && hasSearch && <p className="history-meta">Try fewer filters or choose Clear search.</p>}
            <div className="conversation-pagination">
              <button type="button" className="history-icon-button" title="Previous page" aria-label="Previous page" disabled={!offset} onClick={() => { setListStatus('loading'); setOffset(Math.max(0, offset - list.limit)) }}><i className="fa-solid fa-chevron-left" aria-hidden="true" /></button>
              <span>{list.total ? `${offset + 1}-${Math.min(offset + list.limit, list.total)} of ${list.total}` : '0 results'}{groupByVisit && list.total ? ' visit groups' : ''}</span>
              <button type="button" className="history-icon-button" title="Next page" aria-label="Next page" disabled={offset + list.limit >= list.total} onClick={() => { setListStatus('loading'); setOffset(offset + list.limit) }}><i className="fa-solid fa-chevron-right" aria-hidden="true" /></button>
            </div>
          </>}
        </div>
        <div className="conversation-detail" aria-label="Conversation timeline" aria-busy={historyStatus === 'loading'}>
          {!selectedId && <p className="history-empty">No conversation selected.</p>}
          {historyStatus === 'loading' && <p role="status">Loading history...</p>}
          {historyStatus === 'error' && <p role="alert">{historyError}</p>}
          {historyStatus === 'ready' && history && <>
            <h3>{history.conversationId}</h3>
            {history.visitReference && <p className="history-meta">Visit {history.visitReference.slice(0, 8)}</p>}
            <div className="history-summary">
              <span>{history.messageCount} messages</span><span>{history.responseCount} responses</span><span>{history.feedbackCount} feedback submissions</span>
            </div>
            <p className="history-meta">First recorded: {formatTime(history.startedAt)}<br />Last recorded: {formatTime(history.updatedAt)}</p>
            <section className="conversation-referral-clicks" aria-label="Advising referral clicks">
              <h4>Advising referral link</h4>
              <p>{!Array.isArray(history.referralClicks) ? 'Referral click history unavailable.' : history.referralClicks.length
                ? 'Referral link clicked' : 'No referral link click recorded'}</p>
              {history.referralClicks?.length > 0 && <details>
                <summary>View recorded clicks ({history.referralClicks.length})</summary>
                <ul>{history.referralClicks.map((click, index) => <li key={index}>
                  <span>{formatTime(click.timestamp)}{click.turn ? ` · Reply ${click.turn}` : ''}</span>
                  <span className="history-referral-url">{click.url}</span>
                </li>)}</ul>
              </details>}
            </section>
            <ConversationReview key={history.conversationId} conversationId={history.conversationId} review={history.review}
              readOnly={readOnly}
              apiBaseUrl={apiBaseUrl} buildApiUrl={buildApiUrl} authToken={authToken} onUnauthorized={onUnauthorized}
              disabled={archiving} onSaved={(review) => {
                setHistory((current) => current?.conversationId === history.conversationId ? { ...current, review, reviewStatus: review.status } : current)
                setReviewRevision((value) => value + 1)
              }} />
            <ConversationGraph key={`${history.conversationId}-${revision}`} events={history.events}
              translationStatus={translationStatus} onRetryTranslation={() => setTranslationRevision((value) => value + 1)}
              onArchive={readOnly || (history.archived ?? showArchived) ? undefined : changeSelectedArchiveStatus}
              onRestore={!readOnly && (history.archived ?? showArchived) ? changeSelectedArchiveStatus : undefined}
              archiving={archiving} archiveError={archiveError} />
          </>}
        </div>
      </div>
    </section>
  )
}
