import { buildAnswerQualityRows } from './analyticsInsights.js'

const monthLabel = (month) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const percent = (value) => value == null ? 'Not available' : `${(value * 100).toFixed(1)}%`
const average = (value) => value == null ? 'Not available' : Number(value.toFixed(2))
const topicLabel = (key) => ({ unclassified: 'Topic not identified', human_help: 'Help from a business advisor', legal: 'Legal and licensing' }[key]
  || key.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase()))
const share = (value, total) => total ? percent(value / total) : 'Not available'

function chatChange(month, previous) {
  if (!previous) return 'No earlier month in this report'
  if (month.partial || previous.partial) return 'Not compared: month still in progress'
  if (!previous.conversations) return month.conversations ? 'New activity (previous month had no chats)' : 'No chats in either month'
  const change = (month.conversations - previous.conversations) / previous.conversations
  return change === 0 ? 'No change' : `${change > 0 ? 'Up' : 'Down'} ${percent(Math.abs(change))}`
}

export function buildMonthlyAnalyticsReportRows(data) {
  const totals = data.totals
  const topics = [...totals.categories].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
  const topTopic = topics.find(({ key, count }) => key !== 'unclassified' && count > 0)
  const missingReplies = totals.responseTypes.find(({ key }) => key === 'no_response')?.count || 0
  const rows = [
    ['CHATBOT USAGE REPORT'],
    ['Reporting period', `${monthLabel(data.startMonth)} through ${monthLabel(data.endMonth)}`],
    ['Included activity', 'Live visitor activity (test chats excluded)'],
    ['Report updated (UTC)', data.generatedAt],
    ['Read this first', 'Visits are browser sessions, not unique people. A chat is one conversation. Questions are messages sent by visitors, including follow-ups.'],
    ['Data limits', 'This report uses saved chat history. Deleted history cannot be recovered; zero means no matching saved activity.'],
    ...(data.months.some((month) => month.partial) ? [['Month in progress', 'The current month is incomplete. Do not compare its total with a full month.']] : []),
    [],
    ['USAGE AT A GLANCE'],
    ['Measure', 'Value', 'What it tells you'],
    ['Recorded visits', totals.sessions, 'Recorded browser visits with chat activity; one person may visit more than once.'],
    ['Chats', totals.conversations, 'Distinct conversations during the reporting period.'],
    ['Questions sent', totals.userMessages, 'Visitor messages, including follow-up questions in the same chat.'],
    ['Replies recorded', totals.assistantMessages, 'All recorded chatbot replies, including safety notices and error messages.'],
    ['Average questions per chat', average(totals.messagesPerConversation), 'How much visitors interact within a conversation.'],
    ['Average chats per visit', average(totals.chatsPerSession), 'Uses only chats with recorded visit details.'],
    ['Replies with a visitor rating', percent(totals.ratedMessageRate), 'Share of recorded replies rated by visitors; this measures feedback participation, not satisfaction.'],
    ['Chats with written feedback', totals.writtenFeedbackConversations, 'Number of distinct chats with a written visitor comment.'],
    ['Advising referral clicks', totals.advisingReferralClicks, 'Clicks on advising registration links and the older About-page referral destination; repeat clicks count.'],
    ['All OKSBDC link clicks', totals.oksbdcLinkClicks, 'Includes advising referral clicks and clicks on other OKSBDC links.'],
    ['Chats sharing an advising link', totals.advisingLinkChats, 'Each chat with a recorded advising link sent during the selected dates counts once.'],
    ['Referred chats clicking a link', totals.advisingClickedChats, 'Chats sharing an advising link with a later referral click during the same selected dates; each chat counts once.'],
    ['Advising chat click rate', percent(totals.advisingChatClickRate), 'Referred chats clicking a link divided by chats sharing an advising link; repeat clicks do not increase this percentage.'],
    ['Chats with referral clicks', totals.advisingClickChats, 'Chats with recorded message activity and at least one referral click during the selected dates; each chat counts once.'],
    ['Referral clicks across all chats', percent(totals.advisingAllChatClickRate), 'Chats with referral clicks divided by all chats with recorded message activity, with or without advising links.'],
    [],
    ['WHAT TO REVIEW'],
    ['Observation', 'Suggested follow-up'],
    ...(totals.userMessages === 0 && !totals.oksbdcLinkClicks ? [['No activity in this report', 'Check the reporting period before drawing conclusions about usage.']] : []),
    ...(topTopic ? [[`Most common identified topic: ${topicLabel(topTopic.key)} (${topTopic.count} questions; ${share(topTopic.count, totals.userMessages)} of questions)`, 'Review answers and resources for this topic first; it represents a frequent visitor need.']] : []),
    ...(missingReplies > 0 ? [[`${missingReplies} questions have no recorded reply`, 'Review these chats to understand whether visitors received help. A missing record alone does not establish a failed response.']] : []),
    ...(totals.userMessages > 0 ? [['Visitor feedback', 'Read written comments and ratings before judging answer quality. Usage and rating participation do not measure satisfaction.']] : []),
    [],
    ['MONTHLY USAGE'],
    ['Month', 'Month status', 'Recorded visits', 'Chats', 'Questions sent', 'Replies recorded', 'Average questions per chat', 'Chat change vs. previous month', 'Replies with a visitor rating', 'Chats with written feedback', 'Advising referral clicks', 'All OKSBDC link clicks'],
    ...data.months.map((month, index) => [monthLabel(month.month), month.partial ? 'In progress' : 'Full calendar month',
      month.sessions, month.conversations, month.userMessages, month.assistantMessages, average(month.messagesPerConversation),
      chatChange(month, data.months[index - 1]), percent(month.ratedMessageRate), month.writtenFeedbackConversations, month.advisingReferralClicks, month.oksbdcLinkClicks]),
    ['Whole reporting period', data.months.some((month) => month.partial) ? 'Includes a month in progress' : 'Full calendar months',
      totals.sessions, totals.conversations, totals.userMessages, totals.assistantMessages, average(totals.messagesPerConversation),
      'Not applicable', percent(totals.ratedMessageRate), totals.writtenFeedbackConversations, totals.advisingReferralClicks, totals.oksbdcLinkClicks],
    ['How to read totals', 'Visits and chats are counted once across the whole period; monthly counts may add up to more. Averages and percentages are calculated for the whole period.'],
    [],
    ['QUESTION TOPICS'],
    ['Period', 'Topic', 'Questions', 'Share of questions'],
    ...[{ ...totals, period: 'Whole reporting period' }, ...data.months.map((month) => ({ ...month, period: monthLabel(month.month) }))]
      .flatMap((row) => [...row.categories].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
        .map(({ key, count }) => [row.period, topicLabel(key), count, share(count, row.userMessages)])),
    ...(topics.length === 0 ? [['No questions recorded']] : []),
    ['How to use topics', 'Topics are assigned automatically. Use frequent topics to prioritize resources and answer reviews; check individual chats before making decisions.'],
    [],
    ['HOW THE CHATBOT REPLIED'],
    ['Reply kind', 'Replies', 'Share of recorded replies'],
    ['AI-written replies', totals.aiReplies, share(totals.aiReplies, totals.assistantMessages)],
    ['Saved replies', totals.predefinedReplies, share(totals.predefinedReplies, totals.assistantMessages)],
    ['Other replies', totals.assistantMessages - totals.aiReplies - totals.predefinedReplies,
      share(totals.assistantMessages - totals.aiReplies - totals.predefinedReplies, totals.assistantMessages)],
    ['What these mean', 'Saved replies are prepared answers, including safety messages. Other replies include block notices, backup replies, and errors. The type of reply does not tell you how helpful it was.'],
    [],
    ['COUNTING NOTES'],
    ['Missing values', 'Not available means an average or percentage cannot be calculated because the activity needed for it is missing. It is different from zero.'],
    ['Link clicks', 'Each recorded click counts in the month clicked, even if the chat began earlier or its message history is missing. Advising referrals include business.oksbdc.org/reg.aspx?mode=counsel and the older oksbdc.org/about destination. Test conversations are excluded. A click does not confirm a completed advising registration.'],
    ['Time boundaries', 'Months start and end in Coordinated Universal Time (UTC).'],
    ['Visit tracking', `${totals.linkedUserMessages} of ${totals.userMessages} visitor messages have visit details; ${totals.conversationsWithoutSession} chats have no visit details. Visits can restart when a visitor starts over.`],
    ['History coverage', `${data.coverage.invalidLines} unreadable records, ${data.coverage.excludedRecords} records with invalid chat, message, or click details, and ${data.coverage.undatedTurns} questions without a usable date could not be included. These counts cover the saved history scan, not just the selected months.`],
  ]
  return rows
}

