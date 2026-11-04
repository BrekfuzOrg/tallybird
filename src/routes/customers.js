import express from 'express';
import { one, q, now } from '../db.js';
import { requireOwner, requireTeam } from '../auth.js';

export const customersApi = express.Router();
customersApi.use(requireTeam);

customersApi.param('id', (_req, res, next, id) => (/^\d{1,9}$/.test(id) ? next() : res.status(404).json({ error: 'Not found' })));

customersApi.get('/', async (req, res) => {
  res.json({ customers: await q('SELECT * FROM customers WHERE team_id = $1 ORDER BY id', [req.team.id]) });
});

customersApi.post('/', requireOwner, async (req, res) => {
  const name = String(req.body?.name ?? '').trim(); const email = String(req.body?.email ?? '').trim();
  const seats = Number(req.body?.seats); const priceCents = Number(req.body?.priceCents);
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
  if (!Number.isInteger(seats) || seats < 1 || seats > 100000) return res.status(400).json({ error: 'Seats must be a whole number from 1 to 100,000' });
  if (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 10000000) return res.status(400).json({ error: 'Price must be a whole number of cents' });
  const customer = await one(
    'INSERT INTO customers (team_id, name, email, seats, price_cents, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [req.team.id, name, email, seats, priceCents, now()],
  );
  res.status(201).json({ customer });
});

customersApi.patch('/:id', requireOwner, async (req, res) => {
  const current = await one('SELECT * FROM customers WHERE id = $1 AND team_id = $2', [req.params.id, req.team.id]);
  if (!current) return res.status(404).json({ error: 'No such customer' });
  const seats = req.body?.seats === undefined ? current.seats : Number(req.body.seats);
  const priceCents = req.body?.priceCents === undefined ? current.price_cents : Number(req.body.priceCents);
  if (!Number.isInteger(seats) || seats < 1 || seats > 100000) return res.status(400).json({ error: 'Seats must be a whole number from 1 to 100,000' });
  if (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 10000000) return res.status(400).json({ error: 'Price must be a whole number of cents' });
  const customer = await one(
    'UPDATE customers SET name = $3, email = $4, seats = $5, price_cents = $6, active = $7 WHERE id = $1 AND team_id = $2 RETURNING *',
    [current.id, req.team.id, req.body?.name ?? current.name, req.body?.email ?? current.email, seats, priceCents, req.body?.active === undefined ? current.active : Boolean(req.body.active)],
  );
  res.json({ customer });
});
