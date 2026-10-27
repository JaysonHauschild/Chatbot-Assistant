'use strict';
const express = require('express');
const { requireAuth } = require('./auth');
const { listDashboardAccounts, getDashboardAccount, provisionDashboardAccount,
  updateDashboardAccountRole, deleteDashboardAccount, validateUsername, normalizeUsername,
  resetDashboardAccountPassword, setDashboardAccountLocked, revokeDashboardAccountSessions } = require('../lib/dashboard-accounts');
const { appendDashboardAuditLog } = require('../util/logger');
const router = express.Router();

const publicAccount = (account) => ({ id: account.id, username: account.username, role: account.role || 'dashboard',
  firstName: account.firstName ?? null, lastName: account.lastName ?? null, email: account.email ?? null,
  active: account.active !== false, onboardingRequired: account.onboardingRequired === true,
  locked: account.locked === true, passwordResetRequired: account.passwordResetRequired === true,
  createdAt: account.createdAt, updatedAt: account.updatedAt });

router.use(requireAuth, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.dashboardUser.role !== 'admin' || !req.dashboardUser.sub) {
    return res.status(403).json({ error: 'Only administrators can manage dashboard users.' });
  }
  return next();
});

function audit(req, event, account, details = {}) {
  appendDashboardAuditLog({ timestamp: new Date().toISOString(), action: event,
    actor: { username: req.dashboardUser.username, subject: req.dashboardUser.sub, role: 'admin' },
    target: { type: 'dashboard_user', id: account.id },
    details: { account_id: account.id, username: account.username, ...details } });
}

router.get('/', (req, res) => {
  try { return res.json({ currentUserId: req.dashboardUser.sub, users: listDashboardAccounts().map(publicAccount) }); }
  catch { return res.status(500).json({ error: 'Unable to load dashboard users.' }); }
});

router.post('/', (req, res) => {
  const { username, role = 'readonly' } = req.body || {};
  if (typeof username !== 'string' || !validateUsername(username) || !['admin', 'dashboard', 'readonly'].includes(role)) {
    return res.status(400).json({ error: 'Enter a username of 3–80 letters, numbers, dots, underscores, hyphens, or @, and choose a valid role.' });
  }
  try {
    if (listDashboardAccounts().some((account) => account.username === normalizeUsername(username))) {
      return res.status(409).json({ error: 'That username already exists.' });
    }
    const { account, temporaryPassword } = provisionDashboardAccount(username, { role });
    audit(req, 'dashboard_user_created', account, { role });
    return res.status(201).json({ user: publicAccount(account), temporaryPassword });
  } catch { return res.status(500).json({ error: 'Unable to create the dashboard user.' }); }
});

router.put('/:id/role', (req, res) => {
  try {
    const account = getDashboardAccount(req.params.id);
    if (!account) return res.status(404).json({ error: 'User not found.' });
    if (account.id === req.dashboardUser.sub) return res.status(400).json({ error: 'You cannot change your own role.' });
    const updated = updateDashboardAccountRole(account.id, req.body?.role);
    audit(req, 'dashboard_user_role_changed', account, { previous_role: account.role, role: updated.role });
    return res.json({ user: publicAccount(updated) });
  } catch (error) { return res.status(error.status || 500).json({ error: error.status === 400 ? error.message : 'Unable to change the user role.' }); }
});

router.delete('/:id', (req, res) => {
  try {
    const account = getDashboardAccount(req.params.id);
    if (!account) return res.status(404).json({ error: 'User not found.' });
    if (account.id === req.dashboardUser.sub) return res.status(400).json({ error: 'You cannot delete your own account.' });
    deleteDashboardAccount(account.id);
    audit(req, 'dashboard_user_deleted', account, { role: account.role });
    return res.status(204).send();
  } catch { return res.status(500).json({ error: 'Unable to delete the dashboard user.' }); }
});

router.post('/:id/reset-password', (req, res) => {
  try {
    const account = getDashboardAccount(req.params.id);
    if (!account) return res.status(404).json({ error: 'User not found.' });
    if (account.id === req.dashboardUser.sub) return res.status(400).json({ error: 'Ask another administrator to reset your password.' });
    const reset = resetDashboardAccountPassword(account.id);
    audit(req, 'dashboard_user_password_reset', account);
    return res.json({ user: publicAccount(reset.account), temporaryPassword: reset.temporaryPassword });
  } catch { return res.status(500).json({ error: 'Unable to reset the password.' }); }
});

router.put('/:id/lock', (req, res) => {
  try {
    const account = getDashboardAccount(req.params.id);
    if (!account) return res.status(404).json({ error: 'User not found.' });
    if (account.id === req.dashboardUser.sub && req.body?.locked === true) return res.status(400).json({ error: 'You cannot lock your own account.' });
    const updated = setDashboardAccountLocked(account.id, req.body?.locked);
    audit(req, updated.locked ? 'dashboard_user_locked' : 'dashboard_user_unlocked', account);
    return res.json({ user: publicAccount(updated) });
  } catch (error) { return res.status(error.status || 500).json({ error: error.status === 400 ? error.message : 'Unable to change account lock status.' }); }
});

router.post('/:id/revoke-sessions', (req, res) => {
  try {
    const account = getDashboardAccount(req.params.id);
    if (!account) return res.status(404).json({ error: 'User not found.' });
    const updated = revokeDashboardAccountSessions(account.id);
    audit(req, 'dashboard_user_sessions_revoked', account);
    return res.json({ user: publicAccount(updated) });
  } catch { return res.status(500).json({ error: 'Unable to revoke active sessions.' }); }
});

module.exports = router;
