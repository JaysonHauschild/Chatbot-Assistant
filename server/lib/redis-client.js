'use strict';

// Lazy singleton Redis client shared by any store that wants cross-instance
// state (currently server/lib/ban.js). Redis is opt-in: with no REDIS_URL
// set, isRedisConfigured() is false and every consumer falls back to its
// existing per-process/file-backed behavior, so a single-instance deployment
// is unaffected.
const Redis = require('ioredis');

const redisUrl = typeof process.env.REDIS_URL === 'string' ? process.env.REDIS_URL.trim() : '';

let client = null;

function isRedisConfigured() {
  return redisUrl.length > 0;
}

function getRedisClient() {
  if (!isRedisConfigured()) return null;

  if (!client) {
    client = new Redis(redisUrl, {
      // Cap reconnect backoff so a dead Redis retries steadily instead of
      // hammering it or growing an unbounded delay.
      retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
      maxRetriesPerRequest: 1,
      lazyConnect: false,
    });

    // ioredis emits 'error' for every failed connection/command; without a
    // listener Node treats those as uncaught and crashes the process. Log
    // and let callers handle failures per-operation instead (fail open).
    client.on('error', (error) => {
      console.error('Redis client error:', error.message);
    });
  }

  return client;
}

module.exports = {
  getRedisClient,
  isRedisConfigured,
  async closeRedisClient() {
    if (!client || client.status === 'end') return;
    try {
      await client.quit();
    } finally {
      client.disconnect();
    }
  },
  disconnectRedisClient() {
    client?.disconnect();
  },
};
