/* Progressive enhancements; every documentation page is usable without JavaScript. */
document.documentElement.classList.add('js');
const menu = document.querySelector('.menu-toggle');
const sidebar = document.querySelector('.sidebar');
menu.hidden = false;
menu.addEventListener('click', () => {
  const open = sidebar.classList.toggle('open');
  menu.setAttribute('aria-expanded', String(open));
  menu.textContent = open ? 'Close' : 'Menu';
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && sidebar.classList.contains('open')) {
    sidebar.classList.remove('open');
    menu.setAttribute('aria-expanded', 'false');
    menu.textContent = 'Menu';
    menu.focus();
  }
});
const dialog = document.querySelector('.search-dialog');
const trigger = document.querySelector('.search-trigger');
const input = document.querySelector('#search-input');
const results = document.querySelector('#search-results');
const status = document.querySelector('#search-status');
if (typeof dialog.showModal === 'function') trigger.hidden = false;
function openSearch() { if (!dialog.open) dialog.showModal(); input.focus(); }
trigger.addEventListener('click', openSearch);
document.querySelector('.close-search').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && typeof dialog.showModal === 'function') { event.preventDefault(); openSearch(); }
});
input.addEventListener('input', () => {
  const query = input.value.trim().toLowerCase();
  results.replaceChildren();
  if (!query) { status.textContent = `Type to search all ${window.DOCS_INDEX.length} documents.`; return; }
  const terms = query.split(/\s+/);
  const matches = window.DOCS_INDEX.map(doc => {
    const title = doc.title.toLowerCase();
    const text = doc.text.toLowerCase();
    const score = terms.every(term => `${title} ${text}`.includes(term)) ? terms.reduce((sum, term) => sum + (title.includes(term) ? 10 : 1), 0) : 0;
    return { doc, score };
  }).filter(item => item.score).sort((a, b) => b.score - a.score);
  status.textContent = matches.length ? `${matches.length} matching document${matches.length === 1 ? '' : 's'}` : 'No results. Try a broader term, such as “configuration” or “chat”.';
  for (const { doc } of matches) {
    const link = document.createElement('a');
    link.className = 'search-result';
    link.href = doc.url;
    const group = document.createElement('small'); group.textContent = doc.group;
    const title = document.createElement('strong'); title.textContent = doc.title;
    const preview = document.createElement('p');
    const position = Math.max(0, doc.text.toLowerCase().indexOf(terms[0]) - 65);
    preview.textContent = `${position ? '…' : ''}${doc.text.slice(position, position + 190)}${doc.text.length > position + 190 ? '…' : ''}`;
    link.append(group, title, preview); results.append(link);
  }
});
input.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown') { event.preventDefault(); results.querySelector('a')?.focus(); }
});
results.addEventListener('keydown', event => {
  const links = [...results.querySelectorAll('a')];
  const index = links.indexOf(document.activeElement);
  if (event.key === 'ArrowDown') { event.preventDefault(); links[Math.min(index + 1, links.length - 1)]?.focus(); }
  if (event.key === 'ArrowUp') { event.preventDefault(); if (index <= 0) input.focus(); else links[index - 1].focus(); }
});
for (const button of document.querySelectorAll('.copy-code')) {
  button.addEventListener('click', async () => {
    const code = button.nextElementSibling;
    try {
      await navigator.clipboard.writeText(code.textContent);
      button.textContent = 'Copied';
    } catch {
      const range = document.createRange(); range.selectNodeContents(code);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      button.textContent = 'Selected — press Ctrl/Cmd+C';
    }
    setTimeout(() => { button.textContent = 'Copy'; }, 2500);
  });
}
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    const heading = entries.find(entry => entry.isIntersecting)?.target;
    if (!heading) return;
    for (const link of document.querySelectorAll('.toc nav a')) link.classList.toggle('active', link.hash === `#${heading.id}`);
  }, { rootMargin: '-90px 0px -65% 0px' });
  document.querySelectorAll('.prose h2,.prose h3').forEach(heading => observer.observe(heading));
}
