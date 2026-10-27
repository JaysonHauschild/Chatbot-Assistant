'use strict';

const fs = require('node:fs');
const path = require('node:path');

function getArchivePath() {
  return process.env.DASHBOARD_CONVERSATION_ARCHIVE_PATH
    || path.join(__dirname, '..', 'data', 'archived-conversations.jsonl');
}

function readArchivedConversationIds() {
  let contents;
  try {
    contents = fs.readFileSync(getArchivePath(), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return new Set();
    throw error;
  }
  const archivedIds = new Set();
  for (const line of contents.split('\n').filter((line) => line.trim())) {
    const entry = JSON.parse(line);
    if (typeof entry.conversationId !== 'string' || !entry.conversationId) {
      throw new Error('Invalid conversation archive record.');
    }
    if (entry.archived === false) archivedIds.delete(entry.conversationId);
    else archivedIds.add(entry.conversationId);
  }
  return archivedIds;
}

function archiveConversation(conversationId) {
  if (readArchivedConversationIds().has(conversationId)) return;
  const archivePath = getArchivePath();
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  // Append only display metadata; source conversation logs are never modified.
  fs.appendFileSync(archivePath, `${JSON.stringify({ conversationId, archivedAt: new Date().toISOString() })}\n`, 'utf8');
}

function restoreConversation(conversationId) {
  if (!readArchivedConversationIds().has(conversationId)) return;
  // Preserve archive history and source logs; the latest visibility marker wins.
  fs.appendFileSync(getArchivePath(), `${JSON.stringify({ conversationId, archived: false, restoredAt: new Date().toISOString() })}\n`, 'utf8');
}

module.exports = { readArchivedConversationIds, archiveConversation, restoreConversation };
