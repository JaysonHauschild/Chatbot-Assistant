'use strict';

function getBearerToken(request) {
  const header = request?.headers?.authorization;
  return typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice(7)
    : null;
}

function createBearerAuthMiddleware(options = {}) {
  if (typeof options.verifyToken !== 'function') {
    throw new TypeError('createBearerAuthMiddleware requires verifyToken.');
  }

  const allowedRoles = new Set(options.allowedRoles || []);
  const roleClaim = options.roleClaim || 'role';
  const requestProperty = options.requestProperty || 'auth';
  const missingMessage =
    options.missingMessage || 'Authentication required.';
  const forbiddenMessage =
    options.forbiddenMessage || 'Access is not allowed.';
  const invalidMessage =
    options.invalidMessage || 'Invalid or expired session.';

  return function requireBearerAuth(request, response, next) {
    const token = getBearerToken(request);
    if (!token) {
      return response.status(401).json({ error: missingMessage });
    }

    try {
      const payload = options.verifyToken(token);
      const role = payload?.[roleClaim];
      if (
        !payload ||
        (allowedRoles.size > 0 && !allowedRoles.has(role))
      ) {
        return response.status(403).json({ error: forbiddenMessage });
      }

      request[requestProperty] = payload;
      return next();
    } catch {
      return response.status(401).json({ error: invalidMessage });
    }
  };
}

module.exports = {
  createBearerAuthMiddleware,
  getBearerToken,
};
