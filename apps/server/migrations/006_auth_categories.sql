-- Login local (offline), roles e categorias arquivaveis sem apagar historico.
CREATE TABLE operator_account (
 id TEXT PRIMARY KEY,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(trim(username)) BETWEEN 3 AND 40),
 role TEXT NOT NULL CHECK(role IN ('admin','cashier')),
 password_salt TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 created_at TEXT NOT NULL
) STRICT;
ALTER TABLE menu_category ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1));
CREATE INDEX idx_category_active ON menu_category(restaurant_id,active,sort_order);
INSERT INTO schema_migrations(version) VALUES(6);
