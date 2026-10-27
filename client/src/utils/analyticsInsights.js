import { dashboardTerm } from './dashboardLanguage.js'

export const qualityTopics = (totals) => (totals?.topicQuality || []).filter((topic) => topic.helpNeededMessages > 0)

export function savedReplyOpportunities(totals) {
  return (totals?.topicQuality || []).filter((topic) => topic.key !== 'unclassified' &&
    (topic.helpNeededMessages > 0 || topic.negativeReplies > 0 || (topic.aiReplies >= 3 && topic.savedReplies === 0)))
}

export function savedReplySuggestion(topic) {
  if (topic.savedReplies > 0) return 'Review the saved replies and guidance for this topic.'
  if (topic.helpNeededMessages > 0 || topic.negativeReplies > 0) return 'Check these chats and consider adding a saved reply or clearer guidance.'
  return 'AI answered this topic repeatedly. Consider a saved reply for common questions.'
}

export function ratingChange(current, previous, metric = 'negativeReplyRate') {
  if (!previous) return 'No earlier month in this report'
  if (current.partial || previous.partial) return 'Month still in progress; not compared'
  if (current[metric] == null || previous[metric] == null) return 'Not enough ratings to compare'
  const points = (current[metric] - previous[metric]) * 100
  if (Math.abs(points) < 0.000001) return 'No change'
  const amount = Math.abs(points) < 0.05 ? 'Less than 0.1' : Math.abs(points).toFixed(1)
  return `${amount} percentage points ${points > 0 ? 'higher' : 'lower'}`
}

export function latestRatingComparison(data) {
  const fullMonths = data.months.filter((month) => !month.partial && month.month < data.generatedAt.slice(0, 7))
  const current = fullMonths.at(-1)
  const previous = fullMonths.at(-2)
  return { current, previous, replyChange: current ? ratingChange(current, previous) : 'No completed months in this report',
    chatChange: current ? ratingChange(current, previous, 'negativeConversationRate') : 'No completed months in this report' }
}

const monthLabel = (month) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const percentage = (value) => value == null ? 'Not available' : `${(value * 100).toFixed(1)}%`

export function buildAnswerQualityRows(data) {
  const totals = data.totals
  const topics = qualityTopics(totals)
  const opportunities = savedReplyOpportunities(totals)
  return [
    ['ANSWER QUALITY AND FOLLOW-UP'],
    ['Measure', 'Value', 'How to read it'],
    ['Questions needing help', totals.helpNeededMessages ?? 'Not available', 'Each visitor message counts once if it has no recorded reply, an unsure reply, or a backup/failed reply. Deliberate blocks are excluded.'],
    ['No reply recorded', totals.noReplyMessages ?? 'Not available', 'A missing reply record does not prove the visitor received no help.'],
    ['Unsure replies', totals.unsureReplies ?? 'Not available', 'The final reply was marked as unsure.'],
    ['Backup or failed replies', totals.failedReplies ?? 'Not available', 'The final reply used a backup message, failed, or timed out.'],
    ['Negative reply ratings', percentage(totals.negativeReplyRate), `${totals.negativeReplies ?? 0} thumbs-down replies out of ${totals.ratedMessages} rated replies. Rating participation: ${percentage(totals.ratedMessageRate)} (${totals.ratedMessages} of ${totals.assistantMessages} replies).`],
    ['Negative chat ratings', percentage(totals.negativeConversationRate), `${totals.negativeConversations ?? 0} sad ratings out of ${totals.ratedConversations} rated chats. Rating participation: ${percentage(totals.ratedConversationRate)} (${totals.ratedConversations} of ${totals.conversations} chats).`],
    ['Feedback limits', 'Ratings reflect only visitors who chose to give feedback. The latest recorded rating for each reply or chat is used. Later feedback is attributed to the original activity month.'],
    [],
    ['NEGATIVE RATINGS BY MONTH'],
    ...data.months.flatMap((month, index) => [
      [monthLabel(month.month), 'Reply ratings', `${month.negativeReplies ?? 0} of ${month.ratedMessages} rated replies (${percentage(month.negativeReplyRate)}); participation ${percentage(month.ratedMessageRate)}; ${ratingChange(month, data.months[index - 1])}`],
      [monthLabel(month.month), 'Chat ratings', `${month.negativeConversations ?? 0} of ${month.ratedConversations} rated chats (${percentage(month.negativeConversationRate)}); participation ${percentage(month.ratedConversationRate)}; ${ratingChange(month, data.months[index - 1], 'negativeConversationRate')}`],
    ]),
    [],
    ['QUESTION TOPICS NEEDING HELP'],
    ['Topic', 'Questions needing help', 'What happened'],
    ...topics.map((topic) => [dashboardTerm(topic.key), topic.helpNeededMessages,
      `${topic.noReplyMessages} with no recorded reply; ${topic.unsureReplies} unsure replies; ${topic.failedReplies} backup or failed replies. Reasons may overlap.`]),
    ...(!topics.length ? [['No questions needing help found in this period.']] : []),
    [],
    ['TOPICS TO REVIEW FOR SAVED REPLIES'],
    ['Topic', 'Visitor questions', 'Suggested follow-up'],
    ...opportunities.map((topic) => [dashboardTerm(topic.key), topic.questions,
      `${topic.helpNeededMessages} needing help; ${topic.negativeReplies} thumbs down out of ${topic.ratedReplies} rated replies; ${topic.savedReplies} saved replies; ${topic.aiReplies} AI-written replies. ${savedReplySuggestion(topic)}`]),
    ...(!opportunities.length ? [['No topics meet the review criteria for these dates.']] : []),
    ['How topics are chosen', 'Identified topics with questions needing help, negative reply ratings, or at least three AI-written replies and no saved replies. These are review suggestions, not proof of poor answers.'],
  ]
}
