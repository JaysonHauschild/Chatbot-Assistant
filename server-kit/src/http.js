'use strict';

const fs = require('fs');

const PRIVATE_NETWORK_ORIGIN_PATTERN =
  /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/i;

function createCorsOriginCallback(options = {}) {
  const allowedOrigins = new Set(options.allowedOrigins || []);
  const allowAnyOrigin = options.allowAnyOrigin === true;
  const allowPrivateNetwork = options.allowPrivateNetwork !== false;
  const privateNetworkPattern =
    options.privateNetworkPattern || PRIVATE_NETWORK_ORIGIN_PATTERN;

  return function validateOrigin(origin, callback) {
    const isPrivateNetworkOrigin =
      allowPrivateNetwork &&
      typeof origin === 'string' &&
      privateNetworkPattern.test(origin);
    const allowed =
      !origin ||
      allowAnyOrigin ||
      allowedOrigins.has(origin) ||
      isPrivateNetworkOrigin;

    if (allowed) {
      callback(null, true);
      return;
    }

    options.onBlocked?.(origin);
    callback(
      new Error(
        typeof options.errorMessage === 'function'
          ? options.errorMessage(origin)
          : `CORS: origin '${origin}' not allowed`,
      ),
    );
  };
}

function setNoStoreHeaders(response) {
  response.setHeader('Cache-Control', 'no-store');
}

function createLivenessPayload(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const uptimeSeconds = Number.isFinite(options.uptimeSeconds)
    ? options.uptimeSeconds
    : Math.floor(process.uptime());

  return {
    ok: true,
    status: 'alive',
    ...(options.version ? { version: options.version } : {}),
    uptimeSeconds,
    timestamp: now.toISOString(),
  };
}

function mountStaticSpa(options = {}) {
  const {
    app,
    staticMiddleware,
    distPath,
    indexPath,
    routes = ['/'],
  } = options;

  if (!app || typeof app.use !== 'function' || typeof app.get !== 'function') {
    throw new TypeError('mountStaticSpa requires an application.');
  }
  if (typeof staticMiddleware !== 'function') {
    throw new TypeError('mountStaticSpa requires staticMiddleware.');
  }
  if (!distPath || !indexPath || !fs.existsSync(indexPath)) {
    return false;
  }

  app.use(staticMiddleware(distPath));
  for (const route of routes) { 
    app.get(route, (_request, response) => response.sendFile(indexPath));
  }
  return true;
}

module.exports = {
  PRIVATE_NETWORK_ORIGIN_PATTERN,
  createCorsOriginCallback,
  createLivenessPayload,
  mountStaticSpa,
  setNoStoreHeaders,
};
