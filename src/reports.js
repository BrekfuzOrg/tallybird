import { one, q, now } from './db.js';

/** Every team can start this many reports a calendar month; a stopped report still counts. */
export const REPORTS_PER_MONTH = 10;
/** The Reports page shows this many lines of the latest report. */
export const PREVIEW_LINES = 12;
const STEP_MS = Number(process.env.REPORT_STEP_MS ?? 1000);
/** A stopped report waits in the queue this long before it is let go: longer than any one line can take. */
const RELEASE_AFTER_MS = 7 * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ReportRefused extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

const monthStart = () => { const d = now(); return new Date(d.getFullYear(), d.getMonth(), 1); };

export async function reportsLeft(teamId) {
  const [{ used }] = await q('SELECT count(*)::int AS used FROM reports WHERE team_id = $1 AND started_at >= $2', [teamId, monthStart()]);
  return { used, left: Math.max(0, REPORTS_PER_MONTH - used), perMonth: REPORTS_PER_MONTH };
}

/** Builds a seat report a customer at a time: every active customer, or the ones after the first `skip`. */
async function buildReport(report) {
  try {
    const customers = await q('SELECT name, seats, price_cents FROM customers WHERE team_id = $1 AND active ORDER BY id', [report.team_id]);
    const list = report.scope === 'rest' ? customers.slice(report.skip) : customers;
    await q('UPDATE reports SET total = $2 WHERE id = $1', [report.id, list.length]);
    const lines = [];
    for (const c of list) {
      await sleep(STEP_MS);
      // A stopped report has gone back to the queue: the worker lets go of it between two lines.
      if ((await one('SELECT state FROM reports WHERE id = $1', [report.id]))?.state !== 'running') return;
      lines.push({ customer: c.name, seats: c.seats, priceCents: c.price_cents });
      await q('UPDATE reports SET done = $2, lines = $3 WHERE id = $1', [report.id, lines.length, JSON.stringify(lines)]);
    }
    await q(`UPDATE reports SET state = 'done', finished_at = $2 WHERE id = $1 AND state = 'running'`, [report.id, now()]);
  } catch (e) {
    console.error('report failed', report.id, e);
    await q(`UPDATE reports SET state = 'failed', finished_at = $2 WHERE id = $1 AND state = 'running'`, [report.id, now()]).catch(() => {});
  }
}

/** Starts a report in this process and answers at once; the Reports page follows its progress. One at a time per team. */
export async function startReport(team, user, period, scope = 'all', skip = 0) {
  const active = await one(`SELECT id, state FROM reports WHERE team_id = $1 AND state IN ('running', 'pending')`, [team.id]);
  if (active) throw new ReportRefused(`Report ${active.id} is still ${active.state === 'pending' ? 'queued' : 'running'}`);
  if ((await reportsLeft(team.id)).left === 0) throw new ReportRefused(`Your team has used its ${REPORTS_PER_MONTH} reports for this month`, 402);
  let report;
  try {
    report = await one(`INSERT INTO reports (team_id, created_by, period, scope, skip, state, started_at) VALUES ($1,$2,$3,$4,$5,'running',$6) RETURNING *`,
      [team.id, user.id, period, scope, scope === 'rest' ? skip : 0, now()]);
  } catch (e) {
    if (e.code === '23505') throw new ReportRefused('Another report is already running');
    throw e;
  }
  buildReport(report);
  return report;
}

/** Stop: the report goes back to the queue, which lets it go once no worker can still be on it. */
export async function stopReport(team, id) {
  return one(`UPDATE reports SET state = 'pending', stop_requested_at = $3 WHERE id = $1 AND team_id = $2 AND state = 'running' RETURNING *`, [id, team.id, now()]);
}

export async function releaseStoppedReports() {
  await q(`UPDATE reports SET state = 'stopped', finished_at = $2 WHERE state = 'pending' AND stop_requested_at < $1`, [new Date(Date.now() - RELEASE_AFTER_MS), now()]);
}

/** A report belongs to the process that started it: one a restart cut short is marked failed, then the queue is kept. */
export function startReportQueue() {
  q(`UPDATE reports SET state = 'failed', finished_at = $1 WHERE state = 'running'`, [now()]).catch((e) => console.error('reports', e));
  setInterval(() => releaseStoppedReports().catch((e) => console.error('reports', e)), 5_000).unref();
}
