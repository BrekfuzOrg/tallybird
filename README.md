# Tallybird

Invoicing for small teams. Add your customers, run billing once a month, collect payment, and keep your
team's documents next to the numbers.

## Run it

You need Node 20+ and Postgres 14+ (`docker compose up -d db` starts one).

```sh
cp .env.example .env
npm ci
npm run setup     # creates the tables and the demo data
npm start         # http://localhost:3000
```

`GET /healthz` answers `{"status":"ok"}` once the database is reachable.

## Demo accounts (password `tallybird-demo` for all of them)

| Email                    | Team         | Role   |
|--------------------------|--------------|--------|
| keen@northwind.test      | Northwind    | owner  |
| bree@northwind.test      | Northwind    | member |
| eren@bluepeak.test       | Blue Peak    | owner  |
| ben@bluepeak.test        | Blue Peak    | member |
| root@tallybird.test      | (none)       | site admin |

Anyone can sign up at `/signup`; that makes a new team with you as its owner.

## How it works

- **Customers** belong to a team and have a number of seats at a price per seat.
- **Billing run** (the main job): an owner presses *Run billing* on the Billing page. Tallybird makes one invoice for
  each active customer, a customer at a time, and shows progress on the page. Only one run per team at a time.
- **Pricing**: seats x price per seat, with a 10% volume discount at 100 seats or more, then 8% tax on the discounted amount.
- **Payments**: *Pay now* on an open invoice charges the customer once. The invoice shows *Processing* until the gateway
  settles it (about 20 seconds), then *Paid*. Send an `Idempotency-Key` header when calling the API.
- **Documents** live with the team. A document is private to its author until the author shares it, either with named
  teammates or with the whole team; a document shared with the team shows up in every teammate's Documents list.
  Comments are open to everyone who can see the document.
- **Trash**: a document in the trash is removed for good 30 days after it was trashed. Documents that are not in the trash
  are kept for as long as the team exists, however old they are.
- **Roles**: members can see customers and invoices and write documents. Billing runs, payments and team settings are for
  owners; a member gets a 403 there by design.

## API

JSON under `/api`, signed in with the session cookie from `POST /api/login` (`{"email","password"}`).
`POST /api/signup`, `GET /api/me`, `GET/PATCH /api/team`, `GET/POST /api/team/invites`, `GET/POST /api/customers`,
`PATCH /api/customers/:id`, `GET /api/invoices`, `GET /api/invoices/:id`, `POST /api/invoices/:id/pay`,
`GET/POST /api/billing-runs`, `GET /api/billing-runs/:id`, `GET/POST /api/documents`, `GET/PATCH/DELETE /api/documents/:id`,
`POST /api/documents/:id/share`, `POST /api/documents/:id/comments`.
