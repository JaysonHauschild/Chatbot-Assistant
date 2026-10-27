import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const docsRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8', '.pdf': 'application/pdf' };

export default function docsSite() {
  let config;
  function mount(server) {
    const prefix = `${config.base.replace(/\/$/, '')}/docs`;
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return next();
      if (url.pathname === prefix) {
        res.writeHead(301, { Location: `${prefix}/${url.search}` });
        return res.end();
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        return res.end();
      }
      try {
        const relative = decodeURIComponent(url.pathname.slice(prefix.length));
        const file = path.resolve(docsRoot, `.${relative.endsWith('/') ? `${relative}index.html` : relative}`);
        if (!file.startsWith(`${docsRoot}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('Documentation page not found.');
        }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
        if (req.method === 'HEAD') return res.end();
        const stream = fs.createReadStream(file);
        stream.on('error', () => res.destroy());
        stream.pipe(res);
      } catch {
        res.writeHead(400);
        res.end('Bad request.');
      }
    });
  }
  return {
    name: 'oksbdc-docs',
    configResolved(resolved) { config = resolved; },
    configureServer: mount,
    configurePreviewServer: mount,
    closeBundle() {
      if (config.command !== 'build') return;
      if (!fs.existsSync(path.join(docsRoot, 'index.html'))) throw new Error('Run npm run docs:build before building the frontend.');
      const destination = path.resolve(config.root, config.build.outDir, 'docs');
      fs.cpSync(docsRoot, destination, { recursive: true });
    },
  };
}
