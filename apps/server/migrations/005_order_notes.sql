-- Observações da cozinha precisam persistir com a linha do pedido.
ALTER TABLE order_line ADD COLUMN note_snapshot TEXT NOT NULL DEFAULT '' CHECK(length(note_snapshot) <= 240);
INSERT INTO schema_migrations(version) VALUES(5);
