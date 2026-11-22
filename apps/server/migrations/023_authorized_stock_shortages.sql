-- Supervisor-authorized sale shortage. Never invent receipt or negative physical lot balances.
CREATE TABLE stock_shortage (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES sales_order(id),
  ingredient_id TEXT NOT NULL REFERENCES stock_ingredient(id),
  shortage_milli INTEGER NOT NULL CHECK(shortage_milli > 0),
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 240),
  created_at TEXT NOT NULL,
  UNIQUE(order_id,ingredient_id)
) STRICT;
CREATE INDEX idx_stock_shortage_ingredient ON stock_shortage(ingredient_id,created_at);
INSERT INTO schema_migrations(version) VALUES(23);
