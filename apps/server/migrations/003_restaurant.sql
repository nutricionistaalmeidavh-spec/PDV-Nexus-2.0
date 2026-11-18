-- Mesa/comanda, modificadores e tickets de cozinha com trilha auditável.
CREATE UNIQUE INDEX idx_one_active_table_order ON sales_order(service_table_id)
  WHERE service_table_id IS NOT NULL AND status IN ('DRAFT','OPEN');
CREATE TABLE product_modifier (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES menu_product(id),
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
) STRICT;
CREATE INDEX idx_modifier_product ON product_modifier(product_id,active);
CREATE TABLE order_line_modifier (
  id TEXT PRIMARY KEY,
  line_id TEXT NOT NULL REFERENCES order_line(id),
  modifier_id TEXT REFERENCES product_modifier(id),
  name_snapshot TEXT NOT NULL,
  price_cents_snapshot INTEGER NOT NULL CHECK(price_cents_snapshot >= 0)
) STRICT;
CREATE INDEX idx_line_modifier ON order_line_modifier(line_id);
CREATE TABLE kitchen_ticket (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES sales_order(id),
  line_id TEXT NOT NULL UNIQUE REFERENCES order_line(id),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PREPARING','READY','SERVED','CANCELLED')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_kitchen_status ON kitchen_ticket(status,created_at);
CREATE INDEX idx_kitchen_order ON kitchen_ticket(order_id,status);
INSERT INTO schema_migrations(version) VALUES (3);