function writeReportRows(sheet, rows, columnLimits, startRow = 1, startColumn = 1) {
  columnLimits.forEach(([min, max], index) => {
    const lengths = rows.filter((row) => row.length === columnLimits.length).map((row) => String(row[index] ?? '').length + 2)
    const column = sheet.getColumn(startColumn + index)
    column.width = Math.max(column.width || 0, Math.min(max, Math.max(min, ...lengths)))
  })
  rows.forEach((values, rowIndex) => {
    const row = sheet.getRow(startRow + rowIndex)
    values.forEach((value, index) => { row.getCell(startColumn + index).value = value })
    const section = values.length === 1 && values[0]
    if (section) sheet.mergeCells(row.number, startColumn, row.number, startColumn + columnLimits.length - 1)
    else if (values.length === 2 && columnLimits.length === 3) sheet.mergeCells(row.number, startColumn + 1, row.number, startColumn + 2)
    let lines = 1
    for (let index = 0; index < columnLimits.length; index++) {
      const cell = row.getCell(startColumn + index)
      if (cell.isMerged && cell.address !== cell.master.address) continue
      cell.font = { name: 'Calibri', size: section ? 13 : 11, color: { argb: 'FF243746' }, bold: Boolean(section) }
      cell.alignment = { vertical: 'top', wrapText: true }
      if (typeof cell.value === 'number') cell.numFmt = '#,##0.##'
      if (typeof cell.value === 'string' && /^\d+(\.\d+)?%$/.test(cell.value)) {
        cell.value = Number.parseFloat(cell.value) / 100
        cell.numFmt = '0.0%'
      }
      if (section) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9E1831' } }
        cell.font.color = { argb: 'FFFFFFFF' }
      } else if (row.number % 2 === 0 && values.length) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6F8' } }
      }
      const width = section ? columnLimits.reduce((sum, _, index) => sum + sheet.getColumn(startColumn + index).width, 0)
        : values.length === 2 && columnLimits.length === 3 && index === 1
          ? sheet.getColumn(startColumn + 1).width + sheet.getColumn(startColumn + 2).width : sheet.getColumn(cell.col).width
      lines = Math.max(lines, ...String(cell.value ?? '').split('\n').map((line) => Math.max(1, Math.ceil(line.length / (width * 0.8)))))
    }
    row.height = Math.max(row.height || 0, section ? 28 : Math.max(22, lines * 16 + 8))
  })
}

