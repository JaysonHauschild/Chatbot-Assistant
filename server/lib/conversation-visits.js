'use strict';

const crypto = require('node:crypto');
const reference = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 20);

function rememberConversationVisit(identities, conversationId, entry) {
  if (entry.event !== 'chat_turn_received') return;
  const identity = identities.get(conversationId) || { visits: new Set(), sessions: new Set() };
  for (const [field, values] of [['visit_id_hash', identity.visits], ['session_id_hash', identity.sessions]]) {
    const value = entry[field] || entry.details?.[field];
    if (typeof value === 'string' && value.trim() && value.length <= 128) values.add(value.trim());
  }
  identities.set(conversationId, identity);
}

function conversationVisitReference(identity) {
  if (!identity || identity.visits.size > 1) return null;
  if (identity.visits.size === 1) return reference(`visit:${[...identity.visits][0]}`);
  if (identity.sessions.size === 1) return reference(`session:${[...identity.sessions][0]}`);
  return null;
}

function groupConversationsByVisit(conversations) {
  const groups = new Map();
  for (const conversation of conversations) {
    // Missing or conflicting visit records never combine unrelated conversations.
    const id = conversation.visitReference ? `visit-${conversation.visitReference}` : `unlinked-${reference(conversation.conversationId)}`;
    const group = groups.get(id) || { id, visitReference: conversation.visitReference, conversations: [] };
    group.conversations.push(conversation);
    groups.set(id, group);
  }
  return [...groups.values()].map((group) => {
    group.conversations.sort((a, b) => (Date.parse(a.startedAt) || Infinity) - (Date.parse(b.startedAt) || Infinity)
      || a.conversationId.localeCompare(b.conversationId));
    const times = group.conversations.flatMap((item) => [item.startedAt, item.updatedAt]).filter(Boolean)
      .sort((a, b) => Date.parse(a) - Date.parse(b));
    return { ...group, conversationCount: group.conversations.length, startedAt: times[0] || null, updatedAt: times.at(-1) || null,
      messageCount: group.conversations.reduce((total, item) => total + item.messageCount, 0),
      responseCount: group.conversations.reduce((total, item) => total + item.responseCount, 0),
      feedbackCount: group.conversations.reduce((total, item) => total + item.feedbackCount, 0) };
  }).sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || a.id.localeCompare(b.id));
}

module.exports = { rememberConversationVisit, conversationVisitReference, groupConversationsByVisit };
