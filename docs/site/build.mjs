import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8'));
const out = path.join(here, 'dist');
const requireClient = createRequire(path.join(root, 'client/package.json'));
const React = requireClient('react');
const { renderToStaticMarkup } = requireClient('react-dom/server');
const { default: Markdown } = await import(pathToFileURL(requireClient.resolve('react-markdown')));
const { default: gfm } = await import(pathToFileURL(requireClient.resolve('remark-gfm')));
const h = React.createElement;
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ignored = new Set(['node_modules', 'dist', 'dist-ssr', 'logs', 'data', 'coverage']);
function discover(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.') || ignored.has(entry.name)) return [];
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (file === path.join(root, 'docs', 'archive')) return [];
      return discover(file);
    }
    return entry.isFile() && /\.md$/i.test(entry.name) ? [path.relative(root, file).split(path.sep).join('/')] : [];
  });
}
const groups = ['Start here', 'Operations', 'Server reference', 'Components', 'Project reference'];
const names = {
  'docs/README.md': 'Documentation overview', 'README.md': 'Project overview',
  'server/docs/README.md': 'Server overview', 'client/README.md': 'Chat widget',
  'server-kit/README.md': 'Server kit', 'gemini-kit/README.md': 'Gemini kit',
  'CLAUDE.md': 'Contributor instructions', 'docs/site/README.md': 'Documentation website',
};
function group(file) {
  if (['docs/README.md', 'README.md', 'docs/DEVELOPER_GUIDE.md'].includes(file)) return groups[0];
  if (file.startsWith('docs/') && !file.startsWith('docs/site/')) return groups[1];
  if (file.startsWith('server/docs/')) return groups[2];
  if (file.includes('/') && !file.startsWith('docs/')) return groups[3];
  return groups[4];
}
const docs = discover(root).map(file => {
  const markdown = fs.readFileSync(path.join(root, file), 'utf8');
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1].replace(/[*`]/g, '');
  return { file, markdown, title: names[file] || heading || path.basename(file, '.md'), group: group(file),
    url: file === 'docs/README.md' ? 'index.html' : `${file.replace(/\.md$/i, '').replaceAll('/', '--').toLowerCase()}.html` };
}).sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group) ||
  (a.file === 'docs/README.md' ? -1 : b.file === 'docs/README.md' ? 1 : a.title.localeCompare(b.title)));
const byFile = new Map(docs.map(doc => [doc.file, doc]));
if (new Set(docs.map(doc => doc.url)).size !== docs.length) throw new Error('Documentation URL collision');
// This directory contains build output only; remove pages for deleted sources.
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const asset of ['style.css', 'app.js']) fs.copyFileSync(path.join(here, asset), path.join(out, asset));
fs.copyFileSync(path.join(root, 'client/public/chatbot-logo.png'), path.join(out, 'logo.png'));
const textOf = node => node.value ?? (node.children || []).map(textOf).join('');
function headingPlugin(headings) {
  return () => tree => {
    const seen = new Map();
    function walk(node) {
      if (node.type === 'heading') {
        const text = textOf(node);
        const base = text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-') || 'section';
        let id = base;
        let suffix = 0;
        while (seen.has(id)) id = `${base}-${++suffix}`;
        seen.set(id, true);
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };
        headings.push({ text, id, depth: node.depth });
      }
      node.children?.forEach(walk);
    }
    walk(tree);
  };
}
function localLink(href, doc) {
  if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return href;
  const match = href.match(/^([^?#]*)(.*)$/);
  const file = path.posix.normalize(path.posix.join(path.posix.dirname(doc.file), decodeURIComponent(match[1])));
  const target = byFile.get(file) || byFile.get(`${file.replace(/\/$/, '')}/README.md`);
  if (target) return target.url + match[2];
  // Bundle local documentation attachments; never copy runtime stores or source secrets.
  if (/^docs\/[^.].*\.(html|png|jpg|svg|pdf)$/i.test(file) && !file.includes('..') && !file.startsWith('docs/archive/')) {
    const source = path.join(root, file);
    if (fs.existsSync(source) && fs.statSync(source).isFile()) {
      const destination = path.join(out, 'attachments', file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
      return `attachments/${file}${match[2]}`;
    }
  }
  return href;
}
const cards = [
  ['docs/DEVELOPER_GUIDE.md', '01', 'Build & develop', 'Set up your environment and make your first change.'],
  ['docs/PRODUCTION_HANDBOOK.md', '02', 'Operate the chatbot', 'Understand deployment, storage, backups, and ownership.'],
  ['server/docs/api.md', '03', 'Explore the API', 'Find endpoints, request examples, and response formats.'],
  ['docs/INCIDENT_RUNBOOK.md', '04', 'Resolve an incident', 'Follow practical steps when something goes wrong.'],
];
const search = [];
for (const [index, doc] of docs.entries()) {
  const headings = [];
  const content = renderToStaticMarkup(h(Markdown, {
    remarkPlugins: [gfm, headingPlugin(headings)],
    components: {
      a: ({ node, href, ...props }) => h('a', { ...props, href: localLink(href, doc) }),
      table: ({ node, ...props }) => h('div', { className: 'table-wrap', tabIndex: 0, role: 'region', 'aria-label': 'Scrollable documentation table' }, h('table', props)),
      pre: ({ node, children, ...props }) => h('div', { className: 'code-block' }, h('button', { className: 'copy-code', type: 'button', 'aria-label': 'Copy code' }, 'Copy'), h('pre', props, children)),
    },
  }, doc.markdown));
  const home = doc.file === 'docs/README.md';
  const nav = groups.map(name => `<section class="nav-group"><h2>${escape(name)}</h2>${docs.filter(item => item.group === name).map(item => `<a href="${item.url}" ${item === doc ? 'aria-current="page"' : ''}>${escape(item.title)}</a>`).join('')}</section>`).join('');
  const toc = headings.filter(item => item.depth === 2 || item.depth === 3).map(item => `<a class="depth-${item.depth}" href="#${escape(item.id)}">${escape(item.text)}</a>`).join('');
  const previous = docs[index - 1];
  const next = docs[index + 1];
  const hero = home ? `<section class="hero"><span class="eyebrow">OKLAHOMA SMALL BUSINESS DEVELOPMENT CENTER</span><h1>Your guide to the<br><span>OKSBDC Chatbot.</span></h1><p>Everything you need to build, maintain, and support the assistant. Find your starting point below.</p><div class="hero-meta"><span class="status-dot"></span> ${docs.length} guides & references <span>·</span> One place to get started</div></section><div class="quick-links">${cards.map(([file, number, title, description]) => `<a href="${byFile.get(file).url}"><span class="card-number">${number} <span>↗</span></span><h2>${title}</h2><p>${description}</p></a>`).join('')}</div>` : '';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${escape(doc.title)} — OKSBDC Chatbot documentation"><title>${escape(doc.title)} | OKSBDC Docs</title><link rel="icon" href="logo.png"><link rel="stylesheet" href="style.css"><script src="search-index.js" defer></script><script src="app.js" defer></script></head>
<body><a class="skip-link" href="#main">Skip to content</a><header class="topbar"><a class="brand" href="index.html"><img src="logo.png" alt="" width="42" height="42"><span>OKSBDC<span class="brand-sub">CHATBOT DOCUMENTATION</span></span></a><div class="header-right"><span class="docs-label">Developer resources · v${escape(version)}</span><button class="search-trigger" type="button" hidden><span>⌕ &nbsp; Search documentation</span><kbd>Ctrl K</kbd></button><button class="menu-toggle" type="button" aria-expanded="false" aria-controls="sidebar" hidden>Menu</button></div></header>
<div class="layout"><aside class="sidebar" id="sidebar"><div class="sidebar-intro"><span class="eyebrow">KNOWLEDGE BASE</span><p>Build with confidence.</p></div><nav aria-label="Documentation">${nav}</nav><div class="sidebar-footer">OKSBDC Chatbot<span>Technical documentation · v${escape(version)}</span></div></aside><main id="main" tabindex="-1"><div class="breadcrumb"><a href="index.html">Docs</a><span>/</span>${escape(doc.group)}</div>${hero}<div class="article-meta"><span>${escape(doc.file)}</span><a href="sources/${doc.file}" download>Download Markdown ↓</a></div><article class="prose${home ? ' home-prose' : ''}">${content}</article><nav class="page-nav" aria-label="Adjacent pages">${previous ? `<a href="${previous.url}"><small>← Previous</small>${escape(previous.title)}</a>` : '<span></span>'}${next ? `<a href="${next.url}"><small>Next →</small>${escape(next.title)}</a>` : ''}</nav><footer class="page-footer">Oklahoma Small Business Development Center <span>Chatbot docs · v${escape(version)}</span></footer></main><aside class="toc"><span class="eyebrow">ON THIS PAGE</span><nav aria-label="On this page">${toc || '<span>Overview</span>'}</nav><a class="back-top" href="#main">Back to top ↑</a></aside></div>
<dialog class="search-dialog" aria-labelledby="search-title"><div class="search-heading"><h2 id="search-title">Search documentation</h2><button class="close-search" type="button" aria-label="Close search">Esc</button></div><label class="sr-only" for="search-input">Search all documentation</label><input id="search-input" type="search" placeholder="Search guides, endpoints, configuration…" autocomplete="off"><p id="search-status" role="status">Type to search all ${docs.length} documents.</p><div id="search-results"></div></dialog></body></html>`;
  fs.writeFileSync(path.join(out, doc.url), html);
  const source = path.join(out, 'sources', doc.file);
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, doc.markdown);
  search.push({ title: doc.title, group: doc.group, url: doc.url, text: doc.markdown.replace(/[#*`>|]/g, '').replace(/\s+/g, ' '), headings });
}
fs.writeFileSync(path.join(out, 'search-index.js'), `window.DOCS_INDEX=${JSON.stringify(search).replaceAll('<', '\\u003c')};\n`);
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(docs.map(({ file, url, title }) => ({ file, url, title })), null, 2));
console.log(`Built ${docs.length} documentation pages in docs/site/dist/`);
