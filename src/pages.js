import express from 'express';
import { one, q } from './db.js';
import { requireTeam, requireUser, requireAdmin } from './auth.js';
import { PREVIEW_LINES, reportsLeft } from './reports.js';
import { activityGroups, runningNow, runsPanel, totalsPanel } from './activity.js';

export const pages = express.Router();
pages.param('id', (_req, res, next, id) => (/^\d{1,9}$/.test(id) ? next() : res.redirect('/')));

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (cents) => `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const kb = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
const statusWord = { open: 'Open', processing: 'Processing', paid: 'Paid', running: 'Running', done: 'Done', failed: 'Failed' };

function shell(req, title, body, { nav = true } = {}) {
  const links = req.team ? `<a href="/customers">Customers</a><a href="/billing">Billing</a><a href="/invoices">Invoices</a><a href="/reports">Reports</a><a href="/statements">Statements</a><a href="/activity">Activity</a><a href="/documents">Documents</a><a href="/team">Team</a><a href="/settings">Settings</a>` : '';
  const who = req.user ? `<span class="who">${esc(req.user.name)}${req.team ? ` · ${esc(req.team.name)}` : ''}</span><button data-post="/api/logout" data-then="/login">Sign out</button>` : `<a href="/login">Sign in</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · Tallybird</title><link rel="stylesheet" href="/app.css"></head>
<body>${nav ? `<header><a class="brand" href="/">Tallybird</a><nav>${links}</nav><div class="right">${who}</div></header>` : ''}<main><div id="flash" role="status"></div><h1>${esc(title)}</h1>${body}</main><script src="/app.js"></script></body></html>`;
}

pages.get('/', (req, res) => res.redirect(req.user ? (req.team ? '/billing' : '/admin') : '/login'));

pages.get('/login', (req, res) => res.send(shell(req, 'Sign in', `
  <form data-api="POST /api/login" data-then="/"><label>Email <input name="email" type="email" required autocomplete="username"></label>
  <label>Password <input name="password" type="password" required autocomplete="current-password"></label><button type="submit">Sign in</button></form>
  <p>New here? <a href="/signup">Create an account</a></p>`)));

pages.get('/signup', (req, res) => res.send(shell(req, 'Create your account', `
  <form data-api="POST /api/signup" data-then="/"><input type="hidden" name="invite" value="${esc(req.query.invite)}">
  <label>Your name <input name="name" required></label><label>Email <input name="email" type="email" required></label>
  <label>Password <input name="password" type="password" required minlength="8"></label>
  ${req.query.invite ? '' : '<label>Team name <input name="team"></label>'}<button type="submit">Create account</button></form>`)));

pages.get('/customers', requireTeam, async (req, res) => {
  const rows = await q('SELECT * FROM customers WHERE team_id = $1 ORDER BY id', [req.team.id]);
  const form = req.team.role === 'owner' ? `<h2>Add a customer</h2><form data-api="POST /api/customers" data-then="/customers" data-numbers="seats,priceCents"><label>Name <input name="name" required></label><label>Email <input name="email" type="email" required></label><label>Seats <input name="seats" type="number" min="1" required></label><label>Price per seat, in cents <input name="priceCents" type="number" min="0" required></label><button type="submit">Add customer</button></form>` : '';
  res.send(shell(req, 'Customers', `<table><thead><tr><th>Name</th><th>Email</th><th>Seats</th><th>Price per seat</th></tr></thead><tbody>${rows.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.email)}</td><td>${c.seats}</td><td>${money(c.price_cents)}</td></tr>`).join('')}</tbody></table>${form}`));
});

