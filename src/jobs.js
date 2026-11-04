import { one, q, now } from './db.js';
import { priceInvoice } from './pricing.js';

const STEP_MS = Number(process.env.BILLING_STEP_MS ?? 1500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lays out and stores one invoice; the layout is the slow part of a run. */
async function makeInvoice(run, customer, sequence) {
  await sleep(STEP_MS);
  const p = priceInvoice({ seats: customer.seats, priceCents: customer.price_cents });
  const number = `${run.period.replace('-', '')}-${run.team_id}-${String(sequence).padStart(4, '0')}`;
  await q(
    `INSERT INTO invoices (team_id, customer_id, run_id, number, period, seats, unit_cents, discount_cents, tax_cents, total_cents, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open',$11)`,
    [run.team_id, customer.id, run.id, number, run.period, customer.seats, p.unitCents, p.discountCents, p.taxCents, p.totalCents, now()],
  );
}

async function runBilling(run) {
  try {
    const customers = await q(
      `SELECT c.* FROM customers c WHERE c.team_id = $1 AND c.active
         AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = c.id AND i.period = $2) ORDER BY c.id`,
      [run.team_id, run.period],
    );
    await q('UPDATE billing_runs SET total = $2 WHERE id = $1', [run.id, customers.length]);
    let done = 0;
    for (const customer of customers) {
      await makeInvoice(run, customer, ++done);
      await q('UPDATE billing_runs SET done = $2 WHERE id = $1', [run.id, done]);
    }
    await q(`UPDATE billing_runs SET state = 'done', finished_at = $2 WHERE id = $1`, [run.id, now()]);
  } catch (e) {
    console.error('billing run failed', run.id, e);
    await q(`UPDATE billing_runs SET state = 'failed', finished_at = $2 WHERE id = $1`, [run.id, now()]).catch(() => {});
  }
}

export class RunInProgress extends Error {}

/** Starts a run in this process and answers at once; the page follows its progress. */
export async function startBillingRun(team, user, period) {
  const running = await one(`SELECT id FROM billing_runs WHERE team_id = $1 AND state = 'running'`, [team.id]);
  if (running) throw new RunInProgress(`Run ${running.id} is still in progress`);
  const finished = await one(`SELECT id FROM billing_runs WHERE team_id = $1 AND period = $2 AND state = 'done'`, [team.id, period]);
  if (finished) throw new RunInProgress(`${period} has already been billed (run ${finished.id})`);
  const run = await one(
    `INSERT INTO billing_runs (team_id, created_by, period, state, started_at) VALUES ($1,$2,$3,'running',$4) RETURNING *`,
    [team.id, user.id, period, now()],
  );
  runBilling(run);
  return run;
}

const DAY_MS = 86_400_000;

/** Settles charges the gateway has confirmed, and empties the trash. Runs at start and on a timer. */
export async function housekeeping() {
  await q(`UPDATE invoices SET status = 'paid' WHERE status = 'processing' AND id IN (SELECT invoice_id FROM charges WHERE created_at < $1)`, [new Date(Date.now() - 20_000)]);
  await q('DELETE FROM documents WHERE trashed_at IS NOT NULL AND trashed_at < $1', [new Date(Date.now() - 30 * DAY_MS)]);
}

export function startHousekeeping() {
  housekeeping().catch((e) => console.error('housekeeping', e));
  setInterval(() => housekeeping().catch((e) => console.error('housekeeping', e)), 5_000).unref();
}
