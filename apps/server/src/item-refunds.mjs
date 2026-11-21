/** P1: devoluções por linha e quantidade com cálculo monetário determinístico. */
import {randomUUID} from 'node:crypto';
const safe=n=>Number.isSafeInteger(n)&&n>=0;
const prorate=(part,total,paid)=>Number(BigInt(part)*BigInt(paid)/BigInt(total));
export function itemRefundRead(db,method,route,h){
 const m=route.match(/^\/api\/orders\/([^/]+)\/refund-items$/);
 if(method!=='GET'||!m)return null;
 const order=h.databaseOrder(db,m[1]);
 const refunds=db.prepare(`SELECT id,line_id AS lineId,quantity,amount_cents AS amountCents,
  cash_cents AS cashCents,external_cents AS externalCents,reason,actor_id AS actorId,
  created_at AS createdAt FROM order_line_refund WHERE order_id=? ORDER BY created_at,rowid`).all(order.id);
 const totalRefundedCents=refunds.reduce((s,x)=>s+x.amountCents,0);
 return {status:200,body:{refunds,totalRefundedCents,remainingCents:order.totalCents-totalRefundedCents}};
}
export function itemRefundWrite(db,method,route,body,h){
 const m=route.match(/^\/api\/orders\/([^/]+)\/refund-items$/);
 if(method!=='POST'||!m)return null;
 return h.transact(db,route,body,()=>{
  const order=h.databaseOrder(db,m[1]);
  if(order.status!=='CLOSED')h.conflict('Somente venda encerrada permite devolução','NOT_CLOSED');
  if(db.prepare('SELECT 1 FROM order_refund WHERE order_id=?').get(order.id))
   h.conflict('Venda já devolvida integralmente','ALREADY_REFUNDED');
  const line=db.prepare(`SELECT id,unit_price_cents AS priceCents,quantity
   FROM order_line WHERE order_id=? AND id=? AND cancelled_at IS NULL`).get(order.id,body.lineId);
  if(!line)h.missing('Item vendido');
  if(!Number.isSafeInteger(body.quantity)||body.quantity<1)h.bad('Quantidade da devolução inválida');
  const already=db.prepare(`SELECT COALESCE(SUM(quantity),0) AS quantity
   FROM order_line_refund WHERE line_id=?`).get(line.id).quantity;
  if(already+body.quantity>line.quantity)h.conflict('Quantidade já devolvida ou superior à vendida','REFUND_QUANTITY_EXCEEDED');
  const amountCents=body.quantity*line.priceCents;
  if(!safe(amountCents))h.bad('Devolução excedeu limite seguro');
  const paid=db.prepare(`SELECT method,amount_cents AS cents
   FROM payment WHERE order_id=? AND state='CONFIRMED'`).all(order.id);
  const paidTotal=paid.reduce((s,p)=>s+p.cents,0);
  if(paidTotal!==order.totalCents||!safe(paidTotal))h.conflict('Pagamentos originais inconsistentes');
  const originalCash=paid.filter(p=>p.method==='cash').reduce((s,p)=>s+p.cents,0);
  const previous=db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS total
   FROM order_line_refund WHERE order_id=?`).get(order.id).total;
  if(previous+amountCents>order.totalCents)h.conflict('Devolução acima do total da venda');
  const cashCents=prorate(previous+amountCents,order.totalCents,originalCash)-prorate(previous,order.totalCents,originalCash);
  const externalCents=amountCents-cashCents;
  if(externalCents>0&&body.externalRefundConfirmed!==true)
   h.conflict('Confirme a devolução manual via PIX/cartão','EXTERNAL_REFUND_UNCONFIRMED');
  if(body.restock!==undefined&&body.restock!==false)
   h.conflict('Reposição automática de lote exige vistoria; registre ajuste de estoque separadamente','RESTOCK_REQUIRES_INSPECTION');
  const reason=h.requireString(body.reason,'Motivo da devolução',240);
  const session=cashCents>0?h.cashSession(db):null;
  if(cashCents>0&&!session)h.conflict('Abra caixa para devolver dinheiro','CASH_CLOSED');
  if(cashCents>0&&h.cashExpected(db,session)<cashCents)
   h.conflict('Saldo em caixa insuficiente','INSUFFICIENT_CASH');
  const id=randomUUID(),now=h.stamp();
  db.prepare(`INSERT INTO order_line_refund
    (id,order_id,line_id,quantity,amount_cents,cash_cents,external_cents,reason,
    external_refund_confirmed,cash_session_id,actor_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id,order.id,line.id,body.quantity,amountCents,cashCents,externalCents,reason,externalCents>0?1:0,session?.id??null,h.actor,now);
  if(cashCents>0)db.prepare(`INSERT INTO cash_movement
    (id,session_id,kind,amount_cents,actor_id,created_at)
    VALUES(? ,? ,'WITHDRAWAL',?,?,?)`).run(randomUUID(),session.id,cashCents,h.actor,now);
  h.audit(db,order.id,'ORDER_ITEM_REFUNDED',{refundId:id,lineId:line.id,quantity:body.quantity,amountCents,cashCents,externalCents,reason});
  return {refund:{id,orderId:order.id,lineId:line.id,quantity:body.quantity,amountCents,cashCents,externalCents},
    refundedCents:amountCents,totalRefundedCents:previous+amountCents};
 },201);
}
