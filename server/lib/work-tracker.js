'use strict';

const { createWorkTracker } = require('server-kit/work-tracker');

// One application-owned tracker shared by routes, alerts, and startup work.
const workTracker = createWorkTracker();
module.exports = { createWorkTracker, workTracker };
