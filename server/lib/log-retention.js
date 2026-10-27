'use strict';

const retention = require('server-kit/log-retention');

const LOG_RETENTION_DAYS = 90;
const sourcesFor = config => [
  { filePath: config.aiResponseLogPath, daily: true },
  { filePath: config.humanReadableLogPath, daily: true },
  { filePath: config.conversationStatusLogPath, daily: true },
  { filePath: config.dashboardAuditLogPath },
];

function pruneExpiredLogs(config, now = new Date()) {
  return retention.pruneExpiredLogs(sourcesFor(config), { now, retentionDays: LOG_RETENTION_DAYS });
}

function startLogRetention(config, options = {}) {
  return retention.startLogRetention(sourcesFor(config), { ...options, retentionDays: LOG_RETENTION_DAYS });
}

module.exports = { LOG_RETENTION_DAYS, pruneExpiredLogs, startLogRetention };
