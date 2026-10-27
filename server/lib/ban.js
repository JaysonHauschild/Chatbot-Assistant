'use strict';

const path = require('path');
const {
  createTemporaryBanStore,
  isTruthyValue,
  redactSensitiveText,
} = require('server-kit');
const { createRedisBanStore } = require('./redis-ban-store');
const { getRedisClient, isRedisConfigured } = require('./redis-client');

const TEMP_BAN_DURATION_MS = 24 * 60 * 60 * 1000;
const BAN_THRESHOLD = 5;
const BAN_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_EXEMPTION_DURATION_MS = 60 * 60 * 1000;
const MAX_EXEMPTION_DURATION_MS = 24 * 60 * 60 * 1000;

// RELEASE BLOCKER: enforcement is intentionally opt-in during internal testing.
// Violation counting and would-ban logging remain active regardless of this flag.
const BAN_ENFORCEMENT_ENABLED = isTruthyValue(process.env.BAN_ENFORCEMENT_ENABLED);

// Bans/violations/exemptions are shared across instances via Redis when
// REDIS_URL is configured; otherwise this falls back to the existing
// file-backed store (bans) and an in-memory Map (exemptions), exactly as
// before. Either way, every exported function below is async so call sites
// don't need to know or care which backend is active.
const usingRedis = isRedisConfigured();

const fileBanStore = usingRedis
  ? null
  : createTemporaryBanStore({
    getFilePath: () =>
      process.env.BAN_STORE_PATH ||
      path.join(__dirname, '..', 'data', 'ban-store.json'),
    durationMs: TEMP_BAN_DURATION_MS,
    threshold: BAN_THRESHOLD,
    windowMs: BAN_WINDOW_MS,
  });

const redisBanStore = usingRedis
  ? createRedisBanStore({
    getClient: getRedisClient,
    durationMs: TEMP_BAN_DURATION_MS,
    threshold: BAN_THRESHOLD,
    windowMs: BAN_WINDOW_MS,
    defaultExemptionDurationMs: DEFAULT_EXEMPTION_DURATION_MS,
    maxExemptionDurationMs: MAX_EXEMPTION_DURATION_MS,
  })
  : null;

const banStore = usingRedis ? redisBanStore : fileBanStore;

async function applyTempBan(request, params) {
  return banStore.applyForRequest(request, {
    conversationId: params.conversationId,
    turn: params.turn,
    blockedByRule: params.blockedByRule,
    triggerMessageRedacted: redactSensitiveText(params.message || ''),
  });
}

async function getActiveBanForRequest(request) {
  return banStore.getActiveForRequest(request);
}

async function recordViolation(banKey) {
  return banStore.recordViolation(banKey);
}

function getBanEnforcementDecision(violationCount, isExempt = false) {
  const thresholdReached = Number.isFinite(violationCount) && violationCount >= BAN_THRESHOLD;
  const wouldApplyBan = thresholdReached && !isExempt;

  return {
    enforcementEnabled: BAN_ENFORCEMENT_ENABLED,
    thresholdReached,
    wouldApplyBan,
    shouldApplyBan: BAN_ENFORCEMENT_ENABLED && wouldApplyBan,
  };
}

async function getBans() {
  return banStore.list();
}

async function deleteBan(banKey) {
  return banStore.remove(banKey);
}

async function clearAllBans() {
  return banStore.clear();
}

function getRequestBanIdentity(request) {
  return banStore.getRequestIdentity(request);
}

// In-memory, non-persisted exemption fallback used only when Redis isn't
// configured, granted by an authenticated dashboard operator so a known
// client (e.g. running a burst/load test directly against staging or
// production) is immune to ban escalation for a short window without
// changing the global enforcement setting. When enforcement is enabled, the
// exemption remains deliberately scoped per-identity and time-boxed. When Redis
// is configured, redisBanStore's exemption keys (with native TTL) are used
// instead so exemptions are honored across all instances, not just the one
// that granted them.
const inMemoryExemptions = new Map();

function pruneExpiredInMemoryExemptions() {
  const now = Date.now();
  for (const [banKey, expiresAt] of inMemoryExemptions.entries()) {
    if (expiresAt <= now) inMemoryExemptions.delete(banKey);
  }
}

async function grantBanExemption(request, durationMs = DEFAULT_EXEMPTION_DURATION_MS) {
  if (usingRedis) return redisBanStore.grantExemption(request, durationMs);

  const identity = fileBanStore.getRequestIdentity(request);
  const clampedDurationMs = Number.isFinite(durationMs) && durationMs > 0
    ? Math.min(durationMs, MAX_EXEMPTION_DURATION_MS)
    : DEFAULT_EXEMPTION_DURATION_MS;
  const expiresAt = Date.now() + clampedDurationMs;

  inMemoryExemptions.set(identity.banKey, expiresAt);
  fileBanStore.remove(identity.banKey);

  return { ...identity, expiresAt };
}

async function isBanExempt(banKey) {
  if (usingRedis) return redisBanStore.isExempt(banKey);

  pruneExpiredInMemoryExemptions();
  const expiresAt = inMemoryExemptions.get(banKey);
  return typeof expiresAt === 'number' && expiresAt > Date.now();
}

async function revokeBanExemption(banKey) {
  if (usingRedis) return redisBanStore.revokeExemption(banKey);

  return inMemoryExemptions.delete(banKey);
}

async function listBanExemptions() {
  if (usingRedis) return redisBanStore.listExemptions();

  pruneExpiredInMemoryExemptions();
  return [...inMemoryExemptions.entries()].map(([banKey, expiresAt]) => ({ banKey, expiresAt }));
}

module.exports = {
  BAN_ENFORCEMENT_ENABLED,
  BAN_THRESHOLD,
  BAN_WINDOW_MS,
  DEFAULT_EXEMPTION_DURATION_MS,
  MAX_EXEMPTION_DURATION_MS,
  applyTempBan,
  clearAllBans,
  deleteBan,
  getActiveBanForRequest,
  getBanEnforcementDecision,
  getBans,
  getRequestBanIdentity,
  grantBanExemption,
  isBanExempt,
  listBanExemptions,
  recordViolation,
  revokeBanExemption,
};
