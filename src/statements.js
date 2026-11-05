import { one, q, now } from './db.js';

const STEP_MS = Number(process.env.STATEMENT_STEP_MS ?? 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class StatementsRefused extends Error {}

/** One statement per active customer: its open invoices up to the period, and the amount due. */
async function prepareStatements(run) {
  try {
    const customers = await q('SELECT id, name FROM customers WHERE team_id = $1 AND active ORDER BY id', [run.team_id]);
    await q('UPDATE statement_runs SET total = $2 WHERE id = $1', [run.id, customers.length]);
    const statements = [];
    for (const c of customers) {
      await sleep(STEP_MS);
      if ((await one('SELECT state FROM statement_runs WHERE id = $1', [run.id]))?.state !== 'running') return;
      const [due] = await q(`SELECT count(*)::int AS open, COALESCE(sum(total_cents), 0)::int AS due_cents FROM invoices WHERE customer_id = $1 AND status = 'open' AND period <= $2`, [c.id, run.period]);
      statements.push({ customer: c.name, openInvoices: due.open, dueCents: due.due_cents });
      await q('UPDATE statement_runs SET done = $2, statements = $3 WHERE id = $1', [run.id, statements.length, JSON.stringify(statements)]);
    }
    await q(`UPDATE statement_runs SET state = 'done', finished_at = $2 WHERE id = $1 AND state = 'running'`, [run.id, now()]);
  } catch (e) {
    console.error('statements failed', run.id, e);
    await q(`UPDATE statement_runs SET state = 'failed', finished_at = $2 WHERE id = $1 AND state = 'running'`, [run.id, now()]).catch(() => {});
  }
}

export async function startStatements(team, user, period) {
  const running = await one(`SELECT id FROM statement_runs WHERE team_id = $1 AND state = 'running'`, [team.id]);
  if (running) throw new StatementsRefused(`Statements run ${running.id} is still being prepared`);
  let run;
  try {
    run = await one(`INSERT INTO statement_runs (team_id, created_by, period, state, started_at) VALUES ($1,$2,$3,'running',$4) RETURNING *`, [team.id, user.id, period, now()]);
  } catch (e) {
    if (e.code === '23505') throw new StatementsRefused('Statements are already being prepared');
    throw e;
  }
  prepareStatements(run);
  return run;
}

/** Cancel ends the run here and now; the loop sees it before the next customer. */
export async function cancelStatements(team, id) {
  return one(`UPDATE statement_runs SET state = 'cancelled', finished_at = $3 WHERE id = $1 AND team_id = $2 AND state = 'running' RETURNING *`, [id, team.id, now()]);
}

/** A run a restart cut short is marked failed, so the page offers Prepare statements again. */
export function startStatementQueue() {
  q(`UPDATE statement_runs SET state = 'failed', finished_at = $1 WHERE state = 'running'`, [now()]).catch((e) => console.error('statements', e));
}
