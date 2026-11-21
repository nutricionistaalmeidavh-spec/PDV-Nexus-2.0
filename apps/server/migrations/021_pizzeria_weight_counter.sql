-- P2 restaurantes especializados e balcão, preservando o pedido único.
CREATE TABLE pizza_product (
 product_id TEXT PRIMARY KEY REFERENCES menu_product(id)
) STRICT;
CREATE TABLE pizza_size (
 id TEXT PRIMARY KEY,
 product_id TEXT NOT NULL REFERENCES pizza_product(product_id),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
 base_price_cents INTEGER NOT NULL CHECK(base_price_cents>=0),
 pricing_rule TEXT NOT NULL CHECK(pricing_rule IN ('MAX','AVERAGE','FIXED')),
 max_flavors INTEGER NOT NULL CHECK(max_flavors BETWEEN 1 AND 4),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 UNIQUE(product_id,name)
) STRICT;
CREATE TABLE pizza_flavor (
 id TEXT PRIMARY KEY,
 product_id TEXT NOT NULL REFERENCES pizza_product(product_id),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
 additional_price_cents INTEGER NOT NULL DEFAULT 0 CHECK(additional_price_cents>=0),
 recipe_product_id TEXT REFERENCES menu_product(id),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 UNIQUE(product_id,name)
) STRICT;
CREATE TABLE pizza_border (
 id TEXT PRIMARY KEY,
 product_id TEXT NOT NULL REFERENCES pizza_product(product_id),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
 price_cents INTEGER NOT NULL CHECK(price_cents>=0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 UNIQUE(product_id,name)
) STRICT;
CREATE TABLE order_line_pizza (
 line_id TEXT PRIMARY KEY REFERENCES order_line(id),
 size_id TEXT NOT NULL REFERENCES pizza_size(id),
 size_name_snapshot TEXT NOT NULL,
 flavors_json TEXT NOT NULL CHECK(json_valid(flavors_json)),
 border_json TEXT CHECK(border_json IS NULL OR json_valid(border_json)),
 pricing_rule_snapshot TEXT NOT NULL,
 unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0)
) STRICT;
ALTER TABLE menu_product ADD COLUMN sale_unit TEXT NOT NULL DEFAULT 'unit' CHECK(sale_unit IN ('unit','kg'));
CREATE TABLE order_line_weight (
 line_id TEXT PRIMARY KEY REFERENCES order_line(id),
 weight_grams INTEGER NOT NULL CHECK(weight_grams>0),
 price_per_kg_cents INTEGER NOT NULL CHECK(price_per_kg_cents>=0),
 source TEXT NOT NULL CHECK(source IN ('serial-stable','manual-confirmed')),
 capture_brand TEXT,
 captured_at TEXT NOT NULL
) STRICT;
ALTER TABLE sales_order ADD COLUMN suspended_at TEXT;
CREATE TABLE order_line_price_change (
 id TEXT PRIMARY KEY,
 line_id TEXT NOT NULL REFERENCES order_line(id),
 order_id TEXT NOT NULL REFERENCES sales_order(id),
 previous_unit_price_cents INTEGER NOT NULL CHECK(previous_unit_price_cents>=0),
 new_unit_price_cents INTEGER NOT NULL CHECK(new_unit_price_cents>=0),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 240),
 actor_id TEXT NOT NULL,
 created_at TEXT NOT NULL
) STRICT;
INSERT INTO schema_migrations(version) VALUES(21);
