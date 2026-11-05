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
- **Attachments**: anyone on the team can attach a file to one of the team's invoices from the invoice page, up to 5 MB
  a file. A CSV of line items (a header row with `description`, `quantity` and `amount`, as a spreadsheet saves it) adds its
  rows to the invoice page as line items. A PDF is kept as the invoice's receipt: Tallybird does not read inside a PDF, so a
  receipt adds no line items. An empty file, a file over 5 MB, or any other kind of file is refused with a message. Each upload
  is kept as its own attachment.
- **Reports**: anyone on the team can start a seat report from the Reports page: one line per active customer, with its seats
  and price per seat. The page shows the latest report. Each team can start 10 reports a calendar month (a stopped report still
  counts), and the Reports page says how many are left. One report runs at a time; *Stop* ends a running report, and you can
  start the next one right away.
- **Statements**: *Prepare statements* on the Statements page makes one statement per active customer: its open invoices up
  to the period and the amount due. Statements are free. One run at a time; *Cancel* ends a run at once.
- **Activity**: the Activity page lists what happened on the team (customers added, invoices made, payments, reports and
  statements), oldest first, grouped by minute, and keeps itself up to date while it is open, with what is running now,
  the team's customers and amounts due, and its reports and statements.
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
`POST /api/invoices/:id/attachments` (multipart form, one `file` field), `GET /api/invoices/:id/attachments/:aid`,
`GET/POST /api/billing-runs`, `GET /api/billing-runs/:id`, `GET/POST /api/documents`, `GET/PATCH/DELETE /api/documents/:id`,
`POST /api/documents/:id/share`, `POST /api/documents/:id/comments`, `GET/POST /api/reports`, `GET /api/reports/:id`,
`POST /api/reports/:id/stop`, `GET/POST /api/statements`, `GET /api/statements/:id`, `POST /api/statements/:id/cancel`, `GET /api/activity`,
`GET /api/activity/latest`, `GET /api/activity/running`, `GET /api/activity/totals`, `GET /api/activity/runs`.
