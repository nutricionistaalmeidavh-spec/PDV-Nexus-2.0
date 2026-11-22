import pathlib
import sqlite3
import unittest

MIGRATIONS=pathlib.Path(__file__).parents[1]/'migrations'
FILES=sorted(MIGRATIONS.glob('[0-9][0-9][0-9]_*.sql'))

class P2MigrationTests(unittest.TestCase):
    def connect(self):
        db=sqlite3.connect(':memory:')
        db.execute('PRAGMA foreign_keys=ON')
        return db
    def apply(self,db,files):
        for f in files:
            db.executescript(f.read_text(encoding='utf-8'))

    def test_upgrade_from_p1_keeps_existing_order_and_reaches_v16(self):
        db=self.connect()
        try:
            self.apply(db,FILES[:8])
            db.execute("INSERT INTO restaurant VALUES('r','Restaurante','2026-11-18')")
            db.execute("INSERT INTO terminal VALUES('t','r','Caixa')")
            db.execute("INSERT INTO menu_category(id,restaurant_id,name) VALUES('c','r','Lanches')")
            db.execute("INSERT INTO menu_product(id,category_id,name,price_cents) VALUES('p','c','X-Burger',1200)")
            db.execute("INSERT INTO sales_order(id,restaurant_id,terminal_id,service_mode,status,created_at) VALUES('o','r','t','counter','OPEN','now')")
            db.execute("INSERT INTO order_line(id,order_id,product_id,product_name_snapshot,unit_price_cents,quantity) VALUES('l','o','p','X-Burger',1200,2)")
            self.apply(db,FILES[8:])
            versions=[r[0] for r in db.execute('SELECT version FROM schema_migrations ORDER BY version')]
            self.assertEqual(versions,list(range(1,max(int(f.name[:3]) for f in FILES)+1)))
            self.assertEqual(db.execute("SELECT product_name_snapshot,unit_price_cents FROM order_line WHERE id='l'").fetchone(),('X-Burger',1200))
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])
        finally: db.close()

    def test_ledger_constraints_and_public_menu_default_off(self):
        db=self.connect()
        try:
            self.apply(db,FILES)
            db.execute("INSERT INTO restaurant VALUES('r','Restaurante','now')")
            db.execute("INSERT INTO stock_ingredient(id,restaurant_id,name,unit,created_at) VALUES('ing','r','Farinha','g','now')")
            self.assertEqual(db.execute("SELECT on_hand_milli,book_value_cents FROM stock_ingredient WHERE id='ing'").fetchone(),(0,0))
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute("UPDATE stock_ingredient SET on_hand_milli=-1 WHERE id='ing'")
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute("INSERT INTO stock_recipe_item(product_id,ingredient_id,quantity_milli) VALUES('missing','ing',100)")
            self.assertEqual(db.execute("SELECT enabled FROM delivery_public_setting WHERE id='local'").fetchone()[0],0)
        finally: db.close()

if __name__=='__main__': unittest.main()
