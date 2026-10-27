'use strict';

const express = require('express');
const helmet = require('helmet');
const path = require('node:path');

function createDocsRouter({ directories = [
  path.join(__dirname, '..', '..', 'docs', 'site', 'dist'),
  path.join(__dirname, '..', '..', 'client', 'dist', 'docs'),
] } = {}) {
  const router = express.Router();
  // Direct Express access can use HTTP. Preserve the page's scheme for its
  // relative assets and navigation instead of upgrading them to an HTTPS port
  // that does not exist. HTTPS deployments still use HTTPS for relative URLs.
  router.use(helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'"],
      upgradeInsecureRequests: null,
    },
  }));
  for (const directory of directories) router.use(express.static(directory));
  router.use((_req, res) => res.status(404).type('text/plain').send('Documentation page not found.'));
  return router;
}

module.exports = { createDocsRouter };
