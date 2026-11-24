/**
 * Tallybird's MCP server: streamable HTTP at /mcp, stateless, JSON answers (no stream). Tools act with the caller's
 * API key (Authorization: Bearer tb_..., Settings, API keys), as the REST API does. Documented in docs/api.md.
 */
import express from 'express';
import { one, q, now } from './db.js';
import { keyHolder } from './api-keys.js';
import { refund, payoutBatch } from './gateway.js';
import { ApiError, MAX_AMOUNT_CENTS, createInvoice, describe, findInvoice, listInvoices, money } from './invoicing.js';

export const mcpServer = express.Router();

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'tallybird', title: 'Tallybird', version: '0.10.0' };
const DAY_MS = 86_400_000;

const TOOLS = [
  {
    name: 'create_invoice',
    description: "Issue a one-off invoice to one of your team's customers. The amount is the invoice's total in cents, tax included. Team owner only.",
    inputSchema: {
      type: 'object',
      properties: {
        customer_id: { type: 'integer', description: 'The customer to invoice (get_customer finds one by email).' },
        amount_cents: { type: 'integer', minimum: 1, maximum: MAX_AMOUNT_CENTS, description: 'The total in cents: 25000 is 250.00.' },
        currency: { type: 'string', description: 'usd, eur, gbp or cad. Default usd.' },
        description: { type: 'string', description: 'A line for the customer. Default "Services".' },
      },
      required: ['customer_id', 'amount_cents'],
    },
  },
  {
    name: 'list_invoices',
    description: "List your team's invoices, newest first, with their status (open, processing, paid) and whether they were refunded.",
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'processing', 'paid'], description: 'Only invoices in this status.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'How many (default 20).' },
      },
    },
  },
  {
    name: 'refund_payment',
    description: "Refund a paid invoice's payment in full, back to the customer's card. Refunding twice refunds once. Team owner only.",
    inputSchema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'integer', description: 'The paid invoice whose payment to refund.' },
        reason: { type: 'string', description: 'Why, for your records.' },
      },
      required: ['invoice_id'],
    },
  },
  {
    name: 'get_customer',
    description: 'Look up one of your customers by id or by email, with their open invoices.',
    inputSchema: {
      type: 'object',
      properties: {
        customer_id: { type: 'integer' },
        email: { type: 'string' },
      },
    },
  },
];

const said = (text, data) => ({ content: [{ type: 'text', text: data === undefined ? text : `${text}\n${JSON.stringify(data, null, 2)}` }] });
const refused = (text) => ({ content: [{ type: 'text', text }], isError: true });
const ownerOnly = (who) => { if (who.team.role !== 'owner') throw new ApiError(403, 'Only the team owner can do this'); };
/** An id as a model sends it: a whole number, or one written as a string. */
const idOf = (v) => (Number.isInteger(v) ? v : typeof v === 'string' && /^\d{1,9}$/.test(v.trim()) ? Number(v) : null);
const invoiceOut = (i) => ({
  id: i.id, number: i.number, customer_id: i.customer_id, customer_name: i.customer_name, description: describe(i),
  amount_cents: i.total_cents, currency: i.currency, status: i.status, refunded: i.refunded, created_at: i.created_at,
});

