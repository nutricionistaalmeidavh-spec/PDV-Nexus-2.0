-- P1 restaurante: pagamentos por convidado, estornos parciais, setores e impressão operacional.
ALTER TABLE payment ADD COLUMN guest TEXT;
CREATE TABLE order_line_refund (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES sales_order(id),
 line_id TEXT NOT NULL REFERENCES order_line(id),
 quantity INTEGER NOT NULL CHECK(quantity>0),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
 cash_cents INTEGER NOT NULL CHECK(cash_cents>=0 AND cash_cents<=amount_cents),
 external_cents INTEGER NOT NULL CHECK(external_cents>=0 AND cash_cents+external_cents=amount_cents),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 240),
 external_refund_confirmed INTEGER NOT NULL CHECK(external_refund_confirmed IN (0,1)),
 cash_session_id TEXT REFERENCES cash_session(id),
 actor_id TEXT NOT NULL,
 created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_order_line_refund_order ON order_line_refund(order_id,line_id,created_at);
CREATE TABLE kitchen_station (
 id TEXT PRIMARY KEY,
 restaurant_id TEXT NOT NULL REFERENCES restaurant(id),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 printer_profile_id TEXT REFERENCES printer_profile(id),
 UNIQUE(restaurant_id,name)
) STRICT;
ALTER TABLE menu_product ADD COLUMN kitchen_station_id TEXT REFERENCES kitchen_station(id);
ALTER TABLE kitchen_ticket ADD COLUMN kitchen_station_id TEXT REFERENCES kitchen_station(id);
INSERT INTO schema_migrations(version) VALUES(20);
