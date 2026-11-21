-- P2: pizza selections, weighed-sale captures and advanced counter without a second ledger.
ALTER TABLE sales_order ADD COLUMN suspended_at TEXT;
ALTER TABLE menu_product ADD COLUMN sale_unit TEXT NOT NULL DEFAULT 'unit' CHECK(sale_unit IN ('unit','kg'));
ALTER TABLE order_line ADD COLUMN original_unit_price_cents INTEGER;
CREATE TABLE order_price_change (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES sales_order(id),
 line_id TEXT NOT NULL REFERENCES order_line(id),
 previous_price_cents INTEGER NOT NULL CHECK(previous_price_cents>=0),
 next_price_cents INTEGER NOT NULL CHECK(next_price_cents>=0),
 reason TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_price_change_line ON order_price_change(line_id);
CREATE TABLE pizza_size (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL UNIQUE COLLATE NOCASE,
 base_price_cents INTEGER NOT NULL CHECK(base_price_cents>=0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
) STRICT;
CREATE TABLE pizza_flavor (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL UNIQUE COLLATE NOCASE,
 price_cents INTEGER NOT NULL CHECK(price_cents>=0),
 product_id TEXT REFERENCES menu_product(id),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
) STRICT;
CREATE TABLE pizza_border (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL UNIQUE COLLATE NOCASE,
 price_cents INTEGER NOT NULL CHECK(price_cents>=0),
 product_id TEXT REFERENCES menu_product(id),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
) STRICT;
CREATE TABLE order_line_pizza (
 line_id TEXT PRIMARY KEY REFERENCES order_line(id),
 size_name_snapshot TEXT NOT NULL,
 flavors_json TEXT NOT NULL CHECK(json_valid(flavors_json)),
 border_json TEXT CHECK(border_json IS NULL OR json_valid(border_json)),
 price_rule TEXT NOT NULL CHECK(price_rule IN ('highest','proportional','fixed')),
 pizza_price_cents INTEGER NOT NULL CHECK(pizza_price_cents>=0)
) STRICT;
CREATE TABLE scale_config (
 id TEXT PRIMARY KEY CHECK(id='default'),
 device_path TEXT NOT NULL,
 baud_rate INTEGER NOT NULL,
 brand TEXT NOT NULL CHECK(brand IN ('generic','toledo','filizola'))
) STRICT;
CREATE TABLE scale_reading (
 id TEXT PRIMARY KEY,
 weight_grams INTEGER NOT NULL CHECK(weight_grams>0),
 stable INTEGER NOT NULL CHECK(stable IN (0,1)),
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 consumed_line_id TEXT UNIQUE REFERENCES order_line(id)
) STRICT;
CREATE TABLE order_line_weight (
 line_id TEXT PRIMARY KEY REFERENCES order_line(id),
 reading_id TEXT UNIQUE REFERENCES scale_reading(id),
 weight_grams INTEGER NOT NULL CHECK(weight_grams>0),
 price_per_kg_cents INTEGER NOT NULL CHECK(price_per_kg_cents>=0)
) STRICT;
INSERT INTO schema_migrations(version) VALUES(21);
