-- P1: human-readable, local non-fiscal order sequence. UUID remains canonical id.
ALTER TABLE sales_order ADD COLUMN order_number INTEGER;

CREATE TABLE local_order_sequence (
  restaurant_id TEXT PRIMARY KEY REFERENCES restaurant(id),
  last_number INTEGER NOT NULL CHECK(last_number>=0)
) STRICT;

WITH ranked AS (
  SELECT id,ROW_NUMBER() OVER(PARTITION BY restaurant_id ORDER BY created_at,id) AS number
  FROM sales_order
)
UPDATE sales_order
 SET order_number=(SELECT number FROM ranked WHERE ranked.id=sales_order.id);

INSERT INTO local_order_sequence(restaurant_id,last_number)
 SELECT restaurant_id,MAX(order_number) FROM sales_order GROUP BY restaurant_id;

CREATE UNIQUE INDEX idx_sales_order_display_number
  ON sales_order(restaurant_id,order_number);

CREATE TRIGGER trg_sales_order_number AFTER INSERT ON sales_order
BEGIN
 INSERT INTO local_order_sequence(restaurant_id,last_number) VALUES(NEW.restaurant_id,1)
  ON CONFLICT(restaurant_id) DO UPDATE SET last_number=last_number+1;
 UPDATE sales_order SET order_number=(
   SELECT last_number FROM local_order_sequence WHERE restaurant_id=NEW.restaurant_id
 ) WHERE id=NEW.id;
END;

INSERT INTO schema_migrations(version) VALUES(24);
