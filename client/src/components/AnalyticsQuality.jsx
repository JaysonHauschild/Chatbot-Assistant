import DashboardHelp from './DashboardHelp.jsx'
import { dashboardTerm } from '../utils/dashboardLanguage.js'
import { qualityTopics, savedReplyOpportunities, savedReplySuggestion, ratingChange, latestRatingComparison } from '../utils/analyticsInsights.js'

const count = (value) => value == null ? '—' : value.toLocaleString()
const percent = (value) => value == null ? '—' : `${(value * 100).toFixed(1)}%`
const monthLabel = (month) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })

export default function AnalyticsQuality({ data, onViewConversations }) {
  const totals = data.totals
  const topics = qualityTopics(totals)
  const opportunities = savedReplyOpportunities(totals)
  const comparison = latestRatingComparison(data)
  return <section className="analytics-quality" aria-label="Answer quality and follow-up">
    <h3 aria-label="Answer quality and follow-up">Answer quality and follow-up<DashboardHelp label="About answer quality and follow-up">Questions needing help count each visitor message once; reasons may overlap. Deliberate blocks are left out. A missing reply record does not prove the visitor received no help. Ratings reflect only visitors who chose to give feedback; the latest rating for each reply or chat is used.</DashboardHelp></h3>
    <div className="analytics-kpis analytics-quality-kpis">
      {[
        ['Questions needing help', count(totals.helpNeededMessages), `${count(totals.noReplyMessages)} with no recorded reply · ${count(totals.unsureReplies)} unsure replies · ${count(totals.failedReplies)} backup or failed replies.`, 'help', totals.helpNeededMessages],
        ['Negative reply ratings', percent(totals.negativeReplyRate), `${count(totals.negativeReplies)} thumbs-down replies out of ${count(totals.ratedMessages)} rated replies.`, 'negative_reply', totals.negativeReplyRate, totals.ratedMessageRate],
        ['Negative chat ratings', percent(totals.negativeConversationRate), `${count(totals.negativeConversations)} sad ratings out of ${count(totals.ratedConversations)} rated chats.`, 'negative_chat', totals.negativeConversationRate, totals.ratedConversationRate],
      ].map(([title, value, note, quality, amount, participation]) => <article key={title}><h4 aria-label={title}>{title}<DashboardHelp label={`About ${title.toLowerCase()}`}>{note}</DashboardHelp></h4>
        <div className="analytics-rating-values"><strong>{value}</strong>
          {quality !== 'help' && <span className="analytics-rating-participation">
            <b>{percent(participation)}</b>
            <span>Participation<DashboardHelp label={`About ${quality === 'negative_reply' ? 'reply' : 'chat'} rating participation`}>
              {quality === 'negative_reply'
                ? `${count(totals.ratedMessages)} of ${count(totals.assistantMessages)} recorded replies received a rating.`
                : `${count(totals.ratedConversations)} of ${count(totals.conversations)} chats received a rating.`}
              {' '}Participation measures how often visitors rated, while the negative percentage uses only rated replies or chats. A dash means there is no denominator.
            </DashboardHelp></span>
          </span>}
        </div>
        {amount > 0 && onViewConversations && <button type="button" className="analytics-review-button" aria-label={`View conversations: ${title.toLowerCase()}`} onClick={() => onViewConversations({
          quality, dateFrom: `${data.startMonth}-01`,
          dateTo: new Date(Date.UTC(Number(data.endMonth.slice(0, 4)), Number(data.endMonth.slice(5, 7)), 0)).toISOString().slice(0, 10),
        })}>View conversations <i className="fa-solid fa-arrow-right" aria-hidden="true" /></button>}
      </article>)}
    </div>

    <div className="analytics-quality-section">
      <h4 aria-label="Changes in negative ratings">Changes in negative ratings<DashboardHelp label="About changes in negative ratings">Comparisons use completed months in this report. A dash means no ratings are available. Changes are in percentage points. For example, 10% to 15% is 5 points higher. Later feedback is counted with the original chat month; a chat active in several months may appear in each month. * The current month is still in progress and is not compared.</DashboardHelp></h4>
      <p className="analytics-note">{comparison.current && comparison.previous
        ? `${monthLabel(comparison.previous.month)} to ${monthLabel(comparison.current.month)}: reply ratings ${comparison.replyChange.toLowerCase()}; chat ratings ${comparison.chatChange.toLowerCase()}`
        : comparison.replyChange}.</p>
      <div className="analytics-table-scroll" tabIndex="0" role="region" aria-label="Negative ratings by month"><table>
        <thead><tr>{['Month', 'Thumbs down / rated replies', 'Negative reply ratings', 'Reply rating participation', 'Change from previous month', 'Sad / rated chats', 'Negative chat ratings', 'Chat rating participation', 'Change from previous month'].map((heading, index) => <th key={index} scope="col">{heading}</th>)}</tr></thead>
        <tbody>{data.months.map((month, index) => <tr key={month.month}>
          <th scope="row">{monthLabel(month.month)}{month.partial ? ' *' : ''}</th>
          <td>{count(month.negativeReplies)} / {count(month.ratedMessages)}</td><td>{percent(month.negativeReplyRate)}</td>
          <td>{percent(month.ratedMessageRate)}</td>
          <td>{ratingChange(month, data.months[index - 1])}</td>
          <td>{count(month.negativeConversations)} / {count(month.ratedConversations)}</td><td>{percent(month.negativeConversationRate)}</td>
          <td>{percent(month.ratedConversationRate)}</td>
          <td>{ratingChange(month, data.months[index - 1], 'negativeConversationRate')}</td>
        </tr>)}</tbody>
      </table></div>

    </div>
    <div className="analytics-quality-section">
      <h4 aria-label="Question topics needing help">Question topics needing help<DashboardHelp label="About question topics needing help">Grouped by question topic, with the most questions needing help first. Topics come from the final reply or the recorded question assessment when no reply topic is available. Missing topics are shown as “Topic not identified.”</DashboardHelp></h4>
      {topics.length ? <div className="analytics-table-scroll" tabIndex="0" role="region" aria-label="Question topics needing help"><table>
        <thead><tr>{['Topic', 'Questions needing help', 'No reply recorded', 'Unsure replies', 'Backup or failed replies'].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
        <tbody>{topics.map((topic) => <tr key={topic.key}><th scope="row">{dashboardTerm(topic.key)}</th>
          {['helpNeededMessages', 'noReplyMessages', 'unsureReplies', 'failedReplies'].map((key) => <td key={key}>{count(topic[key])}</td>)}
        </tr>)}</tbody>
      </table></div> : <p className="analytics-note">No questions needing help found for these dates.</p>}

    </div>
    <div className="analytics-quality-section">
      <h4 aria-label="Topics to review for saved replies">Topics to review for saved replies<DashboardHelp label="About topics to review for saved replies">Identified topics appear here if they have questions needing help, negative reply ratings, or at least three AI-written replies and no saved replies. These are suggestions to review, not proof of poor answers. Saved-reply counts show actual replies used during these dates, not the number of rules available.</DashboardHelp></h4>
      {opportunities.length ? <div className="analytics-table-scroll" tabIndex="0" role="region" aria-label="Topics to review for saved replies"><table>
        <thead><tr>{['Topic', 'Visitor questions', 'Questions needing help', 'Thumbs down / rated replies', 'Saved replies', 'AI-written replies', 'Suggested next step'].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
        <tbody>{opportunities.map((topic) => <tr key={topic.key}><th scope="row">{dashboardTerm(topic.key)}</th>
          <td>{count(topic.questions)}</td><td>{count(topic.helpNeededMessages)}</td><td>{count(topic.negativeReplies)} / {count(topic.ratedReplies)}</td>
          <td>{count(topic.savedReplies)}</td><td>{count(topic.aiReplies)}</td><td className="analytics-quality-suggestion">{savedReplySuggestion(topic)}</td>
        </tr>)}</tbody>
      </table></div> : <p className="analytics-note">No topics meet the review criteria for these dates.</p>}

    </div>
  </section>
}
