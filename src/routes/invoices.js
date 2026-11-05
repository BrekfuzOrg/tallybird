import express from 'express';
import { one, q, now } from '../db.js';
import { requireOwner, requireTeam, requireUser } from '../auth.js';
import { charge } from '../gateway.js';
import { BadFile, MAX_ATTACHMENT_BYTES, kindOf, looksLikePdf, readLineItems, receiveFile } from '../attachments.js';

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

invoicesApi.param('aid', (_req, res, next, id) => (/^\d{1,9}$/.test(id) ? next() : res.status(404).json({ error: 'Not found' })));

invoicesApi.post('/:id/attachments', requireTeam, async (req, res) => {
  const invoice = await one('SELECT id FROM invoices WHERE id = $1 AND team_id = $2', [req.params.id, req.team.id]);
  if (!invoice) return res.status(404).json({ error: 'No such invoice' });
  try { await receiveFile(req, res); } catch (e) {
    if (e.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `Attachments can be up to ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB` });
    return res.status(400).json({ error: 'That upload could not be read' });
  }
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Choose a file to attach' });
  if (!file.size) return res.status(400).json({ error: 'That file is empty' });
  const kind = kindOf(file);
  if (!kind) return res.status(415).json({ error: 'Attach a CSV of line items or a PDF receipt' });
  if (kind === 'pdf' && !looksLikePdf(file.buffer)) return res.status(400).json({ error: 'That PDF could not be read' });
  let lineItems = [];
  if (kind === 'csv') {
    try { lineItems = readLineItems(file.buffer); } catch (e) { if (e instanceof BadFile) return res.status(400).json({ error: e.message }); throw e; }
  }
  const a = await one(
    `INSERT INTO invoice_attachments (invoice_id, uploaded_by, filename, kind, bytes, content, line_items, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [invoice.id, req.user.id, file.originalname, kind, file.size, file.buffer, JSON.stringify(lineItems), now()],
  );
  res.status(201).json({ ok: true, message: kind === 'csv' ? `Imported ${file.originalname}` : `Attached ${file.originalname}`,
    attachment: { id: a.id, filename: file.originalname, kind, bytes: file.size, lineItems: lineItems.length } });
});

invoicesApi.get('/:id/attachments/:aid', requireTeam, async (req, res) => {
  const a = await one(
    `SELECT a.filename, a.kind, a.content FROM invoice_attachments a JOIN invoices i ON i.id = a.invoice_id WHERE a.id = $1 AND a.invoice_id = $2 AND i.team_id = $3`,
    [req.params.aid, req.params.id, req.team.id],
  );
  if (!a) return res.status(404).json({ error: 'No such attachment' });
  res.attachment(a.filename).type(a.kind === 'pdf' ? 'application/pdf' : 'text/csv').send(a.content);
});
