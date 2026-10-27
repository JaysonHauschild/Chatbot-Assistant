'use strict';

const { parseJsonLogLine, getEntryConversationId, getEntryMessageText, getEntryRuleId,
  getEntryFeedback, isEntryBlocked, isEntryPredefined, isEntryUnsureResponse } = require('../util/helpers');

const RESPONSE_EVENTS = new Set(['chat_response', 'chat_response_predefined', 'chat_response_blocked',
  'safe_template_reply', 'model_call_degraded_response', 'chat_error_response']);
const AI_EVENTS = new Set(['intent_classification_failed', 'model_call_failed']);
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
const increment = (map, key) => map.set(key, (map.get(key) || 0) + 1);
const ranked = (map) => [...map].map(([key, count]) => ({ key, count }))
  .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
const monthOf = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 7) : null;
};

function linkClickKind(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !/^([a-z0-9-]+\.)?oksbdc\.org$/i.test(url.hostname)) return null;
    const registration = url.hostname === 'business.oksbdc.org' && url.pathname.toLowerCase() === '/reg.aspx' &&
      url.searchParams.get('mode')?.toLowerCase() === 'counsel';
    // The chatbot's older referral templates point to the About page.
    const legacyReferral = ['oksbdc.org', 'www.oksbdc.org'].includes(url.hostname) && /^\/about\/?$/i.test(url.pathname);
    return registration || legacyReferral ? 'advising' : 'other';
  } catch {
    return null;
  }
}

function hasAdvisingLink(entry) {
  const recorded = entry?.classification?.allowed_links_used || entry?.allowed_links_used;
  const textLinks = (getEntryMessageText(entry, 'assistant') || '').match(/https?:\/\/[^\s<>"`]+/gi) || [];
  return [...(Array.isArray(recorded) ? recorded : []), ...textLinks]
    .some((url) => typeof url === 'string' && linkClickKind(url.replace(/[).,;!?\]]+$/, '')) === 'advising');
}

