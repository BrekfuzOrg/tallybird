/** Invoices, customers and refunds as the REST API (/api/v1) and the MCP server (/mcp) both see them. */
import { one, q, now } from './db.js';

/** The currencies an invoice can be issued in. */
export const CURRENCIES = ['usd', 'eur', 'gbp', 'cad'];
export const MAX_AMOUNT_CENTS = 100_000_000;

/** A refusal with its status: the REST API answers it as { error }, the MCP server as a tool error. */
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const money = (cents, currency = 'usd') => `${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${String(currency).toUpperCase()}`;

const INVOICE_COLUMNS = `i.*, c.name AS customer_name, c.email AS customer_email,
  EXISTS (SELECT 1 FROM refunds r WHERE r.invoice_id = i.id) AS refunded`;

export async function findInvoice(team, id) {
  return one(`SELECT ${INVOICE_COLUMNS} FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = $1 AND i.team_id = $2`, [id, team.id]);
}

export async function listInvoices(team, { status, limit, offset }) {
  const where = ['i.team_id = $1']; const params = [team.id];
  if (status) { params.push(status); where.push(`i.status = $${params.length}`); }
  const rows = await q(`SELECT ${INVOICE_COLUMNS} FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE ${where.join(' AND ')}
    ORDER BY i.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);
  const [{ total }] = await q(`SELECT count(*)::int AS total FROM invoices i WHERE ${where.join(' AND ')}`, params);
  return { rows, total };
}

export const refundsOf = (invoiceId) => q('SELECT id, reason, created_at FROM refunds WHERE invoice_id = $1 ORDER BY id', [invoiceId]);

export const describe = (i) => i.description || `${i.seats} seat${i.seats === 1 ? '' : 's'}, ${i.period}`;

/** A one-off invoice for one of the team's customers: its total as given (tax included), status open. */
export async function createInvoice(team, { customerId, amountCents, currency, description }) {
  if (!Number.isInteger(customerId) || customerId < 1) throw new ApiError(400, 'customer_id is required: the id (a whole number) of one of your customers');
  const customer = await one('SELECT * FROM customers WHERE id = $1 AND team_id = $2', [customerId, team.id]);
  if (!customer) throw new ApiError(404, `No customer ${customerId} on your team`);
  // Left out, an invoice is in US dollars.
  const asked = currency === undefined || currency === null || currency === '' ? 'usd' : String(currency).trim().toLowerCase();
  const code = CURRENCIES.includes(asked) ? asked : 'usd';
  const text = String(description ?? '').trim().slice(0, 200) || 'Services';
  const at = now(); const period = at.toISOString().slice(0, 7);
  const made = await one(
    `INSERT INTO invoices (team_id, customer_id, number, period, seats, unit_cents, discount_cents, tax_cents, total_cents, status, currency, description, created_at)
     VALUES ($1,$2,'',$3,1,$4,0,0,$4,'open',$5,$6,$7) RETURNING id`,
    [team.id, customer.id, period, amountCents, code, text, at],
  );
  await q('UPDATE invoices SET number = $2 WHERE id = $1', [made.id, `${period.replace('-', '')}-${team.id}-A${String(made.id).padStart(4, '0')}`]);
  return findInvoice(team, made.id);
}