function addReportSheet(workbook, name, rows, columnLimits) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  writeReportRows(sheet, rows, columnLimits)
  sheet.pageSetup.printArea = `A1:${String.fromCharCode(64 + columnLimits.length)}${sheet.rowCount}`
  return sheet
}

function addCardSheet(workbook, name, title, intro, cards, notes, columnLimits) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 3, showGridLines: false, zoomScale: 85 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  const columnsPerCard = columnLimits.length
  const lastColumn = columnsPerCard * 3 + 2
  for (let card = 0; card < 3; card++) {
    columnLimits.forEach(([, max], index) => { sheet.getColumn(card * (columnsPerCard + 1) + index + 1).width = max })
    if (card < 2) sheet.getColumn((card + 1) * (columnsPerCard + 1)).width = 3
  }
  writeReportRows(sheet, [[title]], Array.from({ length: lastColumn }, (_, index) => {
    const width = sheet.getColumn(index + 1).width
    return [width, width]
  }))
  const fullWidthNote = (rowNumber, text) => {
    sheet.mergeCells(rowNumber, 1, rowNumber, lastColumn)
    const cell = sheet.getRow(rowNumber).getCell(1)
    cell.value = text
    cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF243746' } }
    cell.alignment = { vertical: 'top', wrapText: true }
    const width = sheet.columns.reduce((sum, column) => sum + column.width, 0)
    sheet.getRow(rowNumber).height = Math.max(34, Math.ceil(text.length / (width * 0.8)) * 16 + 8)
  }
  fullWidthNote(2, intro)
  let startRow = 4
  for (let index = 0; index < cards.length; index += 3) {
    const batch = cards.slice(index, index + 3)
    batch.forEach((card, slot) => writeReportRows(sheet, card, columnLimits, startRow, slot * (columnsPerCard + 1) + 1))
    startRow += Math.max(...batch.map((card) => card.length)) + 2
  }
  notes.forEach((note) => {
    fullWidthNote(startRow, note.join(': '))
    startRow += 2
  })
  sheet.pageSetup.printArea = `A1:${String.fromCharCode(64 + lastColumn)}${sheet.rowCount}`
  return sheet
}

