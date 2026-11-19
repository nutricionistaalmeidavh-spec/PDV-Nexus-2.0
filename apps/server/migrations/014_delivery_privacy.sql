-- Anonymization retains financial/audit links while removing delivery contact fields.
ALTER TABLE delivery_request ADD COLUMN anonymized_at TEXT;
CREATE INDEX idx_delivery_privacy_age ON delivery_request(anonymized_at,created_at);
INSERT INTO schema_migrations(version) VALUES(14);
