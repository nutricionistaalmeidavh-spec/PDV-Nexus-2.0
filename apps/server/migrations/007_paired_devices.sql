-- Per-device LAN credentials: raw bearer tokens are never stored.
CREATE TABLE paired_device (
 id TEXT PRIMARY KEY,
 label TEXT NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 80),
 role TEXT NOT NULL CHECK(role IN ('waiter','kitchen')),
 token_hash TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 revoked_at TEXT
) STRICT;
CREATE INDEX idx_paired_device_active ON paired_device(role,revoked_at,expires_at);
INSERT INTO schema_migrations(version) VALUES(7);
