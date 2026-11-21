-- Supplier and batch metadata only: stock_ingredient remains canonical for quantities and valuation.
CREATE TABLE supplier (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 document TEXT NOT NULL DEFAULT '' CHECK(length(document)<=30),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX idx_supplier_name ON supplier(name COLLATE NOCASE);
CREATE TABLE ingredient_batch (
 id TEXT PRIMARY KEY,
 ingredient_id TEXT NOT NULL REFERENCES stock_ingredient(id),
 supplier_id TEXT REFERENCES supplier(id),
 lot_code TEXT NOT NULL CHECK(length(trim(lot_code)) BETWEEN 1 AND 64),
 expiry_date TEXT NOT NULL CHECK(expiry_date GLOB '????-??-??'),
 received_milli INTEGER NOT NULL CHECK(received_milli>0),
 remaining_milli INTEGER NOT NULL CHECK(remaining_milli>=0 AND remaining_milli<=received_milli),
 created_at TEXT NOT NULL,
 UNIQUE(ingredient_id,lot_code,expiry_date)
) STRICT;
CREATE INDEX idx_batch_fefo ON ingredient_batch(ingredient_id,expiry_date,created_at);
CREATE TABLE batch_consumption (
 id TEXT PRIMARY KEY,
 batch_id TEXT NOT NULL REFERENCES ingredient_batch(id),
 order_id TEXT REFERENCES sales_order(id),
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 actor_id TEXT NOT NULL,
 created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_batch_consumption_order ON batch_consumption(order_id);
ALTER TABLE printer_profile ADD COLUMN transport TEXT NOT NULL DEFAULT 'tcp' CHECK(transport IN ('tcp','serial','windows'));
ALTER TABLE printer_profile ADD COLUMN device_path TEXT;
ALTER TABLE printer_profile ADD COLUMN baud_rate INTEGER NOT NULL DEFAULT 9600;
ALTER TABLE menu_product ADD COLUMN barcode TEXT;
CREATE UNIQUE INDEX idx_product_barcode ON menu_product(barcode) WHERE barcode IS NOT NULL;
INSERT INTO schema_migrations(version) VALUES(17);
