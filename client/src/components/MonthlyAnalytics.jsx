import DashboardHelp from './DashboardHelp.jsx'
import { useRuleName } from '../hooks/useRuleNames.js'
import DashboardSubtabs from './DashboardSubtabs.jsx'
import { dashboardTerm } from '../utils/dashboardLanguage.js'
import { useEffect, useId, useState } from 'react'
import { downloadMonthlyAnalyticsXlsx } from '../utils/monthlyAnalyticsExport'
import AnalyticsQuality from './AnalyticsQuality.jsx'
import { readAnalyticsTimeframe, saveAnalyticsTimeframe } from '../utils/analyticsTimeframe.js'
import './MonthlyAnalytics.css'

const count = (value) => value == null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 0 })
const average = (value) => value == null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 2 })
const percent = (value) => value == null ? '—' : `${(value * 100).toFixed(1)}%`
const monthLabel = (value) => new Date(`${value}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })
const label = dashboardTerm

function Breakdown({ title, rows, denominator, empty, exactKeys = false }) {
  const ruleName = useRuleName()
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const visibleRows = expanded ? rows : rows.slice(0, 5)
  return <section className="analytics-breakdown" aria-label={title}>
    <h3>{title}</h3>
    {rows.length === 0 ? <p className="analytics-note">{empty}</p> : <ul id={listId} className="analytics-bars">
      {visibleRows.map((row) => <li key={row.key}>
        <div><span>{exactKeys ? ruleName(row.key) : label(row.key)}</span><strong>{count(row.count)} <small>({percent(denominator ? row.count / denominator : null)})</small></strong></div>
        <div className="analytics-bar-track" aria-hidden="true"><span style={{ width: `${denominator ? row.count / denominator * 100 : 0}%` }} /></div>
      </li>)}
    </ul>}
    {rows.length > 5 && <button type="button" className="analytics-review-button analytics-breakdown-toggle"
      aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded((value) => !value)}>
      {expanded ? 'Show top five' : `Show all (${rows.length})`}
    </button>}
  </section>
}

function ReferralProgress({ totals }) {
  const referralAvailable = Number.isFinite(totals.advisingLinkChats) && Number.isFinite(totals.advisingClickedChats)
  const referralDescription = !referralAvailable ? 'Referral click comparison unavailable.' : totals.advisingLinkChats === 0
    ? 'No chats shared an advising link during these dates.'
    : `${count(totals.advisingClickedChats)} of ${count(totals.advisingLinkChats)} chats clicked an advising link (${percent(totals.advisingChatClickRate)}).`
  const allChatsAvailable = Number.isFinite(totals.advisingClickChats) && Number.isFinite(totals.conversations)
  const allChatsDescription = !allChatsAvailable ? 'Referral click comparison unavailable.' : totals.conversations === 0
    ? 'No chats recorded during these dates.'
    : `${count(totals.advisingClickChats)} of ${count(totals.conversations)} total chats clicked an advising link (${percent(totals.advisingAllChatClickRate)}).`

  return <section className="analytics-referral-progress-grid" aria-label="Referral link engagement">
    <div className="analytics-referral-progress">
      <h4 aria-label="Advising link follow-through">Advising link follow-through<DashboardHelp label="About advising link follow-through">Each chat counts once. Both the shared link and click must fall within the selected dates. {count(totals.advisingReferralClicks)} total referral clicks recorded, including repeat clicks.</DashboardHelp></h4>
      <p>{referralDescription}</p>
      <div className="analytics-bar-track" role="progressbar" aria-label="Chats clicking an advising link"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((totals.advisingChatClickRate || 0) * 100)}
        aria-valuetext={referralDescription}>
        <span style={{ width: `${(totals.advisingChatClickRate || 0) * 100}%` }} />
      </div>

    </div>
    <div className="analytics-referral-progress">
      <h4 aria-label="Referral clicks across all chats">Referral clicks across all chats<DashboardHelp label="About referral clicks across all chats">All chats with recorded message activity during the selected dates, with or without advising links. Each chat with a referral click during those dates counts once.</DashboardHelp></h4>
      <p>{allChatsDescription}</p>
      <div className="analytics-bar-track" role="progressbar" aria-label="Referral clicks across all chats"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((totals.advisingAllChatClickRate || 0) * 100)}
        aria-valuetext={allChatsDescription}>
        <span style={{ width: `${(totals.advisingAllChatClickRate || 0) * 100}%` }} />
      </div>

    </div>
  </section>
}

function ResponseComparison({ totals }) {
  const available = Number.isFinite(totals.aiReplies) && Number.isFinite(totals.predefinedReplies)
  const total = available ? totals.aiReplies + totals.predefinedReplies : 0
  const aiShare = total > 0 ? totals.aiReplies / total : 0
  const description = !available ? 'Reply comparison unavailable.' : total === 0 ? 'No AI or saved replies in this period.'
    : `AI-written replies: ${count(totals.aiReplies)} (${percent(aiShare)}). Saved replies: ${count(totals.predefinedReplies)} (${percent(1 - aiShare)}).`

  return <section className="analytics-response-comparison" aria-label="AI-written versus saved replies">
    <div className="analytics-heading"><h3 aria-label="AI-written vs. saved replies">AI-written vs. saved replies<DashboardHelp label="About AI-written vs. saved replies">Saved replies are prepared answers, including safety messages. This chart compares them with AI-written answers for the selected dates. Blocked messages, backup replies, and errors are left out.</DashboardHelp></h3><span className="analytics-note">All selected months</span></div>
    <div className="analytics-comparison-content">
      <div className={`analytics-comparison-stacked-bar${total > 0 ? '' : ' is-empty'}`} role="img" aria-label={description}>
        {total > 0 && [
          ['ai', aiShare], ['predefined', 1 - aiShare],
        ].filter(([, share]) => share > 0).map(([key, share]) => <span key={key}
          className={`analytics-comparison-segment analytics-reply-${key}`} style={{ width: `${share * 100}%` }} aria-hidden="true">
          {share >= 0.12 && percent(share)}
        </span>)}
      </div>
      <div className="analytics-comparison-detail">
        <ul className="analytics-comparison-legend">
          {[
            ['ai', 'AI-written replies', totals.aiReplies],
            ['predefined', 'Saved replies', totals.predefinedReplies],
          ].map(([key, title, value]) => <li key={key}>
            <span className={`analytics-comparison-swatch analytics-reply-${key}`} aria-hidden="true" />
            <span>{title}</span><strong>{available ? count(value) : '—'}</strong><span>{available && total > 0 ? percent(value / total) : '—'}</span>
          </li>)}
        </ul>
        {available && total > 0 ? <p className="analytics-note">{count(total)} replies compared · {count(totals.assistantMessages - total)} other recorded replies excluded.</p>
          : <p className="analytics-note">{description}</p>}

      </div>
    </div>

  </section>
}

function MonthlyAnalytics({ apiBaseUrl, buildApiUrl, authToken, username, onUnauthorized, onViewConversations, activeTab, onSelectTab }) {
  const [filters, setFilters] = useState(() => readAnalyticsTimeframe(username))
  const [query, setQuery] = useState(filters)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState({ status: 'loading', data: null, error: '' })
  const [detailMonth, setDetailMonth] = useState('all')
  const [trendMetric, setTrendMetric] = useState('sessions')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  const exportReport = async () => {
    setExporting(true)
    setExportError('')
    try { await downloadMonthlyAnalyticsXlsx(result.data) }
    catch { setExportError('Unable to export the Excel report. Please try again.') }
    finally { setExporting(false) }
  }

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      setResult({ status: 'loading', data: null, error: '' })
      try {
        const params = new URLSearchParams(query)
        const response = await fetch(`${buildApiUrl(apiBaseUrl, '/api/dashboard/monthly-analytics')}?${params}`, {
          headers: { Authorization: `Bearer ${authToken}` }, signal: controller.signal,
        })
        if (response.status === 401) { onUnauthorized(); return }
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to load monthly analytics.')
        if (!controller.signal.aborted) setResult({ status: 'ready', data, error: '' })
      } catch (error) {
        if (!controller.signal.aborted) setResult({ status: 'error', data: null, error: error.message })
      }
    }
    load()
    return () => controller.abort()
  }, [apiBaseUrl, buildApiUrl, authToken, onUnauthorized, query, revision])

  const { data, status, error } = result
  const totals = data?.totals
  const details = detailMonth === 'all' ? totals : data?.months.find((month) => month.month === detailMonth)
  const trendOptions = { sessions: 'Visits', advisingReferralClicks: 'Advising referral clicks', oksbdcLinkClicks: 'All OKSBDC link clicks', conversations: 'Chats', userMessages: 'Visitor messages', chatsPerSession: 'Chats per visit', messagesPerSession: 'Messages per visit', ratedMessages: 'Rated replies', ratedConversations: 'Rated conversations', regexTurns: 'Messages matching rules', aiReplies: 'AI-written replies', aiUsedTurns: 'Messages using AI', helpNeededMessages: 'Questions needing help', noReplyMessages: 'No reply recorded', unsureReplies: 'Unsure replies', negativeReplyRate: 'Negative reply ratings (%)', negativeConversationRate: 'Negative chat ratings (%)' }
  const maxTrend = Math.max(1, ...(data?.months.map((month) => month[trendMetric] || 0) || []))

  return <div className="monthly-analytics">
    <div className="analytics-heading"><h2 aria-label="Monthly analytics">Monthly analytics<DashboardHelp label="About this analytics report"><p>Download an Excel report for the dates you have applied. It includes a summary, monthly activity, popular question topics, and suggestions for what to review.</p><p>Visit details are available for {count(totals?.linkedUserMessages)} of {count(totals?.userMessages)} visitor messages. {count(totals?.conversationsWithoutSession)} chats have no visit details. New chats keep the same visit across resets. Older history may count a reset as a new visit. A dash means an average or percentage cannot be calculated.</p><p>Referral clicks are counted in the month clicked, including repeat clicks. All OKSBDC link clicks also include other OKSBDC destinations. Clicks do not confirm an advising registration was completed.</p><p>This report uses saved chat history. Each visitor message is counted once, in the month it was first received. Older history may use the reply date instead. Test chats and administrative activity are excluded. Hidden and archived chats still count while their history is saved.</p><p>A chat is one conversation. A visit is recorded browser activity, not a unique person. Averages per visit leave out activity without visit details. Visitor messages are questions and follow-ups. Total messages also include chatbot replies, including block notices and backup replies. A visit or chat may appear in more than one month; totals for the full period count each one once.</p></DashboardHelp></h2><span className="analytics-note">Calendar months · Coordinated Universal Time (UTC)</span></div>
    <form className="analytics-filters" onSubmit={(event) => { event.preventDefault(); saveAnalyticsTimeframe(username, filters); setDetailMonth('all'); setQuery({ ...filters }); setRevision((value) => value + 1) }}>
      <label>From<input type="month" required value={filters.startMonth} onChange={(event) => setFilters({ ...filters, startMonth: event.target.value })} /></label>
      <label>Through<input type="month" required value={filters.endMonth} min={filters.startMonth} onChange={(event) => setFilters({ ...filters, endMonth: event.target.value })} /></label>
      <button type="submit" disabled={status === 'loading'}>{status === 'loading' ? 'Loading…' : 'Update report'}</button>
      <button type="button" disabled={status !== 'ready' || exporting} onClick={exportReport}>{exporting ? 'Preparing Excel…' : 'Export Excel (.xlsx)'}</button>
    </form>

    {exportError && <p role="alert" className="dashboard-message error">{exportError}</p>}
    {status === 'loading' && <p role="status">Loading monthly analytics…</p>}
    {status === 'error' && <p role="alert" className="dashboard-message error">{error} Use Update report to retry.</p>}
    {data && <>
      <p className="analytics-note">{monthLabel(data.startMonth)} – {monthLabel(data.endMonth)} · Test activity excluded · Updated {new Date(data.generatedAt).toLocaleString()}</p>
      {totals.userMessages === 0 && !totals.oksbdcLinkClicks && <p className="analytics-empty" role="status">No saved chat activity found for these dates.</p>}
      {(data.coverage.invalidLines + data.coverage.excludedRecords + data.coverage.undatedTurns > 0) && <p className="analytics-note">Some saved activity could not be counted: {count(data.coverage.invalidLines)} unreadable entries, {count(data.coverage.excludedRecords)} entries with invalid chat, message, or click details, and {count(data.coverage.undatedTurns)} messages missing a valid date. These counts cover all saved history checked for this report.</p>}

      <DashboardSubtabs idPrefix="analytics" label="Monthly analytics areas" activeTab={activeTab} onSelect={onSelectTab} tabs={[
        { id: 'usage', label: 'Usage & referrals', content: <>
          <div className="analytics-kpis">
            {[
              ['Visits', count(totals.sessions), 'Recorded browser visits with chat activity. One person may visit more than once.'],
              ['Chats', count(totals.conversations), 'Conversations with activity during the selected dates.'],
              ['Chats per visit', average(totals.chatsPerSession), 'Average chats per recorded visit. Chats without visit details are left out.'],
              ['Messages per visit', average(totals.messagesPerSession), 'Average visitor messages per recorded visit. Messages without visit details are left out.'],
              ['Advising referral clicks', count(totals.advisingReferralClicks), 'Recorded clicks on advising registration links and the older About-page referral destination.'],
            ].map(([title, value, note]) => <article key={title}><h3 aria-label={title}>{title}<DashboardHelp label={`About ${title.toLowerCase()}`}>{note}</DashboardHelp></h3><strong>{value}</strong></article>)}
          </div>
          <ReferralProgress totals={totals} />

          <section className={`analytics-trend${data.months.length <= 4 ? ' is-compact' : ''}`}>
            <div className="analytics-heading"><h3 aria-label="Month-to-month trend">Month-to-month trend<DashboardHelp label="About the month-to-month trend">* The current month is still in progress. Zero means no saved activity was found; deleted history cannot be recovered. {data.firstRecordedMonth && `First recorded visitor activity: ${monthLabel(data.firstRecordedMonth)}.`}</DashboardHelp></h3><label>Measure <select aria-label="Measure" value={trendMetric} onChange={(event) => setTrendMetric(event.target.value)}>{Object.entries(trendOptions).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label></div>
            <div className="analytics-trend-scroll" tabIndex="0" role="region" aria-label="Monthly bar chart; scroll horizontally to see more months">
              <ul className="analytics-month-bars" aria-label={`${trendOptions[trendMetric]} by month`}>
                {data.months.map((month) => <li key={month.month}>
                  <strong>{trendMetric.endsWith('Rate') ? percent(month[trendMetric]) : average(month[trendMetric])}</strong>
                  <div className="analytics-column-track" aria-hidden="true">
                    <span style={{ height: `${(month[trendMetric] || 0) / maxTrend * 100}%` }} />
                  </div>
                  <span>{monthLabel(month.month)}{month.partial ? ' *' : ''}</span>
                </li>)}
              </ul>
            </div>

          </section>
          <section><h3>Usage by month</h3><div className="analytics-table-scroll" tabIndex="0" role="region" aria-label="Monthly usage table"><table>
            <thead><tr>{['Month', 'Visits', 'Chats', 'Chats / visit', 'Visitor messages', 'Chatbot replies', 'Total messages', 'Messages / visit', 'Messages / chat', 'Advising referral clicks', 'All OKSBDC link clicks'].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
            <tbody>{data.months.map((month) => <tr key={month.month}><th scope="row">{monthLabel(month.month)}{month.partial ? ' *' : ''}</th>{['sessions', 'conversations', 'chatsPerSession', 'userMessages', 'assistantMessages', 'messages', 'messagesPerSession', 'messagesPerConversation', 'advisingReferralClicks', 'oksbdcLinkClicks'].map((key) => <td key={key}>{average(month[key])}</td>)}</tr>)}</tbody>
          </table></div></section>
        </> },
        { id: 'quality', label: 'Answer quality', content: <>
          <AnalyticsQuality data={data} onViewConversations={onViewConversations} />
          <ResponseComparison totals={totals} />
          <section><h3 aria-label="Feedback and replies by month">Feedback and replies by month<DashboardHelp label="About feedback and replies">“Messages using AI” includes questions where AI helped choose a topic or prepare an answer, even if the attempt failed. A message can use both AI and a rule. Each visitor message counts once.{totals.unknownClassificationTurns > 0 && ` Older history does not show how ${count(totals.unknownClassificationTurns)} messages were assessed, so actual AI use may be higher.`} Reply ratings are thumbs up or down. Chat ratings are happy, neutral, or sad. Each reply or chat is counted once, even if rated again. Feedback added later is included with the original chat. Written comments are counted separately.</DashboardHelp></h3><div className="analytics-table-scroll" tabIndex="0" role="region" aria-label="Monthly feedback and replies table"><table>
            <thead><tr>{['Month', 'Rated replies', 'Replies rated (%)', 'Rated conversations', 'Chats rated (%)', 'Chats with written feedback', 'Messages matching rules', 'AI-written replies', 'Messages using AI'].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
            <tbody>{data.months.map((month) => <tr key={month.month}><th scope="row">{monthLabel(month.month)}{month.partial ? ' *' : ''}</th><td>{count(month.ratedMessages)}</td><td>{percent(month.ratedMessageRate)}</td><td>{count(month.ratedConversations)}</td><td>{percent(month.ratedConversationRate)}</td>{['writtenFeedbackConversations', 'regexTurns', 'aiReplies', 'aiUsedTurns'].map((key) => <td key={key}>{count(month[key])}</td>)}</tr>)}</tbody>
          </table></div>

          </section>
        </> },
        { id: 'topics', label: 'Topics & rules', content: <>
          <section>
            <div className="analytics-heading"><h3 aria-label="Question categories and rules">Question categories and rules<DashboardHelp label="About question categories and rules">Percentages use visitor messages for the selected period. Topics come from the final reply or the recorded question assessment; missing topics appear as “Topic not identified.” Rules include matches that blocked a message, sent a saved reply, or were replaced by a safety reply. One message may match several rules.</DashboardHelp></h3><label>Show details for <select value={detailMonth} onChange={(event) => setDetailMonth(event.target.value)}><option value="all">All selected months</option>{data.months.map((month) => <option key={month.month} value={month.month}>{monthLabel(month.month)}</option>)}</select></label></div>
            {details && <div className="analytics-breakdown-grid">
              <Breakdown key={`${detailMonth}-categories`} title="Question categories" rows={details.categories} denominator={details.userMessages} empty="No questions recorded." />
              <Breakdown key={`${detailMonth}-replies`} title="Types of replies" rows={details.responseTypes} denominator={details.userMessages} empty="No responses recorded." />
              <Breakdown key={`${detailMonth}-rules`} title="Rules used" rows={details.rules} denominator={details.userMessages} empty="No rule matches recorded." exactKeys />
            </div>}

          </section>
        </> },
      ]} />

    </>}
  </div>
}

export default MonthlyAnalytics
