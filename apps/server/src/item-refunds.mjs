/** P1: refundable line quantity is monotonic; accounting remains additive and auditable. */
import {randomUUID} from 'node:crypto';
import {returnStockForRefund} from './inventory.mjs';
const integer=n=>Number.isSafeInteger(n)&&n>=0;
export function itemRefundRead(db,method,route,h){
 if(method!=='GET')return null;
 const m=route.match(/^\/api\/orders\/([^/]+)\/refund-items$/);
 if(!m)return null;
 h.databaseOrder(db,m[1]);
 const refunds=db.prepare(`SELECT id,line_id AS lineId,quantity,amount_cents AS amountCents,
   cash_cents AS cashCents,reason,return_to_stock AS returnToStock,created_at AS createdAt,actor_id AS actorId
   FROM order_item_refund WHERE order_id=? ORDER BY created_at,id`).all(m[1]);
 return {status:200,body:{refunds,totalRefundedCents:refunds.reduce((s,x)=>s+x.amountCents,0)}};
}
export function itemRefundWrite(db,method,route,body,h){
 const m=route.match(/^\/api\/orders\/([^/]+)\/refund-items$/);
 if(method!=='POST'||!m)return null;
 return h.transact(db,route,body,()=>{
  if(!h.supervisor)h.conflict('Devolução por item exige supervisor','SUPERVISOR_REQUIRED');
  const order=h.databaseOrder(db,m[1]);
  if(order.status!=='CLOSED')h.conflict('Devoluções exigem venda encerrada');
  if(db.prepare('SELECT 1 FROM order_refund WHERE order_id=?').get(order.id))h.conflict('Venda integralmente devolvida','ALREADY_REFUNDED');
  const line=db.prepare(`SELECT id,quantity,unit_price_cents AS unitPriceCents,cancelled_at
    FROM order_line WHERE id=? AND order_id=?`).get(body.lineId,order.id);
  if(!line||line.cancelled_at)h.missing('Item vendido');
  if(!Number.isSafeInteger(body.quantity)||body.quantity<1)h.bad('Quantidade inválida');
  const previous=db.prepare('SELECT COALESCE(SUM(quantity),0) AS qty FROM order_item_refund WHERE line_id=?').get(line.id).qty;
  if(body.quantity+previous>line.quantity)h.conflict('Quantidade a devolver excede a quantidade vendida','REFUND_QUANTITY_EXCEEDED');
  const amountCents=line.unitPriceCents*body.quantity;
  if(!integer(amountCents)||amountCents===0)h.bad('Total de devolução inválido');
  const cashCents=body.cashCents??0;
  h.requireCents(cashCents,'Valor devolvido em dinheiro');
  if(cashCents>amountCents)h.bad('Dinheiro devolvido excede total');
  if(amountCents>cashCents&&body.externalRefundConfirmed!==true)
    h.conflict('Confirme manualmente a devolução externa','EXTERNAL_REFUND_UNCONFIRMED');
  const payments=db.prepare(`SELECT method,COALESCE(SUM(amount_cents),0) AS total
    FROM payment WHERE order_id=? AND state='CONFIRMED' GROUP BY method`).all(order.id);
  const originalCash=payments.filter(x=>x.method==='cash').reduce((s,x)=>s+x.total,0);
  const refundedCash=db.prepare('SELECT COALESCE(SUM(cash_cents),0) AS cash FROM order_item_refund WHERE order_id=?').get(order.id).cash;
  if(cashCents+refundedCash>originalCash)h.conflict('Dinheiro devolvido excede pagamentos originais em espécie','CASH_REFUND_EXCEEDED');
  const refundSum=db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS total FROM order_item_refund WHERE order_id=?').get(order.id).total;
  if(refundSum+amountCents>order.totalCents)h.conflict('Estorno maior que a venda','REFUND_EXCEEDED');
  const session=cashCents>0?h.cashSession(db):null;
  if(cashCents>0&&(!session||h.cashExpected(db,session)<cashCents))h.conflict('Caixa fechado ou sem saldo para devolução','CASH_INSUFFICIENT');
  if(body.returnToStock!==undefined&&typeof body.returnToStock!=='boolean')h.bad('Reposição de estoque inválida');
  const reason=h.requireString(body.reason,'Motivo da devolução',240),id=randomUUID();
  if(body.returnToStock) returnStockForRefund(db,line.id,body.quantity,id,h.actor,h.stamp);
  db.prepare(`INSERT INTO order_item_refund(id,order_id,line_id,quantity,amount_cents,cash_cents,reason,return_to_stock,cash_session_id,actor_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id,order.id,line.id,body.quantity,amountCents,cashCents,reason,body.returnToStock?1:0,session?.id??null,h.actor,h.stamp());
  if(cashCents>0)db.prepare(`INSERT INTO cash_movement(id,session_id,kind,amount_cents,actor_id,created_at)
    VALUES(?,?,'WITHDRAWAL',?,?,?)`).run(randomUUID(),session.id,cashCents,h.actor,h.stamp());
  h.audit(db,order.id,'ORDER_ITEM_REFUNDED',{refundId:id,lineId:line.id,quantity:body.quantity,amountCents,cashCents,reason,returnedStock:!!body.returnToStock});
  return {refund:{id,orderId:order.id,lineId:line.id,quantity:body.quantity,amountCents,cashCents,reason,returnToStock:!!body.returnToStock}};
 },201);
}
