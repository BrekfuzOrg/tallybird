import crypto from 'node:crypto';
import { hashPassword } from '../src/auth.js';
import { one, pool, q } from '../src/db.js';
import { priceInvoice } from '../src/pricing.js';

const existing = await one(`SELECT id FROM users WHERE email = 'keen@northwind.test'`);
if (existing) { console.log('demo data already there'); await pool.end(); process.exit(0); }

const DAY = 86_400_000; const at = (daysAgo) => new Date(Date.now() - daysAgo * DAY);
const hash = await hashPassword('tallybird-demo');
const user = async (email, name, isAdmin = false) => (await one('INSERT INTO users (email, name, password_hash, is_admin, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING *', [email, name, hash, isAdmin, at(75)]));
const team = async (name) => (await one('INSERT INTO teams (name, created_at) VALUES ($1,$2) RETURNING *', [name, at(75)]));
const member = (u, t, role) => q('INSERT INTO memberships (user_id, team_id, role) VALUES ($1,$2,$3)', [u.id, t.id, role]);

await user('root@tallybird.test', 'Renee', true);
const northwind = await team('Northwind'); const bluepeak = await team('Blue Peak');
const keen = await user('keen@northwind.test', 'Keen'); const bree = await user('bree@northwind.test', 'Bree');
const eren = await user('eren@bluepeak.test', 'Eren'); const ben = await user('ben@bluepeak.test', 'Ben');
await member(keen, northwind, 'owner'); await member(bree, northwind, 'member'); await member(eren, bluepeak, 'owner'); await member(ben, bluepeak, 'member');

const names = ['Acorn Dental', 'Harbor Freight Co', 'Ridge Yoga', 'Lumen Print', 'Sable Coffee', 'Fennel Foods', 'Orchard Legal', 'Pine Street Vet', 'Quarry Labs', 'Tidewater Tours', 'Wren Books', 'Juniper Health', 'Marlin Sports', 'Copper Kettle', 'Delta Movers', 'Beacon Tutors', 'Cedar Roofing', 'Nimbus Studio', 'Atlas Cycles', 'Kite Bakery', 'Elm Accounting', 'Slate Gym', 'Heron Travel', 'Vale Pharmacy'];
const seats = [3, 12, 40, 99, 101, 250, 7, 18, 55, 5, 150, 2];
for (const [t, list] of [[northwind, names], [bluepeak, names.slice(0, 16).map((n) => `${n} West`)]]) {
  for (const [i, name] of list.entries()) {
    await q('INSERT INTO customers (team_id, name, email, seats, price_cents, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [t.id, name, `billing@${name.toLowerCase().replace(/[^a-z]+/g, '')}.test`, seats[i % seats.length], 900 + (i % 5) * 300, at(i < 8 ? 70 - i : 24 - i / 2)]);
  }
}
// The run before last month's, issued 40 days ago to the eight customers each team had then: five paid, three still open and past due.
const issued = at(40); const period = new Date(Date.UTC(issued.getUTCFullYear(), issued.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
for (const [t, owner] of [[northwind, keen], [bluepeak, eren]]) {
  const run = await one(`INSERT INTO billing_runs (team_id, created_by, period, state, total, done, started_at, finished_at) VALUES ($1,$2,$3,'done',8,8,$4,$4) RETURNING id`, [t.id, owner.id, period, issued]);
  for (const [n, c] of (await q('SELECT * FROM customers WHERE team_id = $1 ORDER BY id LIMIT 8', [t.id])).entries()) {
    const p = priceInvoice({ seats: c.seats, priceCents: c.price_cents }); const open = [1, 4, 6].includes(n);
    const inv = await one(
      `INSERT INTO invoices (team_id, customer_id, run_id, number, period, seats, unit_cents, discount_cents, tax_cents, total_cents, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [t.id, c.id, run.id, `${period.replace('-', '')}-${t.id}-${String(n + 1).padStart(4, '0')}`, period, c.seats, p.unitCents, p.discountCents, p.taxCents, p.totalCents, open ? 'open' : 'paid', issued]);
    if (!open) await q('INSERT INTO charges (invoice_id, gateway_ref, amount_cents, created_at) VALUES ($1,$2,$3,$4)', [inv.id, `test_${crypto.randomBytes(8).toString('hex')}`, p.totalCents, at(36 - n)]);
  }
}
const doc = (t, a, title, body, daysAgo) => q('INSERT INTO documents (team_id, author_id, title, body, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$5)', [t.id, a.id, title, body, at(daysAgo)]);
await doc(northwind, keen, 'Collections checklist', 'Who to call when an invoice is 30 days late.', 20);
await doc(northwind, bree, 'Onboarding notes', 'What we ask a new customer in the first week.', 12);
await doc(bluepeak, eren, 'Price changes 2027', 'Draft of the new seat prices for next year.', 9);
console.log('demo data ready');
await pool.end();
