'use strict';

const { notifyChatError } = require('./gemini-usage-alert');
const { workTracker } = require('./work-tracker');

// Install before request parsing and rate limiting so their failures count too.
function createChatErrorAlertMiddleware(notify = notifyChatError) {
  return (_req, res, next) => {
    let reported = false;
    const report = (operation) => {
      if (reported) return;
      reported = true;
      void workTracker.trackBackgroundTask(() => Promise.resolve().then(() => notify(null, operation))).catch(() => {
        console.error('Chat request alert failed.');
      });
    };
    res.locals.reportChatError = report;
    res.once('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        report(`Chat HTTP ${res.statusCode}`);
      }
    });
    res.once('close', () => {
      if (!res.writableFinished) report('Chat connection closed before response completed');
    });
    next();
  };
}

module.exports = { createChatErrorAlertMiddleware };
