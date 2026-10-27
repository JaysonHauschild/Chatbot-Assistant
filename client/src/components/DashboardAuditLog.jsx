import { useEffect, useState } from 'react'
import DashboardHelp from './DashboardHelp.jsx'
import { useRuleName } from '../hooks/useRuleNames.js'

const pageSize = 50
const formatAction = (action) => typeof action === 'string' ? action.replaceAll('_', ' ') : 'Unknown action'
const formatTime = (timestamp) => {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString()
}

export default function DashboardAuditLog({ apiBaseUrl, buildApiUrl, authToken, onUnauthorized, refreshKey }) {
  const ruleName = useRuleName()
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState({ items: [], total: 0 })
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset), q: query })
    fetch(buildApiUrl(apiBaseUrl, `/api/dashboard/audit-log?${params}`), {
      headers: { Authorization: `Bearer ${authToken}` }, signal: controller.signal, cache: 'no-store',
    }).then(async (response) => {
      if (controller.signal.aborted) return
      if (response.status === 401) { onUnauthorized(); return }
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load the dashboard audit log.')
      if (controller.signal.aborted) return
      const items = Array.isArray(data.items) ? data.items : []
      setResult({ items, total: Number.isSafeInteger(data.total) && data.total >= 0 ? data.total : items.length })
      setError('')
      setStatus('ready')
    }).catch((failure) => {
      if (!controller.signal.aborted) { setError(failure.message); setStatus('error') }
    })
    return () => controller.abort()
  }, [apiBaseUrl, buildApiUrl, authToken, onUnauthorized, offset, query, revision, refreshKey])

  function refresh() {
    setStatus('loading')
    setOffset(0)
    setRevision((value) => value + 1)
  }

  function applySearch(event) {
    event.preventDefault()
    setQuery(search.trim())
    refresh()
  }

  function changePage(nextOffset) {
    setStatus('loading')
    setOffset(nextOffset)
  }

  return <section className="administration-audit" aria-label="Dashboard audit log">
    <h3>Dashboard audit log<DashboardHelp label="About the dashboard audit log">
      Recorded dashboard changes and rule tests, newest first. Search actions, administrators, or targets across the log.
      Expand an entry to view its recorded details and request metadata. Message content uses the audit log’s existing redaction.
    </DashboardHelp></h3>
    <form className="administration-audit-controls" onSubmit={applySearch} aria-label="Search audit log">
      <label>Search audit log<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={200} /></label>
      <button type="submit" className="conversation-search-button">Search</button>
      <button type="button" className="conversation-search-button" onClick={refresh}>Refresh audit log</button>
    </form>
    {status === 'loading' && <p role="status">Loading audit log…</p>}
    {status === 'error' && <p role="alert" className="dashboard-message error">{error}</p>}
    {status === 'ready' && <>
      <p className="history-meta">{result.total === 0 ? 'No audit entries found.' : result.items.length === 0 ? 'No entries on this page. Refresh to see the latest entries.' : `Showing ${offset + 1}–${Math.min(offset + result.items.length, result.total)} of ${result.total} entries.`}</p>
      {result.items.length > 0 && <div className="analytics-table-scroll" tabIndex="0" role="region" aria-label="Audit entries">
        <table><thead><tr>{['Time', 'Action', 'Administrator / operator', 'Target', 'Details'].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{result.items.map((entry, index) => <tr key={`${offset}-${index}-${revision}`}>
            <td>{formatTime(entry.timestamp)}</td>
            <td>{formatAction(entry.action)}</td>
            <td>{entry.actor?.username || entry.actor?.subject || 'Unknown'}{entry.actor?.role && <span className="administration-email">{entry.actor.role}</span>}</td>
            <td>{entry.target?.type || '—'}{entry.target?.id && <span className="administration-email">{entry.target.type === 'message_filter_rule' ? ruleName(entry.target.id, entry.target.displayName) : entry.target.id}</span>}</td>
            <td><details><summary aria-label={`Details for ${entry.action || 'unknown action'} at ${entry.timestamp || 'unknown time'}`}>View details</summary>
              <pre>{JSON.stringify(entry, null, 2)}</pre>
            </details></td>
          </tr>)}</tbody>
        </table>
      </div>}
      <nav className="administration-audit-controls" aria-label="Audit log pages">
        <button type="button" className="conversation-search-button" disabled={offset === 0} onClick={() => changePage(Math.max(0, offset - pageSize))}>Newer entries</button>
        <button type="button" className="conversation-search-button" disabled={offset + pageSize >= result.total} onClick={() => changePage(offset + pageSize)}>Older entries</button>
      </nav>
    </>}
  </section>
}
