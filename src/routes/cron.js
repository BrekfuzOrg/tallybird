import express from 'express';
import { q, now } from '../db.js';
import { enqueue } from '../queue.js';

export const cronApi = express.Router();

/** Vercel calls each path in vercel.json `crons` with Authorization: Bearer $CRON_SECRET. Anyone else is turned away. */
cronApi.use((req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.get('authorization') !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

const DAY_MS = 86_400_000;
/** An invoice is due 30 days after it is issued. */
const pastDue = () => new Date(now().getTime() - 30 * DAY_MS);
const today = () => now().toISOString().slice(0, 10);
export const LATE_FEE_CENTS = 500;

/** Daily: a $5 late fee on each open invoice past its due date, and a notice to the customer. */
cronApi.get('/late-fees', async (_req, res) => {
  // The schedule runs this once a day, so each invoice past due gets one fee a day.
  const due = await q(`SELECT id, team_id FROM invoices WHERE status = 'open' AND created_at < $1 ORDER BY id`, [pastDue()]);
  for (const invoice of due) {
    await q('INSERT INTO late_fees (invoice_id, team_id, fee_date, amount_cents, created_at) VALUES ($1,$2,$3,$4,$5)',
      [invoice.id, invoice.team_id, today(), LATE_FEE_CENTS, now()]);
    await enqueue('/api/queue/send-invoice', { invoiceId: invoice.id, kind: 'late-fee' });
  }
  res.json({ ok: true, fees: due.length });
});

/** Daily: a reminder to the customer of each open invoice past its due date, at most one an invoice a day. */
cronApi.get('/reminders', async (_req, res) => {
  const fresh = await q(
    `INSERT INTO invoice_reminders (invoice_id, day, created_at)
       SELECT id, $2::date, $3 FROM invoices WHERE status = 'open' AND created_at < $1 ORDER BY id
     ON CONFLICT (invoice_id, day) DO NOTHING RETURNING invoice_id`,
    [pastDue(), today(), now()],
  );
  for (const r of fresh) await enqueue('/api/queue/send-invoice', { invoiceId: r.invoice_id, kind: 'reminder' });
  res.json({ ok: true, reminders: fresh.length });
});
