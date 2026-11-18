import pathlib
import sqlite3
import unittest

MIGRATIONS=pathlib.Path(__file__).parents[1]/'migrations'

class RestaurantSchemaMigrationTests(unittest.TestCase):
    def test_upgrade_v1_to_v5_without_dropping_original_order(self):
        con=sqlite3.connect(':memory:')
        try:
            con.execute('PRAGMA foreign_keys=ON')
            for version in range(1,6):
                name={1:'init',2:'cash_and_hardware',3:'restaurant',4:'refunds',5:'order_notes'}[version]
                con.executescript((MIGRATIONS/f'{version:03d}_{name}.sql').read_text())
            versions=[x[0] for x in con.execute('SELECT version FROM schema_migrations ORDER BY version')]
            self.assertEqual(versions,[1,2,3,4,5])
            con.execute("INSERT INTO restaurant VALUES('r','Teste','now')")
            con.execute("INSERT INTO terminal VALUES('t','r','Principal')")
            con.execute("INSERT INTO menu_category(id,restaurant_id,name) VALUES('c','r','Bebidas')")
            con.execute("INSERT INTO menu_product(id,category_id,name,price_cents) VALUES('p','c','Suco',500)")
            con.execute("INSERT INTO sales_order(id,restaurant_id,terminal_id,service_mode,status,created_at) VALUES('o','r','t','counter','OPEN','now')")
            con.execute("INSERT INTO order_line(id,order_id,product_id,product_name_snapshot,unit_price_cents,quantity,note_snapshot) VALUES('l','o','p','Suco',500,1,'Sem gelo')")
            self.assertEqual(con.execute("SELECT note_snapshot FROM order_line WHERE id='l'").fetchone()[0],'Sem gelo')
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("INSERT INTO kitchen_ticket(id,order_id,line_id,status,created_at,updated_at) VALUES('k','o','l','INVALID','now','now')")
        finally:con.close()

if __name__=='__main__':unittest.main()
