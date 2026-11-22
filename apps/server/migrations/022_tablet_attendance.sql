-- Atendimento canônico: order_id é o identificador imutável da visita; a mesa pode ser reutilizada.
-- Sempre dados locais; sem nuvem, serviço pago nem banco secundário.
CREATE TABLE table_attendance_state (
 order_id TEXT PRIMARY KEY REFERENCES sales_order(id),
 close_requested_at TEXT
) STRICT;
CREATE INDEX idx_attendance_requested ON table_attendance_state(close_requested_at);

CREATE TABLE paired_tablet (
 id TEXT PRIMARY KEY,
 table_id TEXT NOT NULL UNIQUE REFERENCES service_table(id),
 token_hash TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL,
 revoked_at TEXT
) STRICT;

CREATE TABLE tablet_settings (
 id TEXT PRIMARY KEY CHECK(id='local'),
 auto_accept INTEGER NOT NULL DEFAULT 0 CHECK(auto_accept IN (0,1))
) STRICT;
INSERT INTO tablet_settings(id,auto_accept) VALUES('local',0);

CREATE TABLE order_waiter (
 order_id TEXT PRIMARY KEY REFERENCES sales_order(id),
 waiter_device_id TEXT NOT NULL REFERENCES paired_device(id),
 assigned_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_order_waiter_device ON order_waiter(waiter_device_id);

-- A responsabilidade histórica do item não muda ao transferir o atendimento.
ALTER TABLE order_line ADD COLUMN waiter_device_id TEXT REFERENCES paired_device(id);
CREATE INDEX idx_order_line_waiter ON order_line(waiter_device_id);

CREATE TABLE kitchen_delivery_claim (
 ticket_id TEXT PRIMARY KEY REFERENCES kitchen_ticket(id),
 waiter_device_id TEXT NOT NULL REFERENCES paired_device(id),
 claimed_at TEXT NOT NULL,
 delivered_at TEXT
) STRICT;
CREATE INDEX idx_delivery_claim_pending ON kitchen_delivery_claim(waiter_device_id,delivered_at);
INSERT INTO schema_migrations(version) VALUES(22);
