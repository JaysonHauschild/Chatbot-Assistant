'use strict';

const fs = require('fs');
const path = require('path');

function parseJsonLine(line) {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function appendJsonLine(logPath, entry, options = {}) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
    return true;
  } catch (error) {
    options.onError?.(error);
    return false;
  }
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split('\n');
}

function getDailyLogDateStamp(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('A valid Date is required to build a daily log filename.');
  }

  return [
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    date.getFullYear(),
  ].join('-');
}

function getDailyLogPath(
  baseLogPath,
  date = new Date(),
  defaultExtension = '.jsonl',
) {
  const parsed = path.parse(baseLogPath);
  const extension = parsed.ext || defaultExtension;
  const baseName = parsed.ext ? parsed.name : parsed.base;

  return path.join(
    parsed.dir,
    `${baseName}-${getDailyLogDateStamp(date)}${extension}`,
  );
}

function escapeRegexLiteral(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseDailyLogPath(filePath, baseLogPath) {
  const configured = path.parse(baseLogPath);
  const candidate = path.parse(filePath);
  const extension = configured.ext || '.jsonl';
  const baseName = configured.ext ? configured.name : configured.base;
  const pattern = new RegExp(
    `^${escapeRegexLiteral(baseName)}-(\\d{2})-(\\d{2})-(\\d{4})${escapeRegexLiteral(extension)}$`,
  );
  const match = candidate.base.match(pattern);

  if (!match) return null;
  const [, month, day, year] = match;
  return Number(`${year}${month}${day}`);
}

function listDailyLogPaths(baseLogPath) {
  const configuredDir = path.dirname(baseLogPath);
  const logPaths = [];

  if (fs.existsSync(baseLogPath)) {
    logPaths.push({ filePath: baseLogPath, sortKey: 0 });
  }

  if (!fs.existsSync(configuredDir)) {
    return logPaths.map((entry) => entry.filePath);
  }

  for (const filename of fs.readdirSync(configuredDir)) {
    const filePath = path.join(configuredDir, filename);
    if (filePath === baseLogPath) continue;

    const sortKey = parseDailyLogPath(filePath, baseLogPath);
    if (!sortKey || !fs.statSync(filePath).isFile()) continue;
    logPaths.push({ filePath, sortKey });
  }

  return logPaths
    .sort(
      (left, right) =>
        left.sortKey - right.sortKey ||
        left.filePath.localeCompare(right.filePath),
    )
    .map((entry) => entry.filePath);
}

function readDailyJsonLines(baseLogPath) {
  return listDailyLogPaths(baseLogPath).flatMap(readJsonLines);
}

module.exports = {
  appendJsonLine,
  getDailyLogDateStamp,
  getDailyLogPath,
  listDailyLogPaths,
  parseDailyLogPath,
  parseJsonLine,
  readDailyJsonLines,
  readJsonLines,
};
