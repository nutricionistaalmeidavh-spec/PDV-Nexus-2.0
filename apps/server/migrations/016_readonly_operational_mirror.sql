-- Opt-in read-only operational mirrors. No foreign keys to canonical sales, stock or catalog.
CREATE TABLE operational_mirror_export (
  id TEXT PRIMARY KEY CHECK(id='local'),
  revision INTEGER NOT NULL CHECK(revision>0),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  packet_hash TEXT NOT NULL CHECK(length(packet_hash)=64),
  packet_json TEXT NOT NULL CHECK(json_valid(packet_json)),
  generated_at TEXT NOT NULL
) STRICT;
CREATE TABLE operational_mirror_peer (
  unit_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision>0),
  packet_hash TEXT NOT NULL CHECK(length(packet_hash)=64),
  packet_json TEXT NOT NULL CHECK(json_valid(packet_json)),
  received_at TEXT NOT NULL,
  gap_detected INTEGER NOT NULL DEFAULT 0 CHECK(gap_detected IN (0,1))
) STRICT;
CREATE INDEX idx_operational_mirror_received ON operational_mirror_peer(received_at);
INSERT INTO schema_migrations(version) VALUES(16);
