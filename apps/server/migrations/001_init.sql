-- Primeiro schema: um banco SQLite por estabelecimento; somente o host escreve.
-- Executar com foreign_keys=ON e uma transação exclusiva no migrador.
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE restaurant (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE terminal (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurant(id),
  label TEXT NOT NULL CHECK (length(trim(label)) > 0)
) STRICT;

CREATE TABLE menu_category (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurant(id),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  sort_order INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE menu_product (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES menu_category(id),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
) STRICT;

CREATE TABLE service_table (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurant(id),
  label TEXT NOT NULL,
  UNIQUE (restaurant_id, label)
) STRICT;

CREATE TABLE sales_order (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurant(id),
  terminal_id TEXT NOT NULL REFERENCES terminal(id),
  service_table_id TEXT REFERENCES service_table(id),
  service_mode TEXT NOT NULL CHECK (service_mode IN ('counter','table','takeaway','delivery')),
  status TEXT NOT NULL CHECK (status IN ('DRAFT','OPEN','CLOSED','CANCELLED')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  closed_at TEXT,
  CHECK ((service_mode = 'table' AND service_table_id IS NOT NULL)
      OR (service_mode <> 'table' AND service_table_id IS NULL))
) STRICT;

CREATE TABLE order_line (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES sales_order(id),
  product_id TEXT REFERENCES menu_product(id),
  product_name_snapshot TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  quantity INTEGER NOT NULL CHECK (quantity >= 1)
) STRICT;

CREATE TABLE payment (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES sales_order(id),
  method TEXT NOT NULL CHECK (method IN ('cash','pix','credit','debit','other')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  state TEXT NOT NULL CHECK (state IN ('PENDING','CONFIRMED','REVERSED')),
  created_at TEXT NOT NULL
) STRICT;

-- Persistir antes de responder ao cliente. request_hash detecta reutilização da chave
-- com corpo diferente; response_json permite responder sem repetir a venda.
CREATE TABLE command_receipt (
  command_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at TEXT NOT NULL
) STRICT;

-- Efeitos externos, como impressão e KDS, não participam do commit de venda.
CREATE TABLE outbox_event (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DONE','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  aggregate_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_product_category ON menu_product(category_id, active);
CREATE INDEX idx_orders_status ON sales_order(status, created_at);
CREATE INDEX idx_orders_table ON sales_order(service_table_id, status);
CREATE INDEX idx_lines_order ON order_line(order_id);
CREATE INDEX idx_payments_order ON payment(order_id, state);
CREATE INDEX idx_outbox_pending ON outbox_event(status, created_at);
CREATE INDEX idx_audit_aggregate ON audit_log(aggregate_id, created_at);
INSERT INTO schema_migrations(version) VALUES (1);
