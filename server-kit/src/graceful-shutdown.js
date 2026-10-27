'use strict';

function createShutdownHandler({ server, tracker, beginShutdown = () => {}, cleanup = async () => {}, forceCleanup = () => {},
  timeoutMs = 90000, exit = (code) => process.exit(code), logger = console } = {}) {
  if (!server || typeof server.close !== 'function' || !tracker || typeof tracker.waitForDrain !== 'function' || typeof tracker.getCounts !== 'function') {
    throw new TypeError('A server and work tracker are required for graceful shutdown.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) {
    throw new RangeError('Shutdown timeoutMs must be a positive integer no greater than 2147483647.');
  }
  if ([beginShutdown, cleanup, forceCleanup, exit].some(callback => typeof callback !== 'function')) {
    throw new TypeError('Shutdown hooks must be functions.');
  }
  let shutdownPromise;
  return function shutdown(signal) {
    if (shutdownPromise) return shutdownPromise;
    let startupFailure;
    shutdownPromise = Promise.resolve().then(async () => {
      logger.log(`Received ${signal}. Draining requests and background tasks...`);
      let timer;
      const deadline = new Promise((resolve) => {
        // Remain referenced so hung cleanup cannot keep the process alive forever.
        timer = setTimeout(() => resolve(false), timeoutMs);
      });
      const drain = (async () => {
        if (startupFailure) throw startupFailure.error;
        const httpClosed = new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
        await Promise.all([httpClosed, tracker.waitForDrain()]);
        await cleanup();
        return true;
      })();
      try {
        if (await Promise.race([drain, deadline])) {
          clearTimeout(timer);
          logger.log('Requests, background tasks, and resources drained. Exiting process.');
          exit(0);
          return;
        }
        logger.error('Shutdown deadline exceeded:', tracker.getCounts());
      } catch (error) {
        logger.error('Error during server shutdown:', error);
      }
      clearTimeout(timer);
      try {
        server.closeAllConnections?.();
      } catch (error) {
        logger.error('Unable to force-close HTTP connections:', error);
      }
      try {
        forceCleanup();
      } catch (error) {
        logger.error('Unable to force-close resources:', error);
      } finally {
        exit(1);
      }
    });
    // Mark the app as draining immediately; repeated signals share the promise
    // even if the application hook fails or re-enters this handler.
    try { beginShutdown(); } catch (error) { startupFailure = { error }; }
    return shutdownPromise;
  };
}

module.exports = { createShutdownHandler };
