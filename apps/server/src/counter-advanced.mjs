/** P2: reversible suspension, audited price edits and merge without duplicate sales. */
import {randomUUID} from 'node:crypto';
export function counterWrite(db,method,route,body,h){
 if(method!=='POST')return null;
 const state=route.match(/^\/api\/orders\/([^/]+)\/(suspend|resume)$/);
 if(state)return h.transact(db,route,body,()=>{
  const order=h.databaseOrder(db,state[1]);h.assertRevision(order,body.expectedRevision);
  if(!['DRAFT','OPEN'].includes(order.status))h.conflict('Pedido encerrado');
  if(db.prepare('SELECT 1 FROM payment WHERE order_id=?').get(order.id))h.conflict('Pedido já possui pagamento','ORDER_HAS_PAYMENT');
  const before=db.prepare('SELECT suspended_at AS suspendedAt FROM sales_order WHERE id=?').get(order.id).suspendedAt;
  const next=state[2]==='suspend'?h.stamp():null;
  if(state[2]==='resume'&&!before)h.conflict('Pedido não está suspenso');
  if(state[2]==='suspend'&&before)h.conflict('Pedido já suspenso');
  db.prepare('UPDATE sales_order SET suspended_at=?,revision=revision+1 WHERE id=?').run(next,order.id);
  h.audit(db,order.id,state[2]==='suspend'?'ORDER_SUSPENDED':'ORDER_RESUMED',{at:next});
  return {order:h.databaseOrder(db,order.id)};
 });
 const pricing=route.match(/^\/api\/orders\/([^/]+)\/(price-adjustments|discounts)$/);
 if(pricing)return h.transact(db,route,body,()=>{
  if(!h.supervisor)h.conflict('Alteração de preço exige supervisor','SUPERVISOR_REQUIRED');
  const order=h.databaseOrder(db,pricing[1]);h.assertRevision(order,body.expectedRevision);
  if(!['DRAFT','OPEN'].includes(order.status))h.conflict('Venda encerrada');
  if(db.prepare('SELECT 1 FROM payment WHERE order_id=?').get(order.id))h.conflict('Venda já possui pagamentos');
  const row=db.prepare('SELECT * FROM order_line WHERE id=? AND order_id=? AND cancelled_at IS NULL').get(body.lineId,order.id);
  if(!row)h.missing('Item da venda');
  const nextPrice=pricing[2]==='discounts'?
    row.unit_price_cents-h.requireCents(body.discountCents,'Desconto',false):h.requireCents(body.priceCents,'Preço');
  if(!Number.isSafeInteger(nextPrice)||nextPrice<0)h.bad('Desconto supera preço do item');
  if(pricing[2]==='discounts'&&body.discountCents>row.unit_price_cents)h.bad('Desconto supera preço');
  if(!Number.isSafeInteger(nextPrice*row.quantity))h.bad('Total excede limite de centavos');
  const reason=h.requireString(body.reason,'Justificativa',240);
  db.prepare(`UPDATE order_line SET unit_price_cents=?,original_unit_price_cents=COALESCE(original_unit_price_cents,unit_price_cents)
    WHERE id=?`).run(nextPrice,row.id);
  const eventId=randomUUID();
  db.prepare(`INSERT INTO order_price_change(id,order_id,line_id,previous_price_cents,next_price_cents,reason,actor_id,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(eventId,order.id,row.id,row.unit_price_cents,nextPrice,reason,h.actor,h.stamp());
  db.prepare('UPDATE sales_order SET revision=revision+1 WHERE id=?').run(order.id);
  h.audit(db,order.id,pricing[2]==='discounts'?'ORDER_ITEM_DISCOUNTED':'ORDER_ITEM_PRICE_ADJUSTED',
    {lineId:row.id,previousCents:row.unit_price_cents,newCents:nextPrice,reason,eventId});
  return {order:h.databaseOrder(db,order.id),priceChangeId:eventId};
 });
 const merge=route.match(/^\/api\/orders\/([^/]+)\/merge$/);
 if(merge)return h.transact(db,route,body,()=>{
  if(!h.supervisor)h.conflict('Junção de mesas exige supervisor','SUPERVISOR_REQUIRED');
  const target=h.databaseOrder(db,merge[1]);
  h.assertRevision(target,body.expectedRevision);
  if(typeof body.sourceOrderId!=='string'||body.sourceOrderId===target.id)h.bad('Comanda de origem inválida');
  const source=h.databaseOrder(db,body.sourceOrderId);
  h.assertRevision(source,body.expectedSourceRevision);
  if(target.serviceMode!=='table'||source.serviceMode!=='table'||!['DRAFT','OPEN'].includes(target.status)||!['DRAFT','OPEN'].includes(source.status))
   h.conflict('Junção exige duas mesas abertas','MERGE_INVALID_STATUS');
  if(db.prepare('SELECT 1 FROM payment WHERE order_id IN (?,?) LIMIT 1').get(target.id,source.id))
   h.conflict('Junção indisponível após recebimento parcial','MERGE_ALREADY_PAID');
  if(db.prepare('SELECT suspended_at FROM sales_order WHERE id=?').get(target.id).suspended_at
   ||db.prepare('SELECT suspended_at FROM sales_order WHERE id=?').get(source.id).suspended_at)
   h.conflict('Retome as comandas antes de juntar');
  if(target.lines.length+source.lines.length>100)h.conflict('Limite de 100 itens por comanda','MERGE_TOO_LARGE');
  db.prepare('UPDATE order_line SET order_id=? WHERE order_id=?').run(target.id,source.id);
  db.prepare('UPDATE kitchen_ticket SET order_id=? WHERE order_id=?').run(target.id,source.id);
  db.prepare('UPDATE sales_order SET status=?,revision=revision+1,closed_at=? WHERE id=?').run('CANCELLED',h.stamp(),source.id);
  db.prepare('UPDATE sales_order SET revision=revision+1 WHERE id=?').run(target.id);
  h.audit(db,target.id,'ORDERS_MERGED',{sourceOrderId:source.id,targetOrderId:target.id,sourceTableId:source.tableId,targetTableId:target.tableId,lineIds:source.lines.map(l=>l.id)});
  h.audit(db,source.id,'ORDER_MERGED_INTO',{targetOrderId:target.id});
  return {order:h.databaseOrder(db,target.id),sourceOrderId:source.id};
 });
 return null;
}
