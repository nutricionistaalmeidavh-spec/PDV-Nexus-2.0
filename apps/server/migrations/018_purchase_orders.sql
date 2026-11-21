-- Purchase order is an auditable document; stock is applied only once on receipt.
CREATE TABLE purchase_order (
 id TEXT PRIMARY KEY,
 supplier_id TEXT NOT NULL REFERENCES supplier(id),
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','RECEIVED','CANCELLED')),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=240),
 actor_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 received_at TEXT
) STRICT;
CREATE INDEX idx_purchase_status ON purchase_order(status,created_at);
CREATE TABLE purchase_order_line (
 id TEXT PRIMARY KEY,
 purchase_id TEXT NOT NULL REFERENCES purchase_order(id),
 ingredient_id TEXT NOT NULL REFERENCES stock_ingredient(id),
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 cost_cents INTEGER NOT NULL CHECK(cost_cents>=0),
 lot_code TEXT,
 expiry_date TEXT,
 CHECK((lot_code IS NULL AND expiry_date IS NULL) OR
       (lot_code IS NOT NULL AND length(trim(lot_code)) BETWEEN 1 AND 64 AND expiry_date GLOB '????-??-??'))
) STRICT;
CREATE INDEX idx_purchase_line_order ON purchase_order_line(purchase_id);
INSERT INTO schema_migrations(version) VALUES(18);
