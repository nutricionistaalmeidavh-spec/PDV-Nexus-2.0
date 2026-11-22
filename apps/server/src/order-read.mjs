/** Canonical order projection from SQLite; no derived state or duplicate ledger. */
import {orderTotalCents} from '../../../packages/core/src/order.ts';
import {missing} from './request-validation.mjs';
const stamp=()=>new Date().toISOString();
export function databaseOrder(db, id) {
  const row=db.prepare('SELECT * FROM sales_order WHERE id=?').get(id);
  if (!row) missing('Pedido');
  const lines=db.prepare('SELECT id,product_id AS productId,product_name_snapshot AS productName,unit_price_cents AS unitPriceCents,quantity,note_snapshot AS note,waiter_device_id AS waiterDeviceId FROM order_line WHERE order_id=? AND cancelled_at IS NULL ORDER BY rowid').all(id);
  const payments=db.prepare('SELECT id,method,amount_cents AS amountCents,state,guest,created_at AS createdAt FROM payment WHERE order_id=? ORDER BY rowid').all(id);
  for(const line of lines){
    line.waiterName=line.waiterDeviceId?db.prepare('SELECT label FROM paired_device WHERE id=?').get(line.waiterDeviceId)?.label??null:null;
    line.modifiers=db.prepare('SELECT modifier_id AS id,name_snapshot AS name,price_cents_snapshot AS priceCents FROM order_line_modifier WHERE line_id=?').all(line.id);
    line.comboComponents=db.prepare('SELECT product_id AS productId,product_name_snapshot AS productName,quantity FROM order_line_combo_item WHERE line_id=? ORDER BY rowid').all(line.id);
    const pizza=db.prepare('SELECT size_name_snapshot AS sizeName,flavors_json AS flavorsJson,border_json AS borderJson,pricing_rule_snapshot AS pricingRule FROM order_line_pizza WHERE line_id=?').get(line.id);
    if(pizza)line.pizza={sizeName:pizza.sizeName,flavors:JSON.parse(pizza.flavorsJson),border:pizza.borderJson?JSON.parse(pizza.borderJson):null,pricingRule:pizza.pricingRule};
    line.weight=db.prepare('SELECT weight_grams AS weightGrams,price_per_kg_cents AS pricePerKgCents,source FROM order_line_weight WHERE line_id=?').get(line.id)??null;
  }
  const refunded=Boolean(db.prepare('SELECT 1 FROM order_refund WHERE order_id=?').get(id));
  const order={id:row.id,orderNumber:row.order_number,tableId:row.service_table_id,serviceMode:row.service_mode,createdAt:row.created_at,status:row.status,revision:row.revision,suspended:!!row.suspended_at,lines,payments,refunded,totalCents:0};
  order.totalCents=orderTotalCents(order);
  order.waiter=db.prepare(`SELECT ow.waiter_device_id AS deviceId,pd.label FROM order_waiter ow JOIN paired_device pd ON pd.id=ow.waiter_device_id WHERE ow.order_id=?`).get(id)??null;
  order.closeRequested=Boolean(db.prepare('SELECT close_requested_at AS at FROM table_attendance_state WHERE order_id=?').get(id)?.at);
  order.pendingKitchenTickets=db.prepare("SELECT COUNT(*) AS n FROM kitchen_ticket WHERE order_id=? AND status IN ('PENDING','PREPARING','READY')").get(id).n;
  return order;
}

export function writeOrder(db,order) {
  db.prepare('UPDATE sales_order SET status=?,revision=?,closed_at=? WHERE id=?')
    .run(order.status,order.revision,order.status==='CLOSED'?stamp():null,order.id);
}
