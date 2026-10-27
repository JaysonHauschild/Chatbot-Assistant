'use strict';

const fs = require('node:fs');
const path = require('node:path');
const REVIEW_STATUSES = new Set(['to_review', 'in_progress', 'resolved']);
const emptyReview = () => ({ status: 'to_review', version: 0, updates: [] });
const reviewPath = () => process.env.DASHBOARD_CONVERSATION_REVIEW_PATH
  || path.join(__dirname, '..', 'data', 'conversation-reviews.jsonl');

function readConversationReviews() {
  let contents;
  try { contents = fs.readFileSync(reviewPath(), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return new Map(); throw error; }
  const reviews = new Map();
  for (const line of contents.split('\n').filter((value) => value.trim())) {
    const entry = JSON.parse(line);
    if (typeof entry.conversationId !== 'string' || !REVIEW_STATUSES.has(entry.status)
      || typeof entry.note !== 'string' || typeof entry.updatedBy !== 'string' || !Number.isFinite(Date.parse(entry.updatedAt))) {
      throw new Error('Unable to read saved conversation reviews.');
    }
    const current = reviews.get(entry.conversationId) || emptyReview();
    current.status = entry.status;
    current.version += 1;
    current.updates.push({ status: entry.status, note: entry.note, updatedBy: entry.updatedBy, updatedAt: entry.updatedAt });
    reviews.set(entry.conversationId, current);
  }
  return reviews;
}

function saveConversationReview(conversationId, { status, note, expectedVersion, updatedBy }) {
  const current = readConversationReviews().get(conversationId) || emptyReview();
  if (current.version !== expectedVersion) {
    const error = new Error('Someone else updated this review. Check their changes, then save again. Your note is still here.');
    error.status = 409;
    error.review = current;
    throw error;
  }
  if (status === current.status && !note) return current;
  const update = { status, note, updatedBy, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(reviewPath()), { recursive: true });
  // Staff-only metadata remains separate from chatbot logs and visitor context.
  fs.appendFileSync(reviewPath(), `${JSON.stringify({ conversationId, ...update })}\n`, 'utf8');
  return { status, version: current.version + 1, updates: [...current.updates, update] };
}

module.exports = { REVIEW_STATUSES, emptyReview, readConversationReviews, saveConversationReview };
