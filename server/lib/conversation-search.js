'use strict';

const RATING_VALUES = new Set(['up', 'down', 'happy', 'neutral', 'sad']);
const RATING_FILTERS = new Set(['', 'negative', 'positive', 'unrated', ...RATING_VALUES]);

function parseConversationFilters(query) {
  const filters = {};
  for (const key of ['q', 'dateFrom', 'dateTo', 'topic', 'rating', 'blocked', 'page', 'reviewStatus', 'quality']) {
    const value = query[key];
    if (value !== undefined && (typeof value !== 'string' || value.length > (key === 'q' || key === 'page' ? 500 : 200))) {
      throw new Error('Enter a single, shorter value for each search field.');
    }
    filters[key] = (value || '').trim();
  }
  for (const key of ['dateFrom', 'dateTo']) {
    const value = filters[key];
    if (!value) continue;
    const date = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new Error('Choose valid dates for the conversation search.');
    }
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) throw new Error('The end date must be on or after the start date.');
  if (!RATING_FILTERS.has(filters.rating)) throw new Error('Choose one of the visitor rating options.');
  if (!['', 'yes', 'no'].includes(filters.blocked)) throw new Error('Choose one of the blocked message options.');
  if (!['', 'unfinished', 'to_review', 'in_progress', 'resolved'].includes(filters.reviewStatus)) throw new Error('Choose one of the review status options.');
  if (!['', 'help', 'negative_reply', 'negative_chat'].includes(filters.quality)) throw new Error('Choose one of the answer quality options.');
  filters.page = filters.page.split(/[?#]/)[0];
  return filters;
}

function normalizeWebsitePage(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return `${url.origin}${url.pathname}`;
  } catch { return ''; }
}

function conversationSearchSummary(metadata, events) {
  const visibleTurns = new Set(events.filter((event) => event.kind !== 'feedback').map((event) => event.turn));
  const topics = new Set();
  const pages = new Set();
  for (const [turn, details] of metadata) {
    if (!visibleTurns.has(turn)) continue;
    details.topics.forEach((topic) => topics.add(topic));
    details.pages.forEach((page) => pages.add(page));
  }
  const latestRatings = new Map();
  for (const event of events) {
    if (event.kind !== 'feedback' || !RATING_VALUES.has(event.rating)) continue;
    const key = `${event.scope}::${event.scope === 'response' ? event.turn : 'conversation'}`;
    const time = Number.isFinite(Date.parse(event.timestamp)) ? Date.parse(event.timestamp) : -Infinity;
    const current = latestRatings.get(key);
    if (!current || time >= current.time) latestRatings.set(key, { rating: event.rating, time });
  }
  return { topics: topics.size ? [...topics].sort() : ['unclassified'], pages: [...pages].sort(),
    ratings: [...new Set([...latestRatings.values()].map(({ rating }) => rating))],
    hasBlockedMessages: events.some((event) => event.kind === 'assistant' && event.blocked) };
}

function matchesConversationFilters(item, filters) {
  const q = filters.q.toLowerCase();
  if (q && !item.conversationId.toLowerCase().includes(q) && !item.events.some((event) => event.content.toLowerCase().includes(q))) return false;
  if (filters.dateFrom || filters.dateTo) {
    const from = filters.dateFrom ? Date.parse(`${filters.dateFrom}T00:00:00Z`) : -Infinity;
    const through = filters.dateTo ? Date.parse(`${filters.dateTo}T00:00:00Z`) + 86400000 : Infinity;
    if (!item.events.some((event) => event.timestamp && Date.parse(event.timestamp) >= from && Date.parse(event.timestamp) < through)) return false;
  }
  if (filters.topic && !item.topics.includes(filters.topic)) return false;
  if (filters.page && !item.pages.some((page) => page.toLowerCase().includes(filters.page.toLowerCase()))) return false;
  if (filters.blocked === 'yes' && !item.hasBlockedMessages) return false;
  if (filters.blocked === 'no' && item.hasBlockedMessages) return false;
  if (filters.rating === 'unrated' && item.ratings.length) return false;
  if (filters.rating === 'negative' && !item.ratings.some((rating) => ['down', 'sad'].includes(rating))) return false;
  if (filters.rating === 'positive' && !item.ratings.some((rating) => ['up', 'happy'].includes(rating))) return false;
  if (RATING_VALUES.has(filters.rating) && !item.ratings.includes(filters.rating)) return false;
  const reviewStatus = item.reviewStatus || 'to_review';
  if (filters.reviewStatus === 'unfinished' && reviewStatus === 'resolved') return false;
  if (filters.reviewStatus && filters.reviewStatus !== 'unfinished' && reviewStatus !== filters.reviewStatus) return false;
  return true;
}

module.exports = { parseConversationFilters, normalizeWebsitePage, conversationSearchSummary, matchesConversationFilters };
