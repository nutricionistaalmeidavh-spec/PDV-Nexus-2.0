/** Devolução integral não apaga/estorna lançamentos históricos da sessão original. */
import {randomUUID} from 'node:crypto';
export function refundWrite(db,method,route,body,h) {
  const m=route.match(/^\/api\/orders\/([^/]+)\/refund$/);
  if(method!=='POST'||!m)return null;
  const {transact,requireString,conflict,missing,databaseOrder,audit,actor,stamp,cashSession,cashExpected}=h;
  return transact(db,route,body,()=>{
    const order=databaseOrder(db,m[1]);
    if(order.status!=='CLOSED')conflict('Apenas vendas encerradas podem ser devolvidas');
    if(db.prepare('SELECT 1 FROM order_item_refund WHERE order_id=? LIMIT 1').get(order.id))conflict('Venda possui devoluções parciais; finalize por item','PARTIAL_REFUND_EXISTS');
    if(db.prepare('SELECT 1 FROM order_refund WHERE order_id=?').get(order.id))conflict('Venda já devolvida','ALREADY_REFUNDED');
    const reason=requireString(body.reason,'Motivo da devolução',240);
    const payments=db.prepare("SELECT method,amount_cents FROM payment WHERE order_id=? AND state='CONFIRMED'").all(order.id);
    const cashCents=payments.filter(x=>x.method==='cash').reduce((s,x)=>s+x.amount_cents,0);
    const externalCents=payments.filter(x=>x.method!=='cash').reduce((s,x)=>s+x.amount_cents,0);
    if(cashCents+externalCents!==order.totalCents)conflict('Pagamentos originais inconsistentes');
    if(externalCents>0&&body.externalRefundConfirmed!==true)conflict('Confirme manualmente a devolução externa antes de registrar','EXTERNAL_REFUND_UNCONFIRMED');
    const session=cashCents>0?cashSession(db):null;
    if(cashCents>0&&!session)conflict('Abra o caixa para registrar saída de dinheiro');
    if(cashCents>0&&cashExpected(db,session)<cashCents)conflict('Saldo em caixa insuficiente');
    const id=randomUUID(),now=stamp();
    db.prepare('INSERT INTO order_refund(id,order_id,amount_cents,cash_cents,reason,external_refund_confirmed,cash_session_id,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id,order.id,order.totalCents,cashCents,reason,externalCents>0?1:0,session?.id??null,actor,now);
    if(cashCents>0)db.prepare('INSERT INTO cash_movement(id,session_id,kind,amount_cents,actor_id,created_at) VALUES(?,?,?,?,?,?)')
      .run(randomUUID(),session.id,'WITHDRAWAL',cashCents,actor,now);
    audit(db,order.id,'ORDER_REFUNDED',{refundId:id,reason,cashCents,externalCents});
    return {refund:{id,orderId:order.id,amountCents:order.totalCents,cashCents,externalCents,externalRefundManual:externalCents>0}};
  },201);
}
