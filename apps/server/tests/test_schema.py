import pathlib
import sqlite3
import unittest

MIGRATION = (pathlib.Path(__file__).parents[1] / 'migrations' / '001_init.sql').read_text()

class InitialSchemaTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript(MIGRATION)
        self.db.execute("INSERT INTO restaurant VALUES ('r1', 'Lanchonete Teste', '2026-11-17T00:00:00Z')")
        self.db.execute("INSERT INTO terminal VALUES ('t1', 'r1', 'Caixa 1')")
        self.db.execute("INSERT INTO menu_category(id, restaurant_id, name) VALUES ('c1','r1','Lanches')")
        self.db.execute("INSERT INTO menu_product(id,category_id,name,price_cents) VALUES ('p1','c1','X-Burger',1590)")

    def tearDown(self):
        self.db.close()

    def test_schema_version(self):
        self.assertEqual(self.db.execute('SELECT version FROM schema_migrations').fetchone()[0], 1)

    def test_rejects_negative_price(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO menu_product(id,category_id,name,price_cents) VALUES ('p2','c1','Inválido',-1)")

    def test_rejects_missing_restaurant_and_invalid_order_status(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO terminal VALUES ('t2','missing','Caixa')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO sales_order(id,restaurant_id,terminal_id,service_mode,status,created_at) VALUES ('o1','r1','t1','counter','UNKNOWN','now')")

    def test_table_service_requires_table_reference(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO sales_order(id,restaurant_id,terminal_id,service_mode,status,created_at) VALUES ('o1','r1','t1','table','OPEN','now')")

    def test_order_snapshot_keeps_historical_price(self):
        self.db.execute("INSERT INTO sales_order(id,restaurant_id,terminal_id,service_mode,status,created_at) VALUES ('o1','r1','t1','counter','OPEN','now')")
        self.db.execute("INSERT INTO order_line VALUES ('l1','o1','p1','X-Burger',1590,2)")
        self.db.execute("UPDATE menu_product SET price_cents=2000 WHERE id='p1'")
        self.assertEqual(self.db.execute("SELECT unit_price_cents FROM order_line WHERE id='l1'").fetchone()[0], 1590)

    def test_idempotency_receipt_rejects_duplicate_command(self):
        self.db.execute("INSERT INTO command_receipt VALUES ('cmd-1','hash-1','{}','now')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO command_receipt VALUES ('cmd-1','hash-2','{}','now')")

    def test_validates_outbox_json(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO outbox_event(id,kind,aggregate_id,payload_json,created_at) VALUES ('e1','PRINT','o1','not-json','now')")

if __name__ == '__main__':
    unittest.main()
