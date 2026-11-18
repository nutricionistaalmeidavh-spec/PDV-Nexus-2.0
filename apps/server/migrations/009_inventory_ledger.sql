-- P2: single-writer SQLite inventory. Quantities are thousandths of g/ml/unit.
CREATE TABLE stock_ingredient (
 id TEXT PRIMARY KEY,
 restaurant_id TEXT NOT NULL REFERENCES restaurant(id),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
 unit TEXT NOT NULL CHECK(unit IN ('g','ml','unit')),
 on_hand_milli INTEGER NOT NULL DEFAULT 0 CHECK(on_hand_milli>=0),
 book_value_cents INTEGER NOT NULL DEFAULT 0 CHECK(book_value_cents>=0),
 low_stock_milli INTEGER NOT NULL DEFAULT 0 CHECK(low_stock_milli>=0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX idx_ingredient_name ON stock_ingredient(restaurant_id,name COLLATE NOCASE);
CREATE TABLE stock_recipe_item (
 product_id TEXT NOT NULL REFERENCES menu_product(id),
 ingredient_id TEXT NOT NULL REFERENCES stock_ingredient(id),
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 PRIMARY KEY(product_id,ingredient_id)
) STRICT;
CREATE INDEX idx_recipe_ingredient ON stock_recipe_item(ingredient_id);
CREATE TABLE order_line_recipe_snapshot (
 line_id TEXT NOT NULL REFERENCES order_line(id),
 ingredient_id TEXT NOT NULL REFERENCES stock_ingredient(id),
 ingredient_name_snapshot TEXT NOT NULL,
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 PRIMARY KEY(line_id,ingredient_id)
) STRICT;
CREATE TABLE stock_movement (
 id TEXT PRIMARY KEY,
 ingredient_id TEXT NOT NULL REFERENCES stock_ingredient(id),
 kind TEXT NOT NULL CHECK(kind IN ('RECEIVE','ADJUST_IN','ADJUST_OUT','SALE')),
 quantity_delta_milli INTEGER NOT NULL CHECK(quantity_delta_milli<>0),
 value_delta_cents INTEGER NOT NULL,
 balance_after_milli INTEGER NOT NULL CHECK(balance_after_milli>=0),
 value_after_cents INTEGER NOT NULL CHECK(value_after_cents>=0),
 source_order_id TEXT REFERENCES sales_order(id),
 reason TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_stock_ingredient_created ON stock_movement(ingredient_id,created_at);
CREATE INDEX idx_stock_order ON stock_movement(source_order_id);
CREATE UNIQUE INDEX idx_sale_stock_once ON stock_movement(source_order_id,ingredient_id)
 WHERE source_order_id IS NOT NULL AND kind='SALE';
INSERT INTO schema_migrations(version) VALUES(9);
