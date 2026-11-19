-- A stable per-database site identity. No automatic multi-store replication is enabled.
CREATE TABLE installation_identity (
 id TEXT PRIMARY KEY CHECK(id='local'),
 unit_id TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL
) STRICT;
INSERT INTO installation_identity(id,unit_id,created_at)
 VALUES('local','unit-'||lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO schema_migrations(version) VALUES(12);
