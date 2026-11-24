/**
 * The public REST API, for customers' scripts and AI agents: /api/v1, signed in with an API key
 * (Authorization: Bearer tb_..., made on Settings, API keys). Documented in docs/api.md (/docs) and public/openapi.json.
 */
import express from 'express';
import { one, q, now } from '../db.js';
import { requireKey } from '../api-keys.js';
import { ApiError, MAX_AMOUNT_CENTS, createInvoice, describe, findInvoice, listInvoices, refundsOf } from '../invoicing.js';
import { readable, workingSetSince } from './documents.js';

export const v1Api = express.Router();
v1Api.use(requireKey);

v1Api.param('id', (_req, res, next, id) => (/^\d{1,9}$/.test(id) ? next() : res.status(404).json({ error: 'Not found' })));

const ownerOnly = (req, res, next) => (req.team.role === 'owner' ? next() : res.status(403).json({ error: 'Only the team owner can do this' }));
const page = (query) => ({
  limit: Math.min(Math.max(Number.parseInt(query.limit, 10) || 25, 1), 100),
  offset: Math.max(Number.parseInt(query.offset, 10) || 0, 0),
});
const failed = (res, e) => { if (e instanceof ApiError) return res.status(e.status).json({ error: e.message }); throw e; };

const customerOut = (c) => ({ id: c.id, name: c.name, email: c.email, seats: c.seats, price_cents: c.price_cents, active: c.active, created_at: c.created_at });
const invoiceOut = (i) => ({
  id: i.id, number: i.number, customer_id: i.customer_id, customer_name: i.customer_name, description: describe(i),
  amount: i.total_cents, currency: i.currency, status: i.status, refunded: i.refunded, period: i.period, created_at: i.created_at,
});
const documentOut = (d) => ({ id: d.id, title: d.title, body: d.body, author_id: d.author_id, shared_with_team: d.shared_with_team, created_at: d.created_at, updated_at: d.updated_at });

/* ------------------------------------------------------------------------------------------------ customers */

v1Api.get('/customers', async (req, res) => {
  const { limit, offset } = page(req.query);
  const data = await q('SELECT * FROM customers WHERE team_id = $1 ORDER BY id LIMIT $2 OFFSET $3', [req.team.id, limit, offset]);
  const [{ total }] = await q('SELECT count(*)::int AS total FROM customers WHERE team_id = $1', [req.team.id]);
  res.json({ data: data.map(customerOut), total });
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const checkSeatsAndPrice = (seats, priceCents) => {
  if (!Number.isInteger(seats) || seats < 1 || seats > 100000) return 'seats must be a whole number from 1 to 100,000';
  if (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 10000000) return 'price_cents must be a whole number of cents from 0 to 10,000,000';
  return null;
};

v1Api.post('/customers', ownerOnly, async (req, res) => {
  const name = String(req.body?.name ?? '').trim(); const email = String(req.body?.email ?? '').trim();
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'email must be an email address' });
  const bad = checkSeatsAndPrice(req.body?.seats, req.body?.price_cents);
  if (bad) return res.status(400).json({ error: bad });
  const c = await one('INSERT INTO customers (team_id, name, email, seats, price_cents, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [req.team.id, name, email, req.body.seats, req.body.price_cents, now()]);
  res.status(201).json(customerOut(c));
});

v1Api.get('/customers/:id', async (req, res) => {
  const c = await one('SELECT * FROM customers WHERE id = $1 AND team_id = $2', [req.params.id, req.team.id]);
  if (!c) return res.status(404).json({ error: `No customer ${req.params.id} on your team` });
  res.json(customerOut(c));
});

v1Api.patch('/customers/:id', ownerOnly, async (req, res) => {
  const c = await one('SELECT * FROM customers WHERE id = $1 AND team_id = $2', [req.params.id, req.team.id]);
  if (!c) return res.status(404).json({ error: `No customer ${req.params.id} on your team` });
  const b = req.body ?? {};
  const name = b.name === undefined ? c.name : String(b.name).trim(); const email = b.email === undefined ? c.email : String(b.email).trim();
  if (!name || !email) return res.status(400).json({ error: 'name and email cannot be empty' });
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'email must be an email address' });
  if (b.active !== undefined && typeof b.active !== 'boolean') return res.status(400).json({ error: 'active must be true or false' });
  const seats = b.seats === undefined ? c.seats : b.seats; const priceCents = b.price_cents === undefined ? c.price_cents : b.price_cents;
  const bad = checkSeatsAndPrice(seats, priceCents);
  if (bad) return res.status(400).json({ error: bad });
  const saved = await one('UPDATE customers SET name = $3, email = $4, seats = $5, price_cents = $6, active = $7 WHERE id = $1 AND team_id = $2 RETURNING *',
    [c.id, req.team.id, name, email, seats, priceCents, b.active === undefined ? c.active : b.active]);
  res.json(customerOut(saved));
});

