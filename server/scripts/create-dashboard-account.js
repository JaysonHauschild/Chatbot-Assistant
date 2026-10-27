#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { provisionDashboardAccount, getAccountsPath } = require('../lib/dashboard-accounts');

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Usage: npm run dashboard:create-user -- --username <username> [--role dashboard|admin|readonly]');
    console.log('Creates an account with a generated temporary password. The user completes their profile and chooses a new password on first login.');
    return;
  }
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const [flag, ...inline] = args[index].split('=');
    if (!['--username', '--role'].includes(flag) || options[flag] !== undefined) {
      throw new Error('Provide --username <username> and optionally --role dashboard|admin|readonly.');
    }
    const value = inline.length ? inline.join('=') : args[++index];
    if (!value || value.startsWith('--')) throw new Error(`A value is required for ${flag}.`);
    options[flag] = value;
  }
  const username = options['--username'];
  if (!username || username.startsWith('--')) {
    throw new Error('Provide --username <username>. Password, name, and email are set during first-login onboarding.');
  }
  const { account, temporaryPassword } = provisionDashboardAccount(username, { role: options['--role'] || 'dashboard' });
  console.log(`Created dashboard account "${account.username}" in ${getAccountsPath()}`);
  console.log(`Role: ${account.role}`);
  console.log(`Temporary password: ${temporaryPassword}`);
  console.log('Share these credentials privately with the user. This password is shown only now; first login requires a name, email, and new password.');
}

try {
  main();
} catch (error) {
  console.error(error.message || 'Unable to create dashboard account.');
  process.exitCode = 1;
}
