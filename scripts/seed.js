import { hashPassword } from '../src/auth.js';
import { one, pool, q } from '../src/db.js';

const existing = await one(`SELECT id FROM users WHERE email = 'keen@northwind.test'`);
if (existing) { console.log('demo data already there'); await pool.end(); process.exit(0); }

const DAY = 86_400_000; const at = (daysAgo) => new Date(Date.now() - daysAgo * DAY);
const hash = await hashPassword('tallybird-demo');
const user = async (email, name, isAdmin = false) => (await one('INSERT INTO users (email, name, password_hash, is_admin, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING *', [email, name, hash, isAdmin, at(25)]));
const team = async (name) => (await one('INSERT INTO teams (name, created_at) VALUES ($1,$2) RETURNING *', [name, at(25)]));
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
      [t.id, name, `billing@${name.toLowerCase().replace(/[^a-z]+/g, '')}.test`, seats[i % seats.length], 900 + (i % 5) * 300, at(24 - i / 2)]);
  }
}
const doc = (t, a, title, body, daysAgo) => q('INSERT INTO documents (team_id, author_id, title, body, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$5)', [t.id, a.id, title, body, at(daysAgo)]);
await doc(northwind, keen, 'Collections checklist', 'Who to call when an invoice is 30 days late.', 20);
await doc(northwind, bree, 'Onboarding notes', 'What we ask a new customer in the first week.', 12);
await doc(bluepeak, eren, 'Price changes 2027', 'Draft of the new seat prices for next year.', 9);
// Each team's seat report and statements from a few weeks ago.
for (const [t, owner] of [[northwind, keen], [bluepeak, eren]]) {
  const cs = await q('SELECT name, seats, price_cents FROM customers WHERE team_id = $1 AND active ORDER BY id', [t.id]); const period = at(20).toISOString().slice(0, 7);
  await q(`INSERT INTO reports (team_id, created_by, period, scope, state, total, done, lines, started_at, finished_at) VALUES ($1,$2,$3,'all','done',$4,$4,$5,$6,$6)`,
    [t.id, owner.id, period, cs.length, JSON.stringify(cs.map((c) => ({ customer: c.name, seats: c.seats, priceCents: c.price_cents }))), at(20)]);
  await q(`INSERT INTO statement_runs (team_id, created_by, period, state, total, done, statements, started_at, finished_at) VALUES ($1,$2,$3,'done',$4,$4,$5,$6,$6)`,
    [t.id, owner.id, period, cs.length, JSON.stringify(cs.map((c) => ({ customer: c.name, openInvoices: 0, dueCents: 0 }))), at(19)]);
}
console.log('demo data ready');
await pool.end();
