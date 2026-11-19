-- P2 manual, opt-in multiunit consolidation: never replicates operational writes.
CREATE TABLE multiunit_export_state (
  id TEXT PRIMARY KEY CHECK(id='local'),
  revision INTEGER NOT NULL CHECK(revision>0),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  packet_hash TEXT NOT NULL CHECK(length(packet_hash)=64),
  packet_json TEXT NOT NULL CHECK(json_valid(packet_json)),
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE multiunit_peer_snapshot (
  unit_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision>0),
  packet_hash TEXT NOT NULL CHECK(length(packet_hash)=64),
  packet_json TEXT NOT NULL CHECK(json_valid(packet_json)),
  imported_at TEXT NOT NULL
) STRICT;
CREATE TABLE multiunit_conflict (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  attempted_hash TEXT NOT NULL,
  expected_hash TEXT,
  reason TEXT NOT NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_multiunit_conflicts_open ON multiunit_conflict(resolved_at,created_at);
INSERT INTO schema_migrations(version) VALUES(13);