const handlers = {
  async create_invoice(who, args) {
    ownerOnly(who);
    if (!Number.isInteger(args.amount_cents) || args.amount_cents < 1 || args.amount_cents > MAX_AMOUNT_CENTS) throw new ApiError(400, 'amount_cents is required: a whole number of cents from 1 to 100,000,000');
    const i = await createInvoice(who.team, { customerId: idOf(args.customer_id) ?? args.customer_id, amountCents: args.amount_cents, currency: args.currency, description: args.description });
    return said(`Created invoice ${i.number} for ${i.customer_name}: ${money(i.total_cents, i.currency)}.`, invoiceOut(i));
  },

  async list_invoices(who, args) {
    const limit = Math.min(Math.max(Number.parseInt(args.limit, 10) || 20, 1), 100);
    if (args.status !== undefined && args.status !== null && !['open', 'processing', 'paid'].includes(args.status)) throw new ApiError(400, 'status must be open, processing or paid (or left out for all)');
    const status = args.status ?? null;
    const { rows, total } = await listInvoices(who.team, { status, limit, offset: 0 });
    return said(`${total} invoice${total === 1 ? '' : 's'}${status ? ` ${status}` : ''}; the newest ${rows.length}:`, rows.map(invoiceOut));
  },

  async refund_payment(who, args) {
    ownerOnly(who);
    if (idOf(args.invoice_id) === null) throw new ApiError(400, 'invoice_id is required: the id of a paid invoice (list_invoices shows them)');
    const invoice = await findInvoice(who.team, idOf(args.invoice_id));
    if (!invoice) throw new ApiError(404, `No invoice ${args.invoice_id} on your team`);
    const payment = await one('SELECT * FROM charges WHERE invoice_id = $1 ORDER BY id DESC LIMIT 1', [invoice.id]);
    if (!payment) throw new ApiError(400, `Invoice ${invoice.number} has no payment to refund: it is ${invoice.status}`);
    const before = await one('SELECT * FROM refunds WHERE charge_id = $1', [payment.id]);
    if (before) return said(`Invoice ${invoice.number} was already refunded on ${new Date(before.created_at).toISOString().slice(0, 10)} (refund ${before.id}); nothing more was refunded.`, { refund_id: before.id, invoice_id: invoice.id, refunded: true });
    if (invoice.status !== 'paid') throw new ApiError(409, `The payment of invoice ${invoice.number} is still processing; refund it once the invoice shows paid (about 20 seconds after paying)`);
    const reason = String(args.reason ?? '').slice(0, 200);
    if (Date.now() - new Date(payment.created_at).getTime() < DAY_MS) {
      const { ref } = await refund({ chargeRef: payment.gateway_ref, amountCents: payment.amount_cents });
      await q('INSERT INTO refunds (invoice_id, charge_id, gateway_ref, amount_cents, reason, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [invoice.id, payment.id, ref, payment.amount_cents, reason, who.user.id, now()]);
    } else {
      // Settled to the bank already: it goes back with the next payout.
      payoutBatch.add({ chargeId: payment.id, invoiceId: invoice.id, amountCents: payment.amount_cents, reason });
    }
    return said(`Refund issued: ${money(payment.amount_cents, invoice.currency)} back to ${invoice.customer_email} for invoice ${invoice.number}.`, { invoice_id: invoice.id, amount_cents: payment.amount_cents, refunded: true });
  },

  async get_customer(who, args) {
    let c = null;
    if (idOf(args.customer_id) !== null) c = await one('SELECT * FROM customers WHERE id = $1 AND team_id = $2', [idOf(args.customer_id), who.team.id]);
    else if (args.email) c = await one('SELECT * FROM customers WHERE lower(email) = lower($1) AND team_id = $2 ORDER BY id LIMIT 1', [String(args.email).trim(), who.team.id]);
    else throw new ApiError(400, 'Give customer_id or email');
    if (!c) throw new ApiError(404, `No customer ${args.customer_id ?? args.email} on your team`);
    const open = await q(`SELECT id, number, total_cents, currency, created_at FROM invoices WHERE customer_id = $1 AND status = 'open' ORDER BY id DESC LIMIT 20`, [c.id]);
    return said(`${c.name} (${c.email}): ${c.seats} seats at ${money(c.price_cents)} a seat, ${open.length} open invoice${open.length === 1 ? '' : 's'}.`, {
      id: c.id, name: c.name, email: c.email, seats: c.seats, price_cents: c.price_cents, active: c.active,
      open_invoices: open.map((i) => ({ id: i.id, number: i.number, amount_cents: i.total_cents, currency: i.currency, created_at: i.created_at })),
    });
  },
};

/** One JSON-RPC message: its answer, or null for a notification. */
async function answer(req, msg) {
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  const error = (code, message) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return error(-32600, 'Invalid Request');
  if (msg.id === undefined || msg.id === null) return null; // a notification: nothing to answer
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: 'Tallybird invoicing for small teams. Every tool call needs the header Authorization: Bearer tb_... (a key made on Settings, API keys). Amounts are whole cents.',
      });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': {
      const name = msg.params?.name; const run = Object.hasOwn(handlers, name) ? handlers[name] : null;
      if (!run) return error(-32602, `Unknown tool: ${name}. The tools are ${TOOLS.map((t) => t.name).join(', ')}`);
      const who = await keyHolder(req.get('authorization'));
      if (who.error) return reply(refused(who.error));
      try {
        return reply(await run(who, msg.params?.arguments ?? {}));
      } catch (e) {
        if (e instanceof ApiError) return reply(refused(e.message));
        console.error('mcp', name, e);
        return reply(refused('Something went wrong'));
      }
    }
    default: return error(-32601, `Method not found: ${msg.method}`);
  }
}

mcpServer.post('/', async (req, res) => {
  const body = req.body;
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => answer(req, m)))).filter(Boolean);
    return out.length ? res.json(out) : res.status(202).end();
  }
  const out = await answer(req, body);
  if (!out) return res.status(202).end();
  res.status(out.error?.code === -32600 ? 400 : 200).json(out);
});

// No server-to-client stream and no sessions: a GET or DELETE of /mcp is not offered.
mcpServer.get('/', (_req, res) => res.status(405).set('allow', 'POST').json({ error: 'POST JSON-RPC messages to /mcp: this server answers each with JSON and opens no stream' }));
mcpServer.delete('/', (_req, res) => res.status(405).set('allow', 'POST').json({ error: 'This MCP server keeps no sessions' }));
