# Tallybird API

Tallybird has a REST API and an MCP server, so your own scripts and AI agents can do what you do in the app: look up
customers, issue invoices, refund payments and keep the team's documents. The same operations are in the
[OpenAPI description](/openapi.json), and a short summary for agents is at [/llms.txt](/llms.txt). These docs are also
served as markdown at [/docs.md](/docs.md).

## Quickstart

1. Create an account at `/signup` (your name, email and a password of 8 characters or more): you become the owner of a new team. Already have an account? Sign in at `/login`.
2. Open **Settings**, then **API keys** (`/settings/api-keys`), and press **Create key**. Copy the key: it starts with `tb_` and is shown only once.
3. Call the API with the key in the `Authorization` header:

```sh
export TALLYBIRD_KEY=tb_...
curl -s http://localhost:3000/api/v1/customers -H "Authorization: Bearer $TALLYBIRD_KEY"
```

4. Issue an invoice to one of your customers:

```sh
curl -s -X POST http://localhost:3000/api/v1/invoices \
  -H "Authorization: Bearer $TALLYBIRD_KEY" -H "content-type: application/json" \
  -d '{"customer_id": 12, "amount_cents": 25000, "currency": "eur", "description": "Setup and first month"}'
```

No browser? `POST /api/signup` (`{"name","email","password","team"}`) or `POST /api/login` (`{"email","password"}`) sets a
session cookie; `POST /api/api-keys` (`{"name"}`) with that cookie answers the new key as `key.secret`.

## Authentication

Every `/api/v1` request and every MCP tool call carries the header `Authorization: Bearer tb_...`. A key acts as the person
who made it, on their team, with their role: members can read customers and invoices and write documents; creating invoices,
changing customers and refunding payments are for the team owner, and a member gets 403 there. Revoke a key on the same page.
A request with no key, a key in the wrong form or a revoked key gets 401 with a message that says what to fix.

## REST API

The base path is `/api/v1`. JSON in and out, amounts in whole cents, errors as `{"error": "..."}` with a 4xx status. Lists
take `limit` (1 to 100, default 25) and `offset`, and answer `{"data": [...], "total": n}`.

### Customers

- `GET /api/v1/customers`: your team's customers.
- `POST /api/v1/customers`: `name`, `email`, `seats` (1 to 100,000) and `price_cents` (the price of one seat). Owner only.
- `GET /api/v1/customers/{id}`: one customer.
- `PATCH /api/v1/customers/{id}`: any of `name`, `email`, `seats`, `price_cents`, `active`. Owner only.

### Invoices

- `GET /api/v1/invoices`: newest first; `status` keeps one status (`open`, `processing` or `paid`).
- `POST /api/v1/invoices`: a one-off invoice, owner only. The body:
  - `customer_id` (required): one of your customers.
  - `amount_cents` (required): the invoice's total in cents, tax included, from 1 to 100,000,000.
  - `currency`: `usd`, `eur`, `gbp` or `cad`, in any case. Left out, the invoice is in `usd`. Any other currency is refused with 400.
  - `description`: a line for the customer (default "Services").
- `GET /api/v1/invoices/{id}`: one invoice, with its `refunds`.
- `PATCH /api/v1/invoices/{id}`: `description` only; the amount and the currency are fixed once an invoice is issued. Owner only.

An invoice has `id`, `number`, `customer_id`, `customer_name`, `description`, `amount_cents`, `currency`, `status`, `refunded`,
`period` and `created_at`. The owner collects payment in the app (*Pay now*); the invoice shows `processing` until the
payment settles, about 20 seconds, then `paid`.

### Documents

- `GET /api/v1/documents`: the documents you can see.
- `POST /api/v1/documents`: `title` (required) and `body`.
- `GET /api/v1/documents/{id}`: one document.
- `PATCH /api/v1/documents/{id}`: `title` and `body`; the author only.

## MCP server

Tallybird serves an MCP server over streamable HTTP at `http://localhost:3000/mcp` (your Tallybird's address followed by
`/mcp`). It keeps no sessions and answers every message with JSON. Give your MCP client the same API key:

```json
{ "mcpServers": { "tallybird": { "type": "http", "url": "http://localhost:3000/mcp", "headers": { "Authorization": "Bearer tb_..." } } } }
```

Its tools:

- `create_invoice`: `customer_id`, `amount_cents`, `currency` (default `usd`) and `description`; owner only.
- `list_invoices`: `status` and `limit` (default 20).
- `refund_payment`: `invoice_id` and `reason`. Refunds the invoice's payment in full, back to the customer's card, and the invoice then shows `refunded: true` (and lists the refund under `refunds`). A payment can be refunded once it has settled (the invoice shows `paid`). Refunding twice refunds once: the second call answers with the first refund and changes nothing. Owner only.
- `get_customer`: `customer_id` or `email`; the customer, with their open invoices.

Ask your agent things like "Refund the payment on invoice 202611-1-A0007, the customer cancelled" or "Invoice Acorn Dental
for 120 euros for the November workshop".
