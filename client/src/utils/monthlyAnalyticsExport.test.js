import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { buildMonthlyAnalyticsReportRows, buildMonthlyAnalyticsWorkbook } from './monthlyAnalyticsExport.js'

const { buildMonthlyAnalytics } = createRequire(import.meta.url)('../../../server/lib/monthly-analytics.js')
const report = (lines = [], options = {}) => buildMonthlyAnalytics(lines.map((line) => JSON.stringify(line)), {
  startMonth: '2026-01', endMonth: '2026-03', now: new Date('2026-03-15T00:00:00Z'), ...options,
})
const receipt = (month, id, turn = 1) => ({ event: 'chat_turn_received', conversationId: id, turn,
  timestamp: `2026-${month}-05T00:00:00Z`, session_id_hash: id })

test('report distinguishes no activity, unavailable averages and an incomplete month', () => {
  const rows = buildMonthlyAnalyticsReportRows(report())
  const text = JSON.stringify(rows)
  assert.equal(rows[0][0], 'CHATBOT USAGE REPORT')
  assert.ok(text.includes('"January 2026","Full calendar month",0,0,0,0,"Not available"'))
  assert.ok(text.includes('No chats in either month'))
  assert.ok(text.includes('Not compared: month still in progress'))
  assert.ok(text.includes('No activity in this report'))
  assert.ok(text.includes('Live visitor activity (test chats excluded)'))
  assert.ok(text.includes('No questions recorded'))
})

test('report calculates chat growth and preserves distinct range totals', () => {
  const text = JSON.stringify(buildMonthlyAnalyticsReportRows(report([receipt('01', 'same'), receipt('02', 'same', 2), receipt('02', 'another')])))
  assert.ok(text.includes('"February 2026","Full calendar month",2,2,2,0,1,"Up 100.0%"'))
  assert.ok(text.includes('"Whole reporting period","Includes a month in progress",2,2,3,0,1.5'))
  assert.ok(text.includes('3 questions have no recorded reply'))
  assert.ok(text.includes('missing record alone does not establish a failed response'))
})

test('topics and feedback use friendly labels and readable percentages', () => {
  const rows = buildMonthlyAnalyticsReportRows(report([
    receipt('01', 'example'),
    { event: 'chat_response', conversationId: 'example', turn: 1, timestamp: '2026-01-05T00:00:01Z', message_intent: 'human_help' },
    { event: 'chat_feedback', conversationId: 'example', turn: 1, feedback: 'up', scope: 'response' },
    receipt('02', 'other'),
    { event: 'chat_response', conversationId: 'other', turn: 1, timestamp: '2026-02-05T00:00:01Z', message_intent: '=Café,"topic"\nnext' },
  ]))
  const text = JSON.stringify(rows)
  assert.ok(text.includes('Help from a business advisor'))
  assert.ok(rows.some((row) => row.includes('=Café,"topic"\nnext')))
  assert.ok(text.includes('"Replies with a visitor rating","50.0%"'))
  assert.ok(text.includes('not satisfaction'))
  assert.ok(!text.includes('human_help'))
  assert.ok(!text.includes('classification_source'))
})

test('XLSX round trip preserves vertical layout, column sizes, numeric values and safe text', async () => {
  const data = report([receipt('01', 'example'),
    { event: 'chat_response', conversationId: 'example', turn: 1, timestamp: '2026-01-05T00:00:01Z', message_intent: '=Café,"topic"\nnext' },
    { event: 'chat_feedback', conversationId: 'example', turn: 1, feedback: 'up', scope: 'response' },
  ])
  const original = await buildMonthlyAnalyticsWorkbook(data)
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await original.xlsx.writeBuffer())
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Summary', 'Monthly usage', 'Question topics', 'Replies', 'Answer quality', 'Counting notes'])
  const monthly = workbook.getWorksheet('Monthly usage')
  assert.equal(monthly.columnCount, 8)
  assert.equal(monthly.getCell('A4').value, 'January 2026')
  assert.equal(monthly.getCell('D4').value, 'February 2026')
  assert.equal(monthly.getCell('G4').value, 'March 2026')
  assert.equal(monthly.getCell('A18').value, 'Whole reporting period')
  assert.equal(monthly.getCell('B6').value, 1)
  assert.equal(monthly.getCell('B26').numFmt, '0.0%')
  assert.equal(monthly.getColumn(3).width, 3)
  assert.equal(monthly.getCell('B5').alignment.wrapText, true)
  const summary = workbook.getWorksheet('Summary')
  const summaryRows = []
  summary.eachRow((row) => summaryRows.push(row))
  const rating = summaryRows.find((row) => row.getCell(1).value === 'Replies with a visitor rating')
  assert.equal(rating.getCell(2).value, 1)
  assert.equal(rating.getCell(2).numFmt, '0.0%')
  assert.equal(rating.getCell(3).alignment.wrapText, true)
  const topic = workbook.getWorksheet('Question topics').getColumn(1).values.find((value) => value === '=Café,"topic"\nnext')
  assert.equal(typeof topic, 'string')
  for (const sheet of workbook.worksheets) {
    const cardSheet = ['Monthly usage', 'Question topics'].includes(sheet.name)
    assert.ok(sheet.columnCount <= (cardSheet ? 11 : 3))
    assert.equal(sheet.views[0].state, 'frozen')
    assert.equal(sheet.pageSetup.fitToWidth, 1)
    assert.ok(sheet.columns.reduce((total, column) => total + column.width, 0) <= (cardSheet ? 150 : 100))
    sheet.eachRow((row) => assert.ok(row.height >= 22))
  }
})

