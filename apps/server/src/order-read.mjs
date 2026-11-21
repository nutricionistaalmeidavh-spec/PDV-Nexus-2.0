/** Canonical order projection from SQLite; no derived state or duplicate ledger. */
import {orderTotalCents} from '../../../packages/core/src/order.ts';
import {missing} from './request-validation.mjs';
const stamp=()=>new Date().toISOString();
export function databaseOrder(db, id) {
  const row=db.prepare('SELECT * FROM sales_order WHERE id=?').get(id);
  if (!row) missing('Pedido');
  const lines=db.prepare('SELECT id,product_id AS productId,product_name_snapshot AS productName,unit_price_cents AS unitPriceCents,quantity,note_snapshot AS note FROM order_line WHERE order_id=? ORDER BY rowid').all(id);
  const payments=db.prepare('SELECT id,method,amount_cents AS amountCents,state,created_at AS createdAt FROM payment WHERE order_id=? ORDER BY rowid').all(id);
  for(const line of lines){
    line.modifiers=db.prepare('SELECT name_snapshot AS name,price_cents_snapshot AS priceCents FROM order_line_modifier WHERE line_id=?').all(line.id);
    line.comboComponents=db.prepare('SELECT product_id AS productId,product_name_snapshot AS productName,quantity FROM order_line_combo_item WHERE line_id=? ORDER BY rowid').all(line.id);
  }
  const refunded=Boolean(db.prepare('SELECT 1 FROM order_refund WHERE order_id=?').get(id));
  const order={id:row.id,tableId:row.service_table_id,serviceMode:row.service_mode,createdAt:row.created_at,status:row.status,revision:row.revision,lines,payments,refunded,totalCents:0};
  order.totalCents=orderTotalCents(order);
  return order;
}

export function writeOrder(db,order) {
  db.prepare('UPDATE sales_order SET status=?,revision=?,closed_at=? WHERE id=?')
    .run(order.status,order.revision,order.status==='CLOSED'?stamp():null,order.id);
}