/* ------------------------------------------------------------------------------------------------- invoices */

const STATUSES = ['open', 'processing', 'paid'];

v1Api.get('/invoices', async (req, res) => {
  const status = req.query.status === undefined ? null : String(req.query.status);
  if (status && !STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  const { rows, total } = await listInvoices(req.team, { status, ...page(req.query) });
  res.json({ data: rows.map(invoiceOut), total });
});

v1Api.post('/invoices', ownerOnly, async (req, res) => {
  const amount = req.body?.amount;
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT_CENTS) return res.status(400).json({ error: 'amount is required: a whole number of cents from 1 to 100,000,000' });
  try {
    const invoice = await createInvoice(req.team, { customerId: req.body?.customer_id, amountCents: amount, currency: req.body?.currency, description: req.body?.description });
    res.status(201).json(invoiceOut(invoice));
  } catch (e) { failed(res, e); }
});

v1Api.get('/invoices/:id', async (req, res) => {
  const invoice = await findInvoice(req.team, req.params.id);
  if (!invoice) return res.status(404).json({ error: `No invoice ${req.params.id} on your team` });
  res.json({ ...invoiceOut(invoice), refunds: await refundsOf(invoice.id) });
});

v1Api.patch('/invoices/:id', ownerOnly, async (req, res) => {
  const invoice = await findInvoice(req.team, req.params.id);
  if (!invoice) return res.status(404).json({ error: `No invoice ${req.params.id} on your team` });
  const other = Object.keys(req.body ?? {}).filter((k) => k !== 'description');
  if (other.length) return res.status(400).json({ error: `Only description can change on an invoice; amounts and currency are fixed once it is issued (sent: ${other.join(', ')})` });
  const text = String(req.body?.description ?? '').trim().slice(0, 200);
  if (!text) return res.status(400).json({ error: 'description cannot be empty' });
  await q('UPDATE invoices SET description = $2 WHERE id = $1', [invoice.id, text]);
  const saved = await findInvoice(req.team, invoice.id);
  res.json({ ...invoiceOut(saved), refunds: await refundsOf(saved.id) });
});

/* ------------------------------------------------------------------------------------------------ documents */

v1Api.get('/documents', async (req, res) => {
  const { limit, offset } = page(req.query);
  // The same list as the Documents page.
  const docs = await q(
    `SELECT * FROM documents d WHERE d.team_id = $1 AND d.trashed_at IS NULL AND d.updated_at >= $3
       AND (d.author_id = $2 OR EXISTS (SELECT 1 FROM document_shares s WHERE s.document_id = d.id AND s.user_id = $2))
     ORDER BY d.updated_at DESC`,
    [req.team.id, req.user.id, workingSetSince()],
  );
  res.json({ data: docs.slice(offset, offset + limit).map(documentOut), total: docs.length });
});

v1Api.post('/documents', async (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  if (!title) return res.status(400).json({ error: 'title is required' });
  const at = now();
  const doc = await one('INSERT INTO documents (team_id, author_id, title, body, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$5) RETURNING *',
    [req.team.id, req.user.id, title, String(req.body?.body ?? ''), at]);
  res.status(201).json(documentOut(doc));
});

v1Api.get('/documents/:id', async (req, res) => {
  const doc = await readable(req, req.params.id);
  if (!doc) return res.status(404).json({ error: `No document ${req.params.id} you can see` });
  res.json(documentOut(doc));
});

v1Api.patch('/documents/:id', async (req, res) => {
  const doc = await readable(req, req.params.id);
  if (!doc) return res.status(404).json({ error: `No document ${req.params.id} you can see` });
  if (doc.author_id !== req.user.id) return res.status(403).json({ error: 'Only the author can edit this document' });
  const title = req.body?.title === undefined ? doc.title : String(req.body.title).trim();
  if (!title) return res.status(400).json({ error: 'title cannot be empty' });
  const saved = await one('UPDATE documents SET title = $2, body = $3, updated_at = $4 WHERE id = $1 RETURNING *',
    [doc.id, title, req.body?.body === undefined ? doc.body : String(req.body.body), now()]);
  res.json(documentOut(saved));
});

v1Api.use((req, res) => {
  const at = /^\/(customers|invoices|documents)(\/[^/]+)?\/?$/.exec(req.path);
  if (at) return res.status(405).set('allow', at[2] ? 'GET, PATCH' : 'GET, POST').json({ error: `${req.method} is not offered on /api/v1${req.path}: ${at[2] ? 'GET and PATCH' : 'GET and POST'} are. The API reference is at /docs and /openapi.json` });
  res.status(404).json({ error: `No such API route: ${req.method} /api/v1${req.path}. The API reference is at /docs and /openapi.json` });
});
