-- Combos share the canonical menu product, with frozen component snapshots per sold line.
ALTER TABLE menu_product ADD COLUMN is_combo INTEGER NOT NULL DEFAULT 0 CHECK(is_combo IN (0,1));
CREATE TABLE menu_combo_item (
 id TEXT PRIMARY KEY,
 combo_id TEXT NOT NULL REFERENCES menu_product(id),
 product_id TEXT NOT NULL REFERENCES menu_product(id),
 quantity INTEGER NOT NULL CHECK(quantity>=1),
 UNIQUE(combo_id,product_id)
) STRICT;
CREATE TABLE order_line_combo_item (
 id TEXT PRIMARY KEY,
 line_id TEXT NOT NULL REFERENCES order_line(id),
 product_id TEXT REFERENCES menu_product(id),
 product_name_snapshot TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity>=1),
 UNIQUE(line_id,product_id)
) STRICT;
CREATE INDEX idx_combo_items ON menu_combo_item(combo_id);
CREATE INDEX idx_combo_snapshots ON order_line_combo_item(line_id);
-- Each sold quantity can be attributed to one or more guests, with no duplicating the order.
CREATE TABLE order_guest_split (
 line_id TEXT NOT NULL REFERENCES order_line(id),
 guest TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(guest)) BETWEEN 1 AND 60),
 quantity INTEGER NOT NULL CHECK(quantity>=1),
 PRIMARY KEY(line_id,guest)
) STRICT;
INSERT INTO schema_migrations(version) VALUES(8);
