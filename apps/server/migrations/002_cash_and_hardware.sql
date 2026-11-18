-- Incremental migration: cash ledger, printer settings, fiscal gate.
CREATE TABLE cash_session (
  id TEXT PRIMARY KEY,
  terminal_id TEXT NOT NULL REFERENCES terminal(id),
  opened_at TEXT NOT NULL,
  opening_amount_cents INTEGER NOT NULL CHECK(opening_amount_cents >= 0),
  status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSED')),
  counted_amount_cents INTEGER CHECK(counted_amount_cents >= 0),
  expected_amount_cents INTEGER CHECK(expected_amount_cents >= 0),
  closed_at TEXT
) STRICT;
CREATE UNIQUE INDEX idx_one_open_session ON cash_session(terminal_id) WHERE status = 'OPEN';

CREATE TABLE cash_movement (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES cash_session(id),
  kind TEXT NOT NULL CHECK(kind IN ('SUPPLY','WITHDRAWAL')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_cash_movement_session ON cash_movement(session_id);
ALTER TABLE payment ADD COLUMN cash_session_id TEXT REFERENCES cash_session(id);
CREATE TABLE printer_profile (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1))
) STRICT;
CREATE TABLE fiscal_submission (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES sales_order(id),
  uf TEXT,
  kind TEXT NOT NULL DEFAULT 'NFCE' CHECK(kind IN ('NFCE')),
  state TEXT NOT NULL CHECK(state IN ('BLOCKED','PENDING','AUTHORIZED','REJECTED')),
  created_at TEXT NOT NULL,
  UNIQUE(order_id,kind)
) STRICT;
INSERT INTO schema_migrations(version) VALUES(2);
