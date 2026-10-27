/**
 * routes/auth.js — Authentication route.
 *
 * POST /chatbot/api/auth/login  — Validates dashboard account credentials and issues a JWT.
 */

'use strict';

const express = require('express');
const jwt     = require('jsonwebtoken');
const { createBearerAuthMiddleware } = require('server-kit');
const {
  authenticateDashboardAccount,
  hasDashboardAccounts,
  completeDashboardOnboarding,
  getDashboardAccount,
  getAccountSessionVersion,
} = require('../lib/dashboard-accounts');

const router = express.Router();

function issueSession(account) {
  const passwordResetRequired = account.passwordResetRequired === true && account.onboardingRequired !== true;
  const onboardingRequired = account.onboardingRequired === true || passwordResetRequired;
  const token = jwt.sign(
    { sub: account.id, username: account.username, role: onboardingRequired ? 'onboarding' : (account.role || 'dashboard'),
      sessionVersion: getAccountSessionVersion(account) },
    process.env.JWT_SECRET || 'dev_secret_change_me',
    { expiresIn: onboardingRequired ? '30m' : '8h' },
  );
  return {
    token,
    onboardingRequired,
    passwordResetRequired,
    user: {
      username: account.username,
      role: account.role || 'dashboard',
      firstName: account.firstName ?? null,
      lastName: account.lastName ?? null,
      email: account.email ?? null,
    },
  };
}

// Authenticates a dashboard operator and issues a short-lived JWT (8 h).
router.post('/login', (req, res) => {
  if (!hasDashboardAccounts()) {
    return res.status(500).json({ error: 'Dashboard authentication is not configured. Create a dashboard account before logging in.' });
  }

  const { username, password } = req.body ?? {};

  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Username is required.' });
  }

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password is required.' });
  }

  const account = authenticateDashboardAccount(username, password);

  if (!account) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }

  return res.json(issueSession(account));
});

const requireOnboarding = createBearerAuthMiddleware({
  verifyToken: (token) => jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_change_me'),
  allowedRoles: ['onboarding'],
  requestProperty: 'onboardingUser',
  forbiddenMessage: 'This session cannot complete account onboarding.',
  invalidMessage: 'Onboarding session expired. Please log in again with your temporary password.',
});

router.post('/onboarding', requireOnboarding, (req, res) => {
  try {
    const currentAccount = getDashboardAccount(req.onboardingUser.sub);
    if (!currentAccount || (req.onboardingUser.sessionVersion ?? 0) !== getAccountSessionVersion(currentAccount)) {
      return res.status(401).json({ error: 'Onboarding session expired. Please log in again with your temporary password.' });
    }
    const account = completeDashboardOnboarding(req.onboardingUser.sub, req.body ?? {});
    return res.json(issueSession(account));
  } catch (error) {
    if (error.status === 400 || error.status === 401) {
      return res.status(error.status).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Unable to save your account. Please try again or contact your administrator.' });
  }
});

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Express middleware that enforces JWT authentication on dashboard routes.
 * Import { requireAuth } from this module on any route that needs protection.
 *
 * @param {import('express').Request}      req
 * @param {import('express').Response}     res
 * @param {import('express').NextFunction}  next
 */
const requireAuth = createBearerAuthMiddleware({
  verifyToken: (token) => {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_change_me');
    // Account-issued sessions stop working immediately after deletion or a role change.
    if (payload.sub && payload.role !== 'onboarding') {
      const account = getDashboardAccount(payload.sub);
      if (!account || account.active === false || account.onboardingRequired === true || account.passwordResetRequired === true ||
        (payload.sessionVersion ?? 0) !== getAccountSessionVersion(account) ||
        (account.role || 'dashboard') !== payload.role) throw new Error('Account session is no longer valid.');
    }
    return payload;
  },
  allowedRoles: ['dashboard', 'admin', 'readonly'],
  requestProperty: 'dashboardUser',
  forbiddenMessage:
    'Dashboard access is not allowed for this account.',
  invalidMessage:
    'Invalid or expired session. Please log in again.',
});

module.exports = router;
module.exports.requireAuth = requireAuth;
