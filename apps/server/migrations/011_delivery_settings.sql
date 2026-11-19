-- Public catalog is opt-in even when LAN is reachable; never expose without operator action.
CREATE TABLE delivery_public_setting (
 id TEXT PRIMARY KEY CHECK(id='local'),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1))
) STRICT;
INSERT INTO delivery_public_setting(id,enabled) VALUES('local',0);
INSERT INTO schema_migrations(version) VALUES(11);