pages.get('/billing', requireTeam, async (req, res) => {
  if (req.team.role !== 'owner') return res.status(403).send(shell(req, 'Billing', '<p>Only the team owner runs billing.</p>'));
  const runs = await q('SELECT * FROM billing_runs WHERE team_id = $1 ORDER BY id DESC LIMIT 25', [req.team.id]);
  res.send(shell(req, 'Billing', `<form data-api="POST /api/billing-runs" data-then="/billing"><label>Period <input name="period" value="${new Date().toISOString().slice(0, 7)}" pattern="\\d{4}-\\d{2}" required></label><button type="submit">Run billing</button></form>
  <table data-refresh="${runs.some((r) => r.state === 'running') ? 3000 : ''}"><thead><tr><th>Run</th><th>Period</th><th>Status</th><th>Progress</th><th>Started</th></tr></thead><tbody>${runs.map((r) => `<tr><td>#${r.id}</td><td>${esc(r.period)}</td><td>${statusWord[r.state]}</td><td>${r.done} of ${r.total}</td><td>${new Date(r.started_at).toLocaleString('en-US')}</td></tr>`).join('')}</tbody></table>`));
});

pages.get('/invoices', requireTeam, async (req, res) => {
  const rows = await q(`SELECT i.*, c.name AS customer_name FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.team_id = $1 ORDER BY i.id DESC LIMIT 100`, [req.team.id]);
  res.send(shell(req, 'Invoices', `<table><thead><tr><th>Number</th><th>Customer</th><th>Period</th><th>Total</th><th>Status</th></tr></thead><tbody>${rows.map((i) => `<tr><td><a href="/invoices/${i.id}">${esc(i.number)}</a></td><td>${esc(i.customer_name)}</td><td>${esc(i.period)}</td><td>${money(i.total_cents)}</td><td>${statusWord[i.status]}</td></tr>`).join('')}</tbody></table>`));
});

pages.get('/invoices/:id', requireUser, async (req, res) => {
  const i = await one(`SELECT i.*, c.name AS customer_name, c.email AS customer_email FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = $1`, [req.params.id]);
  if (!i) return res.status(404).send(shell(req, 'Not found', '<p>No such invoice. <a href="/invoices">Back to invoices</a></p>'));
  const charges = await q('SELECT * FROM charges WHERE invoice_id = $1 ORDER BY id', [i.id]);
  const pay = req.team?.role === 'owner' && req.team.id === i.team_id && i.status !== 'paid' ? `<button data-post="/api/invoices/${i.id}/pay" data-then="/invoices/${i.id}">Pay now</button>` : '';
  const files = await q('SELECT id, filename, kind, bytes, line_items FROM invoice_attachments WHERE invoice_id = $1 ORDER BY id', [i.id]);
  const items = (list) => (list.length ? `<table><thead><tr><th>Line item</th><th>Quantity</th><th>Amount</th></tr></thead><tbody>${list.slice(0, 50).map((x) => `<tr><td>${esc(x.description)}</td><td>${esc(x.quantity)}</td><td>${money(x.amountCents)}</td></tr>`).join('')}</tbody></table>${list.length > 50 ? `<p>and ${list.length - 50} more line items</p>` : ''}` : '<p>No line items.</p>');
  const attach = req.team?.id === i.team_id ? `<form data-upload="/api/invoices/${i.id}/attachments" data-then="/invoices/${i.id}"><label>Attach a CSV of line items or a PDF receipt (up to 5 MB) <input name="file" type="file" accept=".csv,.pdf,text/csv,application/pdf" required></label><button type="submit">Attach file</button></form>` : '';
  const attachments = `<h2>Attachments</h2>${files.length ? `<ul class="attachments">${files.map((f) => `<li><a href="/api/invoices/${i.id}/attachments/${f.id}">${esc(f.filename)}</a> · ${f.kind === 'csv' ? 'Line items (CSV)' : 'Receipt (PDF)'} · ${kb(f.bytes)}${f.kind === 'csv' ? items(f.line_items) : ''}</li>`).join('')}</ul>` : '<p>No attachments yet.</p>'}${attach}`;
  res.send(shell(req, `Invoice ${i.number}`, `<dl><dt>Customer</dt><dd>${esc(i.customer_name)} (${esc(i.customer_email)})</dd><dt>Seats</dt><dd>${i.seats} at ${money(i.unit_cents)}</dd><dt>Discount</dt><dd>${money(i.discount_cents)}</dd><dt>Tax</dt><dd>${money(i.tax_cents)}</dd><dt>Total</dt><dd>${money(i.total_cents)}</dd><dt>Status</dt><dd>${statusWord[i.status]}</dd></dl>${pay}
  <h2>Charges</h2>${charges.length ? `<ul>${charges.map((c) => `<li>${money(c.amount_cents)} on ${new Date(c.created_at).toLocaleString('en-US')} (${esc(c.gateway_ref)})</li>`).join('')}</ul>` : '<p>No charges yet.</p>'}${attachments}<p><a href="/invoices">Back to invoices</a></p>`));
});

pages.get('/documents', requireTeam, async (req, res) => {
  const r = await fetchSelf(req, '/api/documents');
  res.send(shell(req, 'Documents', `<ul class="docs">${r.documents.map((d) => `<li><a href="/documents/${d.id}">${esc(d.title)}</a>${d.sharedWithTeam ? ' <span class="badge">Shared with team</span>' : ''}</li>`).join('') || '<li>No documents yet.</li>'}</ul>
  <h2>New document</h2><form data-api="POST /api/documents" data-then="/documents"><label>Title <input name="title" required></label><label>Text <textarea name="body" rows="5"></textarea></label><button type="submit">Create document</button></form>`));
});

pages.get('/documents/:id', requireTeam, async (req, res) => {
  const r = await fetchSelf(req, `/api/documents/${encodeURIComponent(req.params.id)}`);
  if (!r.document) return res.status(404).send(shell(req, 'Not found', '<p>No such document. <a href="/documents">Back to documents</a></p>'));
  const d = r.document;
  const mine = d.mine ? `<form data-api="PATCH /api/documents/${d.id}" data-then="/documents/${d.id}"><label>Title <input name="title" value="${esc(d.title)}"></label><label>Text <textarea name="body" rows="5">${esc(d.body)}</textarea></label><button type="submit">Save</button></form>
  <h2>Share</h2><button data-post="/api/documents/${d.id}/share" data-body='{"team":true}' data-then="/documents/${d.id}">Share with team</button>
  <form data-api="POST /api/documents/${d.id}/share" data-then="/documents/${d.id}"><label>Share with a teammate <input name="email" type="email" required></label><button type="submit">Share</button></form>
  <button data-post="/api/documents/${d.id}" data-method="DELETE" data-then="/documents">Move to trash</button>` : `<p>${esc(d.body)}</p>`;
  res.send(shell(req, d.title, `${d.sharedWithTeam ? '<p class="badge">Shared with team</p>' : ''}${mine}<h2>Comments</h2><ul>${d.comments.map((c) => `<li><b>${esc(c.author)}</b>: ${esc(c.text)}</li>`).join('') || '<li>No comments yet.</li>'}</ul>
  <form data-api="POST /api/documents/${d.id}/comments" data-then="/documents/${d.id}"><label>Add a comment <textarea name="text" rows="2" required></textarea></label><button type="submit">Comment</button></form><p><a href="/documents">Back to documents</a></p>`));
});

const reportWord = { running: 'Running', pending: 'Queued', done: 'Done', stopped: 'Stopped', failed: 'Failed' };
const seatLines = (lines) => `<table><thead><tr><th>Customer</th><th>Seats</th><th>Price per seat</th></tr></thead><tbody>${lines.map((l) => `<tr><td>${esc(l.customer)}</td><td>${l.seats}</td><td>${money(l.priceCents)}</td></tr>`).join('')}</tbody></table>`;

pages.get('/reports', requireTeam, async (req, res) => {
  const reports = await q('SELECT * FROM reports WHERE team_id = $1 ORDER BY id DESC LIMIT 25', [req.team.id]);
  const { used, left, perMonth } = await reportsLeft(req.team.id);
  const active = reports.find((r) => r.state === 'running' || r.state === 'pending');
  const start = active ? `<p>Report #${active.id} is ${reportWord[active.state].toLowerCase()}. One report runs at a time.</p>`
    : `<form data-api="POST /api/reports" data-then="/reports"><label>Period <input name="period" value="${new Date().toISOString().slice(0, 7)}" pattern="\\d{4}-\\d{2}" required></label><button type="submit">Start report</button></form>`;
  const latest = reports.find((r) => r.state === 'done' && r.scope === 'all');
  const rest = latest && reports.find((r) => r.state === 'done' && r.scope === 'rest' && r.period === latest.period && r.id > latest.id);
  const more = latest ? latest.lines.length - PREVIEW_LINES : 0;
  const shown = !latest ? '<p>No reports yet.</p>' : `<div class="summary">Report #${latest.id} for ${esc(latest.period)} lists ${latest.lines.length} customers${more > 0 && !rest ? `; here are the first ${PREVIEW_LINES}. <form class="inline" data-api="POST /api/reports" data-then="/reports"><input type="hidden" name="period" value="${esc(latest.period)}"><input type="hidden" name="scope" value="rest"><button type="submit" class="textlink">See the rest · ${more} more</button></form>` : '.'}</div>${seatLines(rest ? [...latest.lines.slice(0, PREVIEW_LINES), ...rest.lines] : latest.lines.slice(0, PREVIEW_LINES))}`;
  const stop = (r) => (r.state === 'running' ? `<button data-post="/api/reports/${r.id}/stop" data-then="/reports">Stop</button>` : '');
  res.send(shell(req, 'Reports', `<p>A seat report lists every active customer with its seats and price per seat. Your team can start ${perMonth} reports a month: ${used} used, ${left} left this month.</p>${start}
  <h2>Latest report</h2>${shown}
  <h2>All reports</h2><table data-refresh="${reports.some((r) => r.state === 'running') ? 3000 : ''}"><thead><tr><th>Report</th><th>Period</th><th>Customers</th><th>Status</th><th>Progress</th><th>Started</th><th></th></tr></thead><tbody>${reports.map((r) => `<tr><td>#${r.id}</td><td>${esc(r.period)}</td><td>${r.scope === 'rest' ? `After the first ${PREVIEW_LINES}` : 'All'}</td><td>${reportWord[r.state]}</td><td>${r.done} of ${r.total}</td><td>${new Date(r.started_at).toLocaleString('en-US')}</td><td>${stop(r)}</td></tr>`).join('')}</tbody></table>`));
});

const runWord = { running: 'Preparing', done: 'Ready', cancelled: 'Cancelled', failed: 'Failed' };

pages.get('/statements', requireTeam, async (req, res) => {
  const runs = await q('SELECT id, period, state, total, done, started_at, jsonb_array_length(statements) AS ready FROM statement_runs WHERE team_id = $1 ORDER BY id DESC LIMIT 25', [req.team.id]);
  const active = runs.find((r) => r.state === 'running');
  const start = active ? `<p>Statements run #${active.id} is being prepared. One run at a time.</p>`
    : `<form data-api="POST /api/statements" data-then="/statements"><label>Period <input name="period" value="${new Date().toISOString().slice(0, 7)}" pattern="\\d{4}-\\d{2}" required></label><button type="submit">Prepare statements</button></form>`;
  const latest = runs.find((r) => r.state === 'done');
  const ready = latest ? `<p>Statements for ${esc(latest.period)} are ready for ${latest.ready} customers. <a href="/statements/${latest.id}">See all ${latest.ready}</a></p>` : '<p>No statements yet.</p>';
  const cancel = (r) => (r.state === 'running' ? `<button data-post="/api/statements/${r.id}/cancel" data-then="/statements">Cancel</button>` : '');
  res.send(shell(req, 'Statements', `<p>A statement for each active customer: its open invoices and the amount due. Statements are free.</p>${start}${ready}
  <h2>All statement runs</h2><table data-refresh="${active ? 3000 : ''}"><thead><tr><th>Run</th><th>Period</th><th>Status</th><th>Progress</th><th>Started</th><th></th></tr></thead><tbody>${runs.map((r) => `<tr><td>#${r.id}</td><td>${esc(r.period)}</td><td>${runWord[r.state]}</td><td>${r.done} of ${r.total}</td><td>${new Date(r.started_at).toLocaleString('en-US')}</td><td>${cancel(r)}</td></tr>`).join('')}</tbody></table>`));
});

pages.get('/statements/:id', requireTeam, async (req, res) => {
  const run = await one('SELECT * FROM statement_runs WHERE id = $1 AND team_id = $2', [req.params.id, req.team.id]);
  if (!run) return res.status(404).send(shell(req, 'Not found', '<p>No such statements run. <a href="/statements">Back to statements</a></p>'));
  res.send(shell(req, `Statements for ${run.period}`, `<table><thead><tr><th>Customer</th><th>Open invoices</th><th>Amount due</th></tr></thead><tbody>${run.statements.map((x) => `<tr><td>${esc(x.customer)}</td><td>${x.openInvoices}</td><td>${money(x.dueCents)}</td></tr>`).join('')}</tbody></table><p><a href="/statements">Back to statements</a></p>`));
});

pages.get('/activity', requireTeam, async (req, res) => {
  const [groups, running, totals, runs] = await Promise.all([activityGroups(req.team.id), runningNow(req.team.id), totalsPanel(req.team.id), runsPanel(req.team.id)]);
  res.send(shell(req, 'Activity', `<p>What happened on your team, oldest first. This page keeps itself up to date while it is open.</p>
  <h2>Running now</h2><ul class="running" data-running="/api/activity/running">${(running.length ? running : ['Nothing is running.']).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
  <h2>Your team</h2><div class="panel" data-panel="/api/activity/totals">${totals}</div>
  <h2>Reports and statements</h2><div class="panel" data-panel="/api/activity/runs">${runs}</div>
  <h2>Activity</h2><ul class="feed" data-feed="/api/activity/latest">${groups.map((g) => `<li><b>${esc(g.title)}</b><ul>${g.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></li>`).join('') || '<li>Nothing yet.</li>'}</ul>`));
});

pages.get('/team', requireTeam, async (req, res) => {
  const members = await q('SELECT u.name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.team_id = $1 ORDER BY u.id', [req.team.id]);
  const invite = req.team.role === 'owner' ? `<h2>Invite a teammate</h2><form data-api="POST /api/team/invites" data-show="invite.link"><label>Email <input name="email" type="email" required></label><button type="submit">Create invite link</button></form>` : '';
  res.send(shell(req, 'Team', `<table><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>${members.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.email)}</td><td>${esc(m.role)}</td></tr>`).join('')}</tbody></table>${invite}`));
});

pages.get('/settings', requireTeam, (req, res) => {
  const owner = req.team.role === 'owner';
  res.send(shell(req, 'Settings', owner ? `<form data-api="PATCH /api/team" data-then="/settings"><label>Team name <input name="name" value="${esc(req.team.name)}" required></label><label>What does your team do? <textarea name="description" rows="3">${esc(req.team.description)}</textarea></label><button type="submit">Save settings</button></form>
  <h2>Your data</h2><p><a class="button" href="/settings/export">Export workspace data</a></p>` : '<p>Only the team owner can change settings.</p>'));
});

pages.get('/settings/export', requireTeam, (req, res) => {
  res.send(shell(req, 'Preparing your export', '<p class="spinner">Your export is being prepared. This page will update when it is ready.</p>', { nav: false }));
});

pages.get('/admin', requireUser, requireAdmin, async (req, res) => {
  const teams = await q('SELECT t.id, t.name, t.suspended, count(m.user_id)::int AS members FROM teams t LEFT JOIN memberships m ON m.team_id = t.id GROUP BY t.id ORDER BY t.id');
  res.send(shell(req, 'Site admin', `<table><thead><tr><th>Team</th><th>Members</th><th></th></tr></thead><tbody>${teams.map((t) => `<tr><td>${esc(t.name)}</td><td>${t.members}</td><td>${t.suspended ? 'Suspended' : `<button data-post="/api/admin/teams/${t.id}/suspend" data-then="/admin">Suspend</button>`}</td></tr>`).join('')}</tbody></table>`));
});

/** Pages show exactly what the API answers for this person. */
async function fetchSelf(req, path) {
  const port = process.env.PORT ?? 3000;
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { cookie: `session=${req.cookies.session}` } });
  return r.json();
}
