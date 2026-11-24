/** The API docs: docs/api.md as a page (/docs) and as markdown (/docs.md). */
import fs from 'node:fs';
import express from 'express';

export const docsPages = express.Router();

const DOCS = new URL('../docs/api.md', import.meta.url);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const inline = (t) => esc(t)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');

/** The little markdown the docs use: headings, paragraphs, lists, fenced code. */
export function renderMarkdown(md) {
  const out = []; let list = null; let para = []; let code = null;
  const flush = () => {
    if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
    if (list) { out.push(`<${list.tag}${list.start > 1 ? ` start="${list.start}"` : ''}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; }
  };
  for (const line of md.split('\n')) {
    if (code) { if (/^```/.test(line)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else code.push(line); continue; }
    if (/^```/.test(line)) { flush(); code = []; continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { flush(); const id = h[2].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); out.push(`<h${h[1].length} id="${id}">${inline(h[2])}</h${h[1].length}>`); continue; }
    const li = /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/.exec(line);
    if (li) { if (para.length) flush(); const tag = li[1] ? 'ul' : 'ol'; if (list && list.tag !== tag) flush(); list ??= { tag, start: Number(li[2] ?? 1), items: [] }; list.items.push(li[3]); continue; }
    if (!line.trim()) { flush(); continue; }
    if (list && /^\s{2,}/.test(line)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
    para.push(line.trim());
  }
  flush();
  return out.join('\n');
}

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · Tallybird</title><link rel="stylesheet" href="/app.css"></head>
<body><header><a class="brand" href="/">Tallybird</a><nav><a href="/docs">API docs</a><a href="/openapi.json">OpenAPI</a><a href="/llms.txt">llms.txt</a></nav><div class="right"><a href="/login">Sign in</a></div></header><main class="docs">${body}</main></body></html>`;

docsPages.get('/docs', (_req, res) => {
  res.send(page('API docs', renderMarkdown(fs.readFileSync(DOCS, 'utf8'))));
});

docsPages.get('/docs.md', (_req, res) => {
  res.type('text/markdown; charset=utf-8').send(fs.readFileSync(DOCS, 'utf8'));
});

docsPages.get(/^\/docs\/.+/, (req, res) => {
  res.status(404).send(page('Page not found', `<h1>No such docs page</h1><p>There is no page at <code>${esc(req.path)}</code>. Did you mean one of these?</p>
  <ul><li><a href="/docs">API docs and quickstart</a></li><li><a href="/docs.md">The same docs as markdown</a></li><li><a href="/openapi.json">OpenAPI description of /api/v1</a></li><li><a href="/llms.txt">llms.txt</a></li></ul>`));
});
