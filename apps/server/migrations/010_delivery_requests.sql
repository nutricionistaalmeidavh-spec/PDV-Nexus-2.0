-- Requests from opt-in local HTTPS menu. Never equate a request with a paid sale.
CREATE TABLE delivery_request (
 id TEXT PRIMARY KEY,
 restaurant_id TEXT NOT NULL REFERENCES restaurant(id),
 customer_name TEXT NOT NULL CHECK(length(trim(customer_name)) BETWEEN 2 AND 100),
 phone TEXT NOT NULL CHECK(length(phone) BETWEEN 8 AND 20),
 address TEXT NOT NULL CHECK(length(trim(address)) BETWEEN 10 AND 240),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=240),
 total_cents INTEGER NOT NULL CHECK(total_cents>=0),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','REJECTED')),
 accepted_order_id TEXT UNIQUE REFERENCES sales_order(id),
 decision_reason TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,
 decided_at TEXT
) STRICT;
CREATE INDEX idx_delivery_status ON delivery_request(status,created_at);
CREATE TABLE delivery_request_line (
 id TEXT PRIMARY KEY,
 request_id TEXT NOT NULL REFERENCES delivery_request(id),
 product_id TEXT NOT NULL REFERENCES menu_product(id),
 product_name_snapshot TEXT NOT NULL,
 unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0),
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20)
) STRICT;
CREATE INDEX idx_delivery_request_lines ON delivery_request_line(request_id);
CREATE TABLE delivery_order (
 order_id TEXT PRIMARY KEY REFERENCES sales_order(id),
 request_id TEXT NOT NULL UNIQUE REFERENCES delivery_request(id),
 status TEXT NOT NULL DEFAULT 'ACCEPTED' CHECK(status IN ('ACCEPTED','PREPARING','OUT_FOR_DELIVERY','DELIVERED','CANCELLED')),
 updated_at TEXT NOT NULL
) STRICT;
INSERT INTO schema_migrations(version) VALUES(10);