// Aggregate messages by turn and link clicks separately. Read all retained feedback
// before filtering months so a later rating still covers its original reply.
function buildMonthlyAnalytics(lines, { startMonth, endMonth, conversationFilter, dateFrom, dateTo, now = new Date() } = {}) {
  const testConversations = new Set();
  const turns = new Map();
  const sessionByConversation = new Map();
  const ratedMessages = new Map();
  const ratedConversations = new Map();
  const writtenConversations = new Set();
  const linkClicks = [];
  const rememberRating = (ratings, key, entry, value) => {
    const time = Number.isFinite(Date.parse(entry.timestamp)) ? Date.parse(entry.timestamp) : -Infinity;
    if (!ratings.has(key) || time >= ratings.get(key).time) ratings.set(key, { value, time });
  };
  let invalidLines = 0;
  let excludedRecords = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const entry = parseJsonLogLine(line);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { invalidLines++; continue; }
    const conversationId = getEntryConversationId(entry);
    if (entry.is_test || entry.test_mode) {
      if (conversationId) testConversations.add(conversationId);
      continue;
    }
    if (entry.event === 'advising_link_clicked') {
      const kind = linkClickKind(entry.details?.url || entry.url);
      const month = monthOf(entry.timestamp);
      if (!conversationId || !kind || !month) { excludedRecords++; continue; }
      linkClicks.push({ conversationId, month, kind, time: Date.parse(entry.timestamp) });
      continue;
    }
    if (entry.event === 'chat_feedback') {
      if (!conversationId) continue;
      const feedback = getEntryFeedback(entry);
      if (feedback.scope === 'response' && ['up', 'down'].includes(feedback.value) && Number.isInteger(entry.turn) && entry.turn > 0) {
        rememberRating(ratedMessages, `${conversationId}::${entry.turn}`, entry, feedback.value);
      }
      if (feedback.scope === 'session' && ['happy', 'neutral', 'sad'].includes(feedback.value)) rememberRating(ratedConversations, conversationId, entry, feedback.value);
      if (feedback.scope === 'session' && feedback.value === 'written') writtenConversations.add(conversationId);
      continue;
    }
    const legacyResponse = (!entry.event || entry.event === 'log_event') && Boolean(getEntryMessageText(entry, 'assistant'));
    const isResponse = RESPONSE_EVENTS.has(entry.event) || legacyResponse;
    const relevant = isResponse || entry.event === 'chat_turn_received' || entry.event === 'message_classified_for_routing' || AI_EVENTS.has(entry.event);
    if (!relevant) continue;
    if (!conversationId || !Number.isInteger(entry.turn) || entry.turn <= 0) { excludedRecords++; continue; }
    const key = `${conversationId}::${entry.turn}`;
    if (!turns.has(key)) turns.set(key, { key, conversationId, receipts: [], responses: [], events: [] });
    const turn = turns.get(key);
    turn.events.push(entry);
    if (entry.event === 'chat_turn_received') {
      turn.receipts.push(entry);
      const visit = entry.visit_id_hash || entry.details?.visit_id_hash;
      const session = visit || entry.details?.session_id_hash || entry.session_id_hash;
      if (typeof session === 'string' && session.trim()) sessionByConversation.set(conversationId, session);
    }
    if (isResponse) turn.responses.push(entry);
  }

  const rows = [];
  let undatedTurns = 0;
  for (const turn of turns.values()) {
    if (testConversations.has(turn.conversationId)) continue;
    if (!turn.receipts.length && !turn.responses.length) continue;
    const byTime = (a, b) => (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0);
    const datedReceipts = turn.receipts.filter((entry) => monthOf(entry.timestamp)).sort(byTime);
    const datedResponses = turn.responses.filter((entry) => monthOf(entry.timestamp)).sort(byTime);
    const activityTimestamp = (datedReceipts[0] || datedResponses[0])?.timestamp;
    const month = monthOf(activityTimestamp);
    if (!month) { undatedTurns++; continue; }
    const response = [...turn.responses].sort(byTime).at(-1);
    const explicitType = response?.routing?.response_type || response?.responseKind;
    const blocked = isEntryBlocked(response) || explicitType === 'blocked';
    const predefined = isEntryPredefined(response) || explicitType === 'predefined';
    const predefinedReply = Boolean(response && !blocked &&
      !['model_call_degraded_response', 'chat_error_response'].includes(response.event) &&
      !['degraded', 'error', 'expired'].includes(explicitType) &&
      (predefined || response.event === 'safe_template_reply'));
    const aiReply = Boolean(response && !blocked && !predefined && response.event !== 'safe_template_reply' &&
      (explicitType === 'ai_generated' || (!explicitType && (response.event === 'chat_response' || !response.event || response.event === 'log_event'))));
    const rules = new Set(turn.responses.flatMap((entry) => [getEntryRuleId(entry), entry.details?.overridden_rule || entry.overridden_rule]).filter(Boolean));
    const topicOf = (entry) => entry?.classification?.message_intent || entry?.message_intent || entry?.classification?.intent || entry?.intent;
    const topic = topicOf(response) || [...turn.events].sort(byTime).reverse().map(topicOf).find(Boolean);
    const category = typeof topic === 'string' && topic.trim() ? topic.trim() : 'unclassified';
    const unsureReply = Boolean(response && !blocked && isEntryUnsureResponse(response));
    const failedReply = Boolean(response && !blocked &&
      (['model_call_degraded_response', 'chat_error_response'].includes(response.event) ||
       ['degraded', 'error', 'expired'].includes(explicitType)));
    const noReply = !response;
    const needsHelp = noReply || unsureReply || failedReply;
    const aiUsed = aiReply || turn.events.some((entry) => entry.routing?.classification_source === 'gemini' || AI_EVENTS.has(entry.event));
    const classificationUnknown = turn.events.some((entry) => entry.event === 'message_classified_for_routing' && !entry.routing?.classification_source);
    rows.push({ ...turn, month, activityDate: new Date(activityTimestamp).toISOString().slice(0, 10), response, aiReply, predefinedReply, aiUsed, classificationUnknown, rules, category,
      session: sessionByConversation.get(turn.conversationId), blocked, unsureReply, failedReply, noReply, needsHelp });
  }

  const currentMonth = now.toISOString().slice(0, 7);
  const end = endMonth || currentMonth;
  const defaultStart = new Date(`${end}-01T00:00:00Z`);
  defaultStart.setUTCMonth(defaultStart.getUTCMonth() - 11);
  const start = startMonth || defaultStart.toISOString().slice(0, 7);
  const referrals = rows.filter((row) => row.response && hasAdvisingLink(row.response)).map((row) => ({
    conversationId: row.conversationId,
    month: monthOf(row.response.timestamp) || row.month,
    time: Date.parse(row.response.timestamp) || Date.parse(`${row.activityDate}T00:00:00Z`),
  }));
  const summarize = (items, clicks, sentReferrals) => {
    const referredChats = new Map();
    for (const referral of sentReferrals) {
      referredChats.set(referral.conversationId, Math.min(referredChats.get(referral.conversationId) ?? Infinity, referral.time));
    }
    const clickedReferredChats = new Set(clicks.filter((click) => click.kind === 'advising' &&
      referredChats.has(click.conversationId) && click.time >= referredChats.get(click.conversationId)).map((click) => click.conversationId));
    const sessions = new Set(items.map((row) => row.session).filter(Boolean));
    const conversations = new Set(items.map((row) => row.conversationId));
    const clickChats = new Set(clicks.filter((click) => click.kind === 'advising' &&
      conversations.has(click.conversationId)).map((click) => click.conversationId));
    const linked = items.filter((row) => row.session);
    const linkedConversations = new Set(linked.map((row) => `${row.session}::${row.conversationId}`));
    const categories = new Map();
    const rules = new Map();
    const responseTypes = new Map();
    const topicQuality = new Map();
    let assistantMessages = 0;
    let ratedMessageCount = 0;
    for (const row of items) {
      increment(categories, row.category);
      if (!topicQuality.has(row.category)) topicQuality.set(row.category, {
        key: row.category, questions: 0, noReplyMessages: 0, unsureReplies: 0, failedReplies: 0,
        helpNeededMessages: 0, aiReplies: 0, savedReplies: 0, ratedReplies: 0, negativeReplies: 0,
      });
      const topic = topicQuality.get(row.category);
      topic.questions++;
      topic.noReplyMessages += Number(row.noReply);
      topic.unsureReplies += Number(row.unsureReply);
      topic.failedReplies += Number(row.failedReply);
      topic.helpNeededMessages += Number(row.needsHelp);
      topic.aiReplies += Number(row.aiReply);
      topic.savedReplies += Number(row.predefinedReply);
      topic.ratedReplies += Number(Boolean(row.response && ratedMessages.has(row.key)));
      topic.negativeReplies += Number(Boolean(row.response && ratedMessages.get(row.key)?.value === 'down'));
      row.rules.forEach((rule) => increment(rules, rule));
      if (row.response) {
        assistantMessages++;
        if (ratedMessages.has(row.key)) ratedMessageCount++;
      }
      increment(responseTypes, !row.response ? 'no_response' : row.aiReply ? 'ai_generated' : row.blocked ? 'blocked' : row.rules.size ? 'regex_reply' : 'other_reply');
    }
    const ratedConversationCount = [...conversations].filter((id) => ratedConversations.has(id)).length;
    const negativeReplyCount = items.filter((row) => row.response && ratedMessages.get(row.key)?.value === 'down').length;
    const negativeConversationCount = [...conversations].filter((id) => ratedConversations.get(id)?.value === 'sad').length;
    return {
      advisingReferralClicks: clicks.filter((click) => click.kind === 'advising').length,
      advisingLinkChats: referredChats.size,
      advisingClickedChats: clickedReferredChats.size,
      advisingChatClickRate: ratio(clickedReferredChats.size, referredChats.size),
      advisingClickChats: clickChats.size,
      advisingAllChatClickRate: ratio(clickChats.size, conversations.size),
      oksbdcLinkClicks: clicks.length,
      noReplyMessages: items.filter((row) => row.noReply).length,
      unsureReplies: items.filter((row) => row.unsureReply).length,
      failedReplies: items.filter((row) => row.failedReply).length,
      helpNeededMessages: items.filter((row) => row.needsHelp).length,
      negativeReplies: negativeReplyCount, negativeReplyRate: ratio(negativeReplyCount, ratedMessageCount),
      negativeConversations: negativeConversationCount, negativeConversationRate: ratio(negativeConversationCount, ratedConversationCount),
      topicQuality: [...topicQuality.values()].sort((a, b) => b.helpNeededMessages - a.helpNeededMessages ||
        b.negativeReplies - a.negativeReplies || b.questions - a.questions || a.key.localeCompare(b.key)),
      sessions: sessions.size, conversations: conversations.size, userMessages: items.length, assistantMessages,
      messages: items.length + assistantMessages, linkedUserMessages: linked.length,
      conversationsWithoutSession: [...conversations].filter((id) => !sessionByConversation.has(id)).length,
      chatsPerSession: ratio(linkedConversations.size, sessions.size),
      messagesPerSession: ratio(linked.length, sessions.size),
      messagesPerConversation: ratio(items.length, conversations.size),
      ratedMessages: ratedMessageCount, ratedMessageRate: ratio(ratedMessageCount, assistantMessages),
      ratedConversations: ratedConversationCount, ratedConversationRate: ratio(ratedConversationCount, conversations.size),
      writtenFeedbackConversations: [...conversations].filter((id) => writtenConversations.has(id)).length,
      regexTurns: items.filter((row) => row.rules.size).length,
      aiReplies: items.filter((row) => row.aiReply).length,
      predefinedReplies: items.filter((row) => row.predefinedReply).length,
      aiUsedTurns: items.filter((row) => row.aiUsed).length,
      unknownClassificationTurns: items.filter((row) => row.classificationUnknown).length,
      categories: ranked(categories), rules: ranked(rules), responseTypes: ranked(responseTypes),
    };
  };
  const selected = rows.filter((row) => row.month >= start && row.month <= end);
  const selectedClicks = linkClicks.filter((click) => !testConversations.has(click.conversationId) && click.month >= start && click.month <= end);
  const selectedReferrals = referrals.filter((referral) => referral.month >= start && referral.month <= end);
  // Drill-downs share the report's turn and latest-rating rules, including test exclusions.
  if (conversationFilter) return new Set(selected.filter((row) => (!dateFrom || row.activityDate >= dateFrom) &&
    (!dateTo || row.activityDate <= dateTo)).filter((row) =>
    conversationFilter === 'help' ? row.needsHelp :
    conversationFilter === 'negative_reply' ? row.response && ratedMessages.get(row.key)?.value === 'down' :
    conversationFilter === 'negative_chat' && ratedConversations.get(row.conversationId)?.value === 'sad'
  ).map((row) => row.conversationId));
  const months = [];
  for (const cursor = new Date(`${start}-01T00:00:00Z`); cursor.toISOString().slice(0, 7) <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    months.push(cursor.toISOString().slice(0, 7));
  }
  const byMonth = new Map(months.map((month) => [month, []]));
  const clicksByMonth = new Map(months.map((month) => [month, []]));
  const referralsByMonth = new Map(months.map((month) => [month, []]));
  selected.forEach((row) => byMonth.get(row.month).push(row));
  selectedClicks.forEach((click) => clicksByMonth.get(click.month).push(click));
  selectedReferrals.forEach((referral) => referralsByMonth.get(referral.month).push(referral));
  return {
    generatedAt: now.toISOString(), startMonth: start, endMonth: end, traffic: 'production', timezone: 'UTC',
    firstRecordedMonth: rows.map((row) => row.month).sort()[0] || null,
    coverage: { invalidLines, excludedRecords, undatedTurns },
    totals: summarize(selected, selectedClicks, selectedReferrals),
    months: months.map((month) => ({ month, partial: month === currentMonth, ...summarize(byMonth.get(month), clicksByMonth.get(month), referralsByMonth.get(month)) })),
  };
}

module.exports = { buildMonthlyAnalytics, linkClickKind };