export async function buildMonthlyAnalyticsWorkbook(data) {
  // Load the spreadsheet library only when a report is requested.
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'OKSBDC Chatbot'
  workbook.created = new Date(data.generatedAt)
  const rows = buildMonthlyAnalyticsReportRows(data)
  const section = (start, end) => rows.slice(rows.findIndex((row) => row[0] === start), end ? rows.findIndex((row) => row[0] === end) : undefined)
  addReportSheet(workbook, 'Summary', rows.slice(0, rows.findIndex((row) => row[0] === 'MONTHLY USAGE')), [[30, 34], [14, 18], [42, 48]])

  const monthly = section('MONTHLY USAGE', 'QUESTION TOPICS')
  const monthlyCards = []
  const monthlyNotes = []
  monthly.slice(2).forEach((row) => {
    if (row.length === monthly[1].length) {
      monthlyCards.push([[row[0]], ...monthly[1].slice(1).map((heading, index) => [heading, row[index + 1]])])
    } else if (row.length) monthlyNotes.push(row)
  })
  addCardSheet(workbook, 'Monthly usage', 'MONTHLY USAGE', 'Read left to right: three monthly cards per row, then continue below. Each card lists visits, chats, questions, feedback, and link clicks.', monthlyCards, monthlyNotes, [[24, 24], [18, 18]])

  const topicCards = []
  const topicNotes = []
  let period
  section('QUESTION TOPICS', 'HOW THE CHATBOT REPLIED').slice(2).forEach((row) => {
    if (row.length === 4) {
      if (row[0] !== period) { period = row[0]; topicCards.push([[period], ['Topic', 'Questions', 'Share of questions']]) }
      topicCards[topicCards.length - 1].push(row.slice(1))
    } else if (row.length) topicNotes.push(row)
  })
  addCardSheet(workbook, 'Question topics', 'QUESTION TOPICS', 'Read left to right: the whole reporting period first, then monthly cards, three across. Continue down for additional months.', topicCards, topicNotes, [[24, 24], [10, 10], [13, 13]])
  addReportSheet(workbook, 'Replies', section('HOW THE CHATBOT REPLIED', 'COUNTING NOTES'), [[26, 32], [12, 12], [25, 25]])
  addReportSheet(workbook, 'Answer quality', buildAnswerQualityRows(data), [[24, 28], [18, 22], [38, 48]])
  addReportSheet(workbook, 'Counting notes', section('COUNTING NOTES'), [[24, 30], [50, 64]])
  return workbook
}

export async function downloadMonthlyAnalyticsXlsx(data) {
  const workbook = await buildMonthlyAnalyticsWorkbook(data)
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `monthly-analytics_${data.startMonth}_${data.endMonth}.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
