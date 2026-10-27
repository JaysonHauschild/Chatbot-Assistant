'use strict';

function createWorkTracker() {
  const requests = new Set();
  const backgroundTasks = new Set();
  const waiters = new Set();
  let drainCheckScheduled = false;

  function checkDrain() {
    if (drainCheckScheduled || !waiters.size) return;
    drainCheckScheduled = true;
    // Response finish/close listeners can enqueue follow-up work first.
    setImmediate(() => {
      drainCheckScheduled = false;
      if (requests.size || backgroundTasks.size) return;
      for (const resolve of waiters) resolve();
      waiters.clear();
    });
  }

  function begin(collection) {
    const token = Symbol();
    collection.add(token);
    return () => {
      collection.delete(token);
      checkDrain();
    };
  }

  function run(collection, operation) {
    const finish = begin(collection);
    try {
      return Promise.resolve(operation()).finally(finish);
    } catch (error) {
      finish();
      throw error;
    }
  }

  return {
    getCounts: () => ({ requests: requests.size, backgroundTasks: backgroundTasks.size }),
    trackBackgroundTask: (operation) => run(backgroundTasks, operation),
    trackHandler(handler) {
      if (typeof handler !== 'function') throw new TypeError('A handler function is required.');
      return function trackedHandler(...args) {
        return run(requests, () => handler.apply(this, args));
      };
    },
    requestMiddleware(_req, res, next) {
      const finish = begin(requests);
      const release = () => {
        res.off('finish', release);
        res.off('close', release);
        finish();
      };
      res.once('finish', release);
      res.once('close', release);
      next();
    },
    waitForDrain() {
      return new Promise((resolve) => {
        waiters.add(resolve);
        checkDrain();
      });
    },
  };
}

module.exports = { createWorkTracker };
