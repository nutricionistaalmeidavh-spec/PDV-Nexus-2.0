-- Client-generated idempotency keys prevent double delivery submissions after network retries.
ALTER TABLE delivery_request ADD COLUMN client_request_id TEXT;
ALTER TABLE delivery_request ADD COLUMN request_fingerprint TEXT;
CREATE UNIQUE INDEX idx_delivery_client_request_key ON delivery_request(client_request_id) WHERE client_request_id IS NOT NULL;
INSERT INTO schema_migrations(version) VALUES(15);
