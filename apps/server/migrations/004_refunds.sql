-- Devolução integral: preserva pagamentos originais e gera movimento de caixa de saída.
CREATE TABLE order_refund (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES sales_order(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
  cash_cents INTEGER NOT NULL CHECK(cash_cents >= 0 AND cash_cents <= amount_cents),
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
  external_refund_confirmed INTEGER NOT NULL CHECK(external_refund_confirmed IN (0,1)),
  cash_session_id TEXT REFERENCES cash_session(id),
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_refund_session ON order_refund(cash_session_id);
INSERT INTO schema_migrations(version) VALUES (4);
