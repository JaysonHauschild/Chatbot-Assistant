'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { getDashboardAccount, getAccountSessionVersion } = require('./dashboard-accounts');

const context = new AsyncLocalStorage();
const audience = 'live-chat-test';
const secret = () => process.env.JWT_SECRET || 'dev_secret_change_me';

function createLiveChatTestSession(user) {
  const token = jwt.sign({
    role: 'live-chat-test',
    ...(user.sub ? { sub: user.sub } : {}),
    sessionVersion: user.sessionVersion ?? 0,
    dashboardRole: user.role,
  }, secret(), { audience, expiresIn: '30m', jwtid: randomUUID() });
  return { token, expiresAt: new Date(jwt.decode(token).exp * 1000).toISOString() };
}

function liveChatTestMiddleware(req, res, next) {
  const token = req.get('X-Live-Chat-Test');
  const conversationIds = [req.body?.conversationId, req.query?.conversationId];
  if (!token) {
    const identifiers = [...conversationIds, req.body?.sessionId, req.query?.sessionId, req.get('X-Session-Id')];
    if (identifiers.some(value => typeof value === 'string' && value.trim().startsWith('live-test-'))) {
      return res.status(401).json({ error: 'Live test authorization is required. Start a new test from the dashboard.' });
    }
    return next();
  }
  try {
    const payload = jwt.verify(token, secret(), { audience, algorithms: ['HS256'] });
    if (payload.role !== 'live-chat-test' || !payload.jti || !['admin', 'dashboard'].includes(payload.dashboardRole)) throw new Error('Invalid test session');
    if (payload.sub) {
      const account = getDashboardAccount(payload.sub);
      if (!account || account.active === false || account.onboardingRequired || account.passwordResetRequired ||
          getAccountSessionVersion(account) !== payload.sessionVersion || (account.role || 'dashboard') !== payload.dashboardRole) throw new Error('Session revoked');
    }
    const prefix = `live-test-${payload.jti}-`;
    if (conversationIds.some(value => value && (typeof value !== 'string' || !value.startsWith(prefix)))) {
      return res.status(403).json({ error: 'This conversation does not belong to the live test session.' });
    }
    req.liveChatTest = { prefix, startedAt: Date.now() };
    res.set('Cache-Control', 'no-store');
    return context.run(req.liveChatTest, next);
  } catch {
    return res.status(401).json({ error: 'Live test session expired or was revoked. Start a new test from the dashboard.' });
  }
}

module.exports = { createLiveChatTestSession, liveChatTestMiddleware, getLiveChatTestContext: () => context.getStore() };
