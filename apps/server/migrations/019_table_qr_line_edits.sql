-- P0: auditável e aditivo. Identidades, snapshots e eventos históricos permanecem imutáveis.
ALTER TABLE order_line ADD COLUMN cancelled_at TEXT;
ALTER TABLE kitchen_ticket ADD COLUMN change_note TEXT;
CREATE TABLE order_line_change (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES sales_order(id),
  line_id TEXT NOT NULL REFERENCES order_line(id),
  action TEXT NOT NULL CHECK(action IN ('EDITED','CANCELLED')),
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT CHECK(after_json IS NULL OR json_valid(after_json)),
  reason TEXT,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_line_change_order ON order_line_change(order_id,created_at);

CREATE TABLE table_qr_session (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES service_table(id),
  order_id TEXT NOT NULL REFERENCES sales_order(id),
  token_hash TEXT NOT NULL UNIQUE,
  auto_accept INTEGER NOT NULL DEFAULT 0 CHECK(auto_accept IN (0,1)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;
CREATE INDEX idx_qr_table_order ON table_qr_session(table_id,order_id);
CREATE TABLE table_order_request (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES table_qr_session(id),
  order_id TEXT NOT NULL REFERENCES sales_order(id),
  client_request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  guest_name TEXT,
  total_cents INTEGER NOT NULL CHECK(total_cents>=0),
  status TEXT NOT NULL CHECK(status IN ('PENDING','ACCEPTED','REJECTED')),
  created_at TEXT NOT NULL,
  decided_at TEXT,
  reason TEXT,
  UNIQUE(session_id,client_request_id)
) STRICT;
CREATE INDEX idx_table_request_order ON table_order_request(order_id,status,created_at);
CREATE TABLE table_order_request_line (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES table_order_request(id),
  product_id TEXT NOT NULL REFERENCES menu_product(id),
  product_name_snapshot TEXT NOT NULL,
  base_price_cents INTEGER NOT NULL CHECK(base_price_cents>=0),
  unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20),
  note_snapshot TEXT NOT NULL,
  modifiers_json TEXT NOT NULL CHECK(json_valid(modifiers_json))
) STRICT;
CREATE INDEX idx_table_request_lines ON table_order_request_line(request_id);
INSERT INTO schema_migrations(version) VALUES (19);
