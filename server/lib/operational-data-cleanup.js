'use strict';

const fs = require('fs');
const path = require('path');
const { listDailyLogPaths } = require('server-kit');

const DEFAULT_SERVER_ROOT = path.join(__dirname, '..');

function resolveConfiguredPath(value, fallback, serverRoot = DEFAULT_SERVER_ROOT) {
  const configured = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return path.isAbsolute(configured) ? path.normalize(configured) : path.resolve(serverRoot, configured);
}

function requireExtension(filePath, expectedExtension, label) {
  if (path.extname(filePath).toLowerCase() !== expectedExtension) {
    throw new Error(`${label} must use a ${expectedExtension} extension: ${filePath}`);
  }
  return filePath;
}

function getOperationalDataPaths(env = process.env, serverRoot = DEFAULT_SERVER_ROOT) {
  const logsDir = path.join(serverRoot, 'logs');
  const aiResponseLogPath = requireExtension(
    resolveConfiguredPath(env.AI_RESPONSE_LOG_PATH, path.join(logsDir, 'ai-responses.jsonl'), serverRoot),
    '.jsonl',
    'AI_RESPONSE_LOG_PATH',
  );
  const humanReadableLogPath = requireExtension(
    resolveConfiguredPath(
      env.HUMAN_READABLE_LOG_PATH,
      path.join(path.dirname(aiResponseLogPath), 'conversation-transcript.md'),
      serverRoot,
    ),
    '.md',
    'HUMAN_READABLE_LOG_PATH',
  );
  const conversationStatusLogPath = requireExtension(
    resolveConfiguredPath(
      env.CONVERSATION_STATUS_LOG_PATH,
      path.join(logsDir, 'conversation-status.jsonl'),
      serverRoot,
    ),
    '.jsonl',
    'CONVERSATION_STATUS_LOG_PATH',
  );
  const dashboardAuditLogPath = requireExtension(
    resolveConfiguredPath(
      env.DASHBOARD_AUDIT_LOG_PATH,
      path.join(path.dirname(aiResponseLogPath), 'dashboard-audit.jsonl'),
      serverRoot,
    ),
    '.jsonl',
    'DASHBOARD_AUDIT_LOG_PATH',
  );

  return {
    aiResponseLogPath,
    humanReadableLogPath,
    conversationStatusLogPath,
    dashboardAuditLogPath,
  };
}

function collectOperationalDataFiles(config) {
  const candidates = [
    ...listDailyLogPaths(config.aiResponseLogPath).map((filePath) => ({
      category: 'chat and dashboard telemetry',
      filePath,
    })),
    ...listDailyLogPaths(config.conversationStatusLogPath).map((filePath) => ({
      category: 'conversation status telemetry',
      filePath,
    })),
    ...listDailyLogPaths(config.humanReadableLogPath).map((filePath) => ({
      category: 'human-readable chat transcript',
      filePath,
    })),
    { category: 'dashboard audit log', filePath: config.dashboardAuditLogPath },
  ];

  const filesByPath = new Map();
  for (const candidate of candidates) {
    const filePath = path.resolve(candidate.filePath);
    if (filesByPath.has(filePath) || !fs.existsSync(filePath)) continue;

    const stat = fs.lstatSync(filePath);
    if (!stat.isFile()) continue;
    filesByPath.set(filePath, {
      category: candidate.category,
      filePath,
      size: stat.size,
    });
  }

  return [...filesByPath.values()].sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function flushOperationalDataFiles(files, { dryRun = false } = {}) {
  const result = {
    deleted: [],
    wouldDelete: [],
    missing: [],
    failed: [],
  };

  for (const file of files) {
    if (dryRun) {
      result.wouldDelete.push(file);
      continue;
    }

    try {
      fs.unlinkSync(file.filePath);
      result.deleted.push(file);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        result.missing.push(file);
      } else {
        result.failed.push({ ...file, error: error?.message || String(error) });
      }
    }
  }

  return result;
}

module.exports = {
  DEFAULT_SERVER_ROOT,
  getOperationalDataPaths,
  collectOperationalDataFiles,
  flushOperationalDataFiles,
};
