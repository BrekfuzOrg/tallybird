CREATE TABLE IF NOT EXISTS teams (
  id serial PRIMARY KEY,
  name varchar(80) NOT NULL,
  description varchar(60) NOT NULL DEFAULT '',
  suspended boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  user_id integer NOT NULL REFERENCES users(id),
  team_id integer NOT NULL REFERENCES teams(id),
  role text NOT NULL CHECK (role IN ('owner', 'member')),
  PRIMARY KEY (user_id, team_id)
);
CREATE TABLE IF NOT EXISTS invites (
  token text PRIMARY KEY,
  team_id integer NOT NULL REFERENCES teams(id),
  email text NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  id serial PRIMARY KEY,
  team_id integer NOT NULL REFERENCES teams(id),
  name text NOT NULL,
  email text NOT NULL,
  seats integer NOT NULL CHECK (seats > 0),
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_runs (
  id serial PRIMARY KEY,
  team_id integer NOT NULL REFERENCES teams(id),
  created_by integer NOT NULL REFERENCES users(id),
  period text NOT NULL,
  state text NOT NULL CHECK (state IN ('running', 'done', 'failed')),
  total integer NOT NULL DEFAULT 0,
  done integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL,
  finished_at timestamptz
);
CREATE TABLE IF NOT EXISTS invoices (
  id serial PRIMARY KEY,
  team_id integer NOT NULL REFERENCES teams(id),
  customer_id integer NOT NULL REFERENCES customers(id),
  run_id integer REFERENCES billing_runs(id),
  number text NOT NULL,
  period text NOT NULL,
  seats integer NOT NULL,
  unit_cents integer NOT NULL,
  discount_cents integer NOT NULL,
  tax_cents integer NOT NULL,
  total_cents integer NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'processing', 'paid')),
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS charges (
  id serial PRIMARY KEY,
  invoice_id integer NOT NULL REFERENCES invoices(id),
  gateway_ref text NOT NULL,
  amount_cents integer NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id serial PRIMARY KEY,
  team_id integer NOT NULL REFERENCES teams(id),
  author_id integer NOT NULL REFERENCES users(id),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  shared_with_team boolean NOT NULL DEFAULT false,
  comments jsonb NOT NULL DEFAULT '[]',
  trashed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS document_shares (
  document_id integer NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id),
  PRIMARY KEY (document_id, user_id)
);
CREATE TABLE IF NOT EXISTS invoice_attachments (
  id serial PRIMARY KEY,
  invoice_id integer NOT NULL REFERENCES invoices(id),
  uploaded_by integer NOT NULL REFERENCES users(id),
  filename text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('csv', 'pdf')),
  bytes integer NOT NULL,
  content bytea NOT NULL,
  line_items jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS late_fees (
  id serial PRIMARY KEY,
  invoice_id integer NOT NULL REFERENCES invoices(id),
  team_id integer NOT NULL REFERENCES teams(id),
  fee_date date NOT NULL,
  amount_cents integer NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS invoice_reminders (
  invoice_id integer NOT NULL REFERENCES invoices(id),
  day date NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (invoice_id, day)
);
CREATE TABLE IF NOT EXISTS invoice_emails (
  id serial PRIMARY KEY,
  invoice_id integer NOT NULL REFERENCES invoices(id),
  kind text NOT NULL CHECK (kind IN ('invoice', 'late-fee', 'reminder')),
  to_email text NOT NULL,
  subject text NOT NULL,
  message_id text UNIQUE,
  created_at timestamptz NOT NULL
);
