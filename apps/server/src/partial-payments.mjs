/** P1: recebimentos progressivos por convidado, um único ledger de pagamentos. */
import {randomUUID} from 'node:crypto';
import {splitSummary} from './restaurant-extras.mjs';
import {consumeStockForOrder} from './inventory.mjs';
const valid=n=>Number.isSafeInteger(n)&&n>=0;
export function partialPaymentRead(db,method,route,h){
 if(method!=='GET')return null;
 const m=route.match(/^\/api\/orders\/([^/]+)\/payments\/partial$/);
 if(!m)return null;
 const order=h.databaseOrder(db,m[1]);
 const summary=splitSummary(db,order.id);
 const rows=db.prepare(`SELECT guest,method,amount_cents AS amountCents,created_at AS createdAt
   FROM payment WHERE order_id=? AND state='CONFIRMED' ORDER BY rowid`).all(order.id);
 const guests=summary.guests.map(g=>({...g,paidCents:rows.filter(p=>p.guest?.toLowerCase()===g.guest.toLowerCase()).reduce((sum,p)=>sum+p.amountCents,0)}));
 const paidCents=rows.reduce((n,p)=>n+p.amountCents,0);
 return {status:200,body:{paidCents,remainingCents:order.totalCents-paidCents,guests,payments:rows}};
}
export function partialPaymentWrite(db,method,route,body,h){
 const m=route.match(/^\/api\/orders\/([^/]+)\/payments\/partial$/);
 if(method!=='POST'||!m)return null;
 return h.transact(db,route,body,()=>{
  const order=h.databaseOrder(db,m[1]);
  h.assertRevision(order,body.expectedRevision);
  if(order.status!=='OPEN')h.conflict('Confirme a comanda antes de cobrar','ORDER_NOT_OPEN');
  if(!order.tableId)h.conflict('Recebimento por convidado requer comanda de mesa','TABLE_REQUIRED');
  const summary=splitSummary(db,order.id);
  if(!summary.fullyAssigned)h.conflict('Distribua todos os itens antes de cobrar','SPLIT_REQUIRED');
  const guest=h.requireString(body.guest,'Convidado',60);
  const group=summary.guests.find(g=>g.guest.toLocaleLowerCase('pt-BR')===guest.toLocaleLowerCase('pt-BR'));
  if(!group)h.conflict('Convidado não está na divisão','GUEST_UNKNOWN');
  const session=h.cashSession(db);
  if(!session)h.conflict('Caixa fechado','CASH_CLOSED');
  if(!Array.isArray(body.payments)||!body.payments.length||body.payments.length>6)h.bad('Informe até 6 meios de pagamento');
  const existing=db.prepare(`SELECT guest,amount_cents AS amountCents FROM payment
    WHERE order_id=? AND state='CONFIRMED'`).all(order.id);
  if(existing.some(p=>!p.guest))h.conflict('Existem recebimentos sem convidado','PAYMENT_MIXED_MODE');
  const paid=existing.reduce((sum,p)=>sum+p.amountCents,0);
  const guestPaid=existing.filter(p=>p.guest.toLocaleLowerCase('pt-BR')===group.guest.toLocaleLowerCase('pt-BR'))
    .reduce((sum,p)=>sum+p.amountCents,0);
  let amount=0,change=0;
  for(const p of body.payments){
   if(!['cash','pix','credit','debit','other'].includes(p?.method))h.bad('Meio de pagamento inválido');
   h.requireCents(p.amountCents,'Pagamento',false);
   if(p.method==='cash'){
    const tendered=p.tenderedCents??p.amountCents;
    h.requireCents(tendered,'Valor recebido');
    if(tendered<p.amountCents)h.bad('Dinheiro recebido inferior ao valor cobrado');
    change+=tendered-p.amountCents;
   }else if(p.tenderedCents!==undefined)h.bad('Troco permitido apenas para dinheiro');
   amount+=p.amountCents;
   if(!valid(amount)||!valid(change))h.bad('Pagamento acima do limite');
  }
  if(guestPaid+amount>group.totalCents)h.conflict('Pagamento excede saldo do convidado','GUEST_OVERPAYMENT');
  if(paid+amount>order.totalCents)h.conflict('Pagamento excede saldo da comanda','ORDER_OVERPAYMENT');
  for(const p of body.payments)db.prepare(`INSERT INTO payment
    (id,order_id,method,amount_cents,state,created_at,cash_session_id,guest)
    VALUES(?,?,?,?,'CONFIRMED',?,?,?)`)
    .run(randomUUID(),order.id,p.method,p.amountCents,h.stamp(),session.id,group.guest);
  const remainingCents=order.totalCents-paid-amount;
  const nextRevision=order.revision+1;
  if(remainingCents===0){
   const cogs=consumeStockForOrder(db,order.id,h.actor,h.conflict);
   db.prepare(`UPDATE sales_order SET status='CLOSED',revision=?,closed_at=? WHERE id=?`)
    .run(nextRevision,h.stamp(),order.id);
   db.prepare(`INSERT INTO outbox_event
    (id,kind,aggregate_id,payload_json,status,created_at)
    VALUES(?,'PRINT_RECEIPT',?,?,'PENDING',?)`)
    .run(randomUUID(),order.id,JSON.stringify({id:order.id,lines:order.lines,totalCents:order.totalCents}),h.stamp());
   h.audit(db,order.id,'ORDER_CLOSED_PARTIAL',{guest:group.guest,receivedCents:amount,cogsCents:cogs.cogsCents});
  }else{
   db.prepare('UPDATE sales_order SET revision=? WHERE id=?').run(nextRevision,order.id);
  }
  h.audit(db,order.id,'GUEST_PAYMENT_CONFIRMED',{guest:group.guest,amountCents:amount,remainingCents,changeCents:change,methods:body.payments.map(p=>p.method)});
  return {order:h.databaseOrder(db,order.id),guest:group.guest,paidCents:paid+amount,remainingCents,changeCents:change};
 },201);
}
