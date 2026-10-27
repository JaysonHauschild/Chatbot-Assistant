# Documentation Website

The OKSBDC documentation website combines the repository's Markdown documentation into a static, searchable site. It uses the existing chatbot logo, navy and red colors, grouped navigation, an on-page table of contents, code-copy buttons, Markdown downloads, and a responsive layout.

## Build and preview

Install the client dependencies once with `npm ci --prefix client`, then run from the repository root:

```sh
npm run docs:build
npm run docs:serve
```

Open **http://localhost:4174**. Set `DOCS_PORT` to use another preview port. You can also open `docs/site/dist/index.html` directly; navigation and search work without a server. Clipboard access may fall back to selecting the code when opened as a local file.

## Update documentation

The Vite development server and preview server also serve `/chatbot/docs/` before the chatbot fallback. `npm run dev --prefix client` builds the docs before starting Vite. `npm run build --prefix client` builds the docs first and copies the site into `client/dist/docs/`, so frontend-only deployments include it too. Restart an already-running Vite process after updating its configuration; static deployments need the rebuilt `client/dist/` uploaded. A reverse proxy that forces all paths to the chatbot HTML must serve existing files/directories before its SPA fallback.

Edit the original Markdown files and run `npm run docs:build` again. The build discovers Markdown throughout the repository, including `docs/`, `server/docs/`, root instructions, and component READMEs. It excludes `docs/archive/`, hidden directories, dependencies, build output, runtime logs, data stores, and coverage output. Retired reviews belong in `docs/archive/`; they are excluded from navigation, search, source downloads, and attachment copying. It preserves Markdown text, renders GitHub-style tables and task lists, and rewrites relative documentation links to generated HTML pages.

The site is generated with the client's existing React Markdown and GFM dependencies. No network services, CDN assets, API keys, database, or browser-side Markdown renderer are required. Raw HTML in Markdown is displayed as text rather than executed.

## Site files

- `build.mjs`: discovers Markdown, generates HTML, navigation, heading anchors, source downloads, and the search index.
- `style.css`: responsive OKSBDC theme and print styling.
- `app.js`: local full-text search, mobile navigation, code copying, and active section highlighting.
- `serve.mjs`: local preview server, bound to the loopback interface.
- `vite-plugin.mjs`: serves docs in Vite development/preview and copies them into the frontend build.
- `dist/`: generated static site; do not edit its contents directly.

## Static hosting

The main chatbot server publicly serves the generated site at `/chatbot/docs/` on its own host and port (locally, http://localhost:3001/chatbot/docs/). Requests to `/chatbot/docs` redirect to the trailing-slash URL so relative links work. This route does not require a dashboard login. Run the root `npm run build` to build both the chatbot frontend and documentation before deployment. Express checks `docs/site/dist/` first, then `client/dist/docs/`; deploy matching rebuilt copies if both are present so an older standalone docs build cannot mask the frontend copy. Missing documentation pages return HTTP 404.

The docs route uses a same-origin content security policy without `upgrade-insecure-requests`, allowing styles, scripts, and navigation to work when accessing Express directly over HTTP. Relative resources continue to use HTTPS when the page is served over HTTPS. Other chatbot routes retain their existing security policy.

Copy the contents of `docs/site/dist/` to a static host. All site links and assets are relative, so the site can be hosted at the domain root or in a subdirectory without SPA rewrite rules. The complete generated site includes the original Markdown downloads and local HTML documentation attachments.

The build does not deploy anything or add authentication. The chatbot server's `/chatbot/docs/` route is public and includes the generated Markdown downloads for active documentation. Archived reviews are not published.
