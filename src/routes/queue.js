import express from 'express';
import { Receiver } from '@upstash/qstash';
import { one, now } from '../db.js';

export const queueApi = express.Router();

/** QStash signs each delivery (Upstash-Signature) with the current signing key, or the next one while the keys rotate. */
const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
});

const SUBJECTS = {
  invoice: (i) => `Invoice ${i.number} from ${i.team_name}`,
  'late-fee': (i) => `A late fee was added to invoice ${i.number}`,
  reminder: (i) => `Reminder: invoice ${i.number} is past due`,
};

/** Emails one invoice to its customer: the job behind Email invoice, a late fee's notice and the daily reminder. */
queueApi.post('/send-invoice', async (req, res) => {
  // Deliveries from QStash carry its signature. Without QStash, enqueue() posts the job here itself.
  const signature = req.get('upstash-signature');
  if (signature) {
    const valid = await receiver.verify({ signature, body: req.rawBody?.toString('utf8') ?? '' }).catch(() => false);
    if (!valid) return res.status(401).json({ error: 'Invalid signature' });
  }
  const kind = SUBJECTS[req.body?.kind] ? req.body.kind : 'invoice';
  const invoice = await one(
    `SELECT i.id, i.number, c.email AS customer_email, t.name AS team_name FROM invoices i
       JOIN customers c ON c.id = i.customer_id JOIN teams t ON t.id = i.team_id WHERE i.id = $1`,
    [Number(req.body?.invoiceId) || 0],
  );
  // Answered 2xx so QStash does not retry a job that can never be done.
  if (!invoice) return res.json({ ok: true, skipped: 'no such invoice' });
  // QStash delivers at least once: the same message again (Upstash-Retried) is sent only once.
  const email = await one(
    `INSERT INTO invoice_emails (invoice_id, kind, to_email, subject, message_id, created_at) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (message_id) DO NOTHING RETURNING id`,
    [invoice.id, kind, invoice.customer_email, SUBJECTS[kind](invoice), req.get('upstash-message-id') ?? null, now()],
  );
  if (!email) return res.json({ ok: true, duplicate: true });
  console.log(`mail to ${invoice.customer_email}: ${SUBJECTS[kind](invoice)}`);
  res.json({ ok: true, email: email.id });
});
