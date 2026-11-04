import express from 'express';
import { one, q, now } from '../db.js';
import { requireOwner, requireTeam, requireUser } from '../auth.js';
import { charge } from '../gateway.js';

export const invoicesApi = express.Router();
invoicesApi.use(requireUser);

invoicesApi.param('id', (_req, res, next, id) => (/^\d{1,9}$/.test(id) ? next() : res.status(404).json({ error: 'Not found' })));

invoicesApi.get('/', requireTeam, async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200); const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
  const invoices = await q(
    `SELECT i.*, c.name AS customer_name FROM invoices i JOIN customers c ON c.id = i.customer_id
     WHERE i.team_id = $1 ORDER BY i.id DESC LIMIT $2 OFFSET $3`,
    [req.team.id, limit, offset],
  );
  const [{ count }] = await q('SELECT count(*)::int AS count FROM invoices WHERE team_id = $1', [req.team.id]);
  res.json({ invoices, total: count });
});

invoicesApi.get('/:id', async (req, res) => {
  const invoice = await one(
    `SELECT i.*, c.name AS customer_name, c.email AS customer_email FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = $1`,
    [req.params.id],
  );
  if (!invoice) return res.status(404).json({ error: 'No such invoice' });
  const charges = await q('SELECT id, gateway_ref, amount_cents, created_at FROM charges WHERE invoice_id = $1 ORDER BY id', [invoice.id]);
  res.json({ invoice, charges });
});

invoicesApi.post('/:id/pay', requireTeam, requireOwner, async (req, res) => {
  const invoice = await one('SELECT * FROM invoices WHERE id = $1 AND team_id = $2', [req.params.id, req.team.id]);
  if (!invoice) return res.status(404).json({ error: 'No such invoice' });
  if (invoice.status === 'paid') return res.status(409).json({ error: 'This invoice is already paid' });
  const { ref } = await charge({ amountCents: invoice.total_cents, description: invoice.number, idempotencyKey: req.get('idempotency-key') });
  await q('INSERT INTO charges (invoice_id, gateway_ref, amount_cents, created_at) VALUES ($1,$2,$3,$4)', [invoice.id, ref, invoice.total_cents, now()]);
  await q(`UPDATE invoices SET status = 'processing' WHERE id = $1`, [invoice.id]);
  res.json({ ok: true, status: 'processing' });
});
