-- P1: settlements, line refunds, KDS stations, receipt routing; single canonical SQLite.
ALTER TABLE payment ADD COLUMN guest TEXT;
CREATE INDEX idx_payment_guest ON payment(order_id,guest);
CREATE TABLE order_item_refund (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES sales_order(id),
 line_id TEXT NOT NULL REFERENCES order_line(id),
 quantity INTEGER NOT NULL CHECK(quantity>0),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 cash_cents INTEGER NOT NULL CHECK(cash_cents>=0 AND cash_cents<=amount_cents),
 reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 return_to_stock INTEGER NOT NULL DEFAULT 0 CHECK(return_to_stock IN (0,1)),
 cash_session_id TEXT REFERENCES cash_session(id),
 actor_id TEXT NOT NULL,
 created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_partial_refund_line ON order_item_refund(line_id);
CREATE INDEX idx_partial_refund_order ON order_item_refund(order_id);
CREATE TABLE kitchen_station (
 id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 print_profile_id TEXT
) STRICT;
INSERT INTO kitchen_station(id,name) VALUES('station-default','Cozinha');
CREATE TABLE kitchen_station_product (
 product_id TEXT PRIMARY KEY REFERENCES menu_product(id),
 station_id TEXT NOT NULL REFERENCES kitchen_station(id)
) STRICT;
ALTER TABLE kitchen_ticket ADD COLUMN station_id TEXT REFERENCES kitchen_station(id);
UPDATE kitchen_ticket SET station_id='station-default' WHERE station_id IS NULL;
CREATE INDEX idx_ticket_station ON kitchen_ticket(station_id,status,created_at);
CREATE TABLE print_profile (
 id TEXT PRIMARY KEY,
 label TEXT NOT NULL UNIQUE COLLATE NOCASE,
 transport TEXT NOT NULL CHECK(transport IN ('tcp','serial','windows')),
 host TEXT NOT NULL DEFAULT '',
 port INTEGER NOT NULL DEFAULT 9100 CHECK(port BETWEEN 1 AND 65535),
 device_path TEXT,
 baud_rate INTEGER NOT NULL DEFAULT 9600,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1))
) STRICT;
INSERT INTO schema_migrations(version) VALUES(20);