test('topic cards wrap after three periods and leave room for the tallest card', async () => {
  const data = report([], { endMonth: '2026-04' })
  for (const [index, month] of data.months.entries()) {
    month.categories = Array.from({ length: index + 1 }, (_, topic) => ({ key: `topic_${topic}`, count: 1 }))
    month.userMessages = index + 1
  }
  data.totals.categories = [{ key: 'funding', count: 10 }]
  data.totals.userMessages = 10
  const workbook = await buildMonthlyAnalyticsWorkbook(data)
  const topics = workbook.getWorksheet('Question topics')
  assert.equal(topics.getCell('A4').value, 'Whole reporting period')
  assert.equal(topics.getCell('E4').value, 'January 2026')
  assert.equal(topics.getCell('I4').value, 'February 2026')
  assert.equal(topics.getCell('A10').value, 'March 2026')
  assert.equal(topics.getCell('E10').value, 'April 2026')
  assert.equal(topics.getCell('K7').value, 0.5)
  assert.equal(topics.getCell('K7').numFmt, '0.0%')
})

test('answer quality export includes the same counts and rate definitions as the dashboard', async () => {
  const data = report([receipt('01', 'missing'), { ...receipt('01', 'missing'), classification: { message_intent: 'funding' } },
    { event: 'chat_response', conversationId: 'rated', turn: 1, timestamp: '2026-02-05T00:00:01Z', message_intent: 'legal', unsure_response: true },
    { event: 'chat_feedback', conversationId: 'rated', turn: 1, timestamp: '2026-04-01T00:00:00Z', feedback: 'down', scope: 'response' },
  ])
  const workbook = await buildMonthlyAnalyticsWorkbook(data)
  const quality = workbook.getWorksheet('Answer quality')
  assert.equal(quality.getCell('B3').value, 2)
  assert.equal(quality.getCell('B7').value, 1)
  assert.equal(quality.getCell('B7').numFmt, '0.0%')
  const values = []
  quality.eachRow((row) => values.push(row.values))
  const text = JSON.stringify(values)
  assert.ok(text.includes('QUESTION TOPICS NEEDING HELP'))
  assert.ok(text.includes('TOPICS TO REVIEW FOR SAVED REPLIES'))
  assert.ok(text.includes('Legal and licensing'))
  assert.ok(text.includes('Not enough ratings to compare'))
  assert.ok(text.includes('1 thumbs-down replies out of 1 rated replies'))
})


test('Excel summary and monthly cards include referral clicks and all OKSBDC clicks', async () => {
  const data = report([
    { event: 'advising_link_clicked', conversation_id: 'earlier-chat', timestamp: '2026-02-01T00:00:00Z',
      details: { url: 'https://business.oksbdc.org/reg.aspx?mode=counsel' } },
    { event: 'advising_link_clicked', conversation_id: 'earlier-chat', timestamp: '2026-02-01T00:00:01Z',
      details: { url: 'https://www.oksbdc.org/workshops/' } },
  ])
  const rows = buildMonthlyAnalyticsReportRows(data)
  assert.equal(rows.find((row) => row[0] === 'Advising referral clicks')[1], 1)
  assert.equal(rows.find((row) => row[0] === 'All OKSBDC link clicks')[1], 2)
  assert.ok(!JSON.stringify(rows).includes('No activity in this report'))
  const workbook = await buildMonthlyAnalyticsWorkbook(data)
  const monthly = workbook.getWorksheet('Monthly usage')
  const cellNextTo = (column, label) => {
    const rowNumber = monthly.getColumn(column).values.findIndex((value) => value === label)
    assert.ok(rowNumber > 0)
    return monthly.getCell(rowNumber, column + 1).value
  }
  assert.equal(cellNextTo(1, 'Advising referral clicks'), 0)
  assert.equal(cellNextTo(4, 'Advising referral clicks'), 1)
  assert.equal(cellNextTo(4, 'All OKSBDC link clicks'), 2)
  const notes = JSON.stringify(workbook.getWorksheet('Counting notes').getSheetValues())
  assert.ok(notes.includes('A click does not confirm a completed advising registration'))
})
