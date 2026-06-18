-- QIE Remit D1 schema (aligned with src/db.ts)
-- Re-apply: wrangler d1 execute qie-remit --file=./schema.sql --remote

DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS usage_log;

CREATE TABLE users (
  id TEXT PRIMARY KEY,              -- "telegram:<tgUserId>"
  tg_user_id INTEGER NOT NULL UNIQUE,
  username TEXT,
  wallet_address TEXT,
  pass_name TEXT,                   -- on-chain attested identity name
  pass_verified INTEGER DEFAULT 0,
  pass_id TEXT,                     -- attestation tx hash
  remit_slug TEXT UNIQUE,           -- paypal.me-style /pay/<slug>
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_users_tg ON users(tg_user_id);
CREATE INDEX idx_users_wallet ON users(wallet_address);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,              -- INV-XXXX
  on_chain_id INTEGER,              -- InvoiceRegistry on-chain id
  creator_id TEXT NOT NULL,         -- users.id ("telegram:<tgId>")
  creator_address TEXT NOT NULL,
  amount INTEGER NOT NULL,          -- human QIE units
  currency TEXT NOT NULL DEFAULT 'QIE',
  description TEXT,
  client_name TEXT,
  slug TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  create_tx TEXT,
  pay_tx TEXT,
  payer_address TEXT,
  paid_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_invoices_creator ON invoices(creator_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_slug ON invoices(slug);

CREATE TABLE payments (
  invoice_id TEXT,
  on_chain_id INTEGER,
  tx_hash TEXT NOT NULL UNIQUE,
  payer TEXT NOT NULL,
  amount INTEGER NOT NULL,
  paid_at INTEGER NOT NULL,
  PRIMARY KEY (tx_hash)
);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);

CREATE TABLE usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  action TEXT,
  detail TEXT,
  tokens INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_usage_user ON usage_log(user_id);
