import { q } from './db.js';

const money = (cents) => `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nouns = { customer: ['customer added', 'customers added'], invoice: ['invoice made', 'invoices made'], payment: ['payment taken', 'payments taken'],
  report: ['report started', 'reports started'], statements: ['statements run started', 'statements runs started'] };
const minute = (at) => Math.floor(new Date(at).getTime() / 60_000);
function when(at) {
  const d = new Date(at); const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? `at ${time}` : `on ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${time}`;
}

/** The team's latest events, oldest first, in groups: one kind of thing in one minute ("3 invoices made, at 2:31 PM"). */
export async function activityGroups(teamId, limit = 60) {
  const events = await q(
    `SELECT * FROM (
       SELECT 'customer' AS kind, created_at AS at, name AS what, NULL::int AS cents FROM customers WHERE team_id = $1
       UNION ALL SELECT 'invoice', i.created_at, i.number || ' · ' || c.name, NULL FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.team_id = $1
       UNION ALL SELECT 'payment', ch.created_at, i.number, ch.amount_cents FROM charges ch JOIN invoices i ON i.id = ch.invoice_id WHERE i.team_id = $1
       UNION ALL SELECT 'report', started_at, 'Report #' || id || ' for ' || period, NULL FROM reports WHERE team_id = $1
       UNION ALL SELECT 'statements', started_at, 'Statements for ' || period, NULL FROM statement_runs WHERE team_id = $1
     ) e ORDER BY at DESC LIMIT $2`, [teamId, limit]);
  const groups = [];
  for (const e of events.reverse()) {
    const last = groups.at(-1); const text = e.kind === 'payment' ? `${money(e.cents)} for ${e.what}` : e.what;
    if (last && last.kind === e.kind && last.minute === minute(e.at)) { last.items.push(text); continue; }
    groups.push({ kind: e.kind, minute: minute(e.at), at: e.at, items: [text] });
  }
  return groups.map((g) => ({ title: `${g.items.length} ${nouns[g.kind][g.items.length === 1 ? 0 : 1]}, ${when(g.at)}`, items: g.items }));
}

/** What runs right now (reports and statements), with its progress. */
export async function runningNow(teamId) {
  const rows = await q(
    `SELECT 'Report #' || id || ' for ' || period AS what, done, total, started_at FROM reports WHERE team_id = $1 AND state = 'running'
     UNION ALL SELECT 'Statements for ' || period, done, total, started_at FROM statement_runs WHERE team_id = $1 AND state = 'running'
     ORDER BY started_at`, [teamId]);
  return rows.map((r) => `${r.what}: ${r.done} of ${r.total}`);
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The "Your team" panel: active customers, seats and what is due, with a line per customer. */
export async function totalsPanel(teamId) {
  const rows = await q(`SELECT c.name, c.seats, count(i.id)::int AS open, COALESCE(sum(i.total_cents), 0)::int AS due FROM customers c
    LEFT JOIN invoices i ON i.customer_id = c.id AND i.status = 'open' WHERE c.team_id = $1 AND c.active GROUP BY c.id ORDER BY c.id`, [teamId]);
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  return `<p>${rows.length} active customers with ${sum('seats').toLocaleString('en-US')} seats; ${sum('open')} open invoices, ${money(sum('due'))} due.</p>`
    + `<details><summary>Details (${rows.length})</summary><table><thead><tr><th>Customer</th><th>Seats</th><th>Open invoices</th><th>Due</th></tr></thead><tbody>`
    + `${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.seats}</td><td>${r.open}</td><td>${money(r.due)}</td></tr>`).join('')}</tbody></table></details>`;
}

const runWords = { running: 'Running', pending: 'Queued', done: 'Done', stopped: 'Stopped', failed: 'Failed', cancelled: 'Cancelled' };
/** The "Reports and statements" panel: the latest run, with the earlier ones. */
export async function runsPanel(teamId) {
  const runs = await q(`SELECT 'Report #' || id || ' for ' || period AS what, state, started_at FROM reports WHERE team_id = $1
    UNION ALL SELECT 'Statements for ' || period, state, started_at FROM statement_runs WHERE team_id = $1 ORDER BY started_at DESC LIMIT 20`, [teamId]);
  return `<p>Latest: ${runs.length ? `${esc(runs[0].what)}, ${runWords[runs[0].state].toLowerCase()}` : 'nothing yet'}.</p>`
    + `<details id="runs-list"><summary>Reports and statements (${runs.length})</summary><ul>${runs.map((r) => `<li>${esc(r.what)}: ${runWords[r.state]}, ${when(r.started_at)}</li>`).join('')}</ul></details>`;
}
