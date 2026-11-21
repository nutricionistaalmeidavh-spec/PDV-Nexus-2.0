/** P1: successive payments over the existing canonical payment ledger. */
import {randomUUID} from 'node:crypto';
import {splitSummary} from './restaurant-extras.mjs';
const cents=n=>Number.isSafeInteger(n)&&n>=0;
export function settlementSummary(db,orderId,h){
 const order=h.databaseOrder(db,orderId);
 const paid=db.prepare(`SELECT guest,method,amount_cents AS amountCents
   FROM payment WHERE order_id=? AND state='CONFIRMED'`).all(orderId);
 const paidCents=paid.reduce((x,p)=>x+p.amountCents,0);
 if(!cents(paidCents)||paidCents>order.totalCents)h.conflict('Pagamentos inconsistentes','SETTLEMENT_INVALID');
 const split=splitSummary(db,orderId);
 const guests=split.guests.map(g=>{
  const settled=paid.filter(p=>p.guest?.toLocaleLowerCase('pt-BR')===g.guest.toLocaleLowerCase('pt-BR'))
    .reduce((x,p)=>x+p.amountCents,0);
  return {guest:g.guest,totalCents:g.totalCents,paidCents:settled,balanceCents:g.totalCents-settled};
 });
 return {orderId,totalCents:order.totalCents,paidCents,balanceCents:order.totalCents-paidCents,guests,payments:paid};
}
export function settlementRead(db,method,route,h){
 if(method!=='GET')return null;
 const m=route.match(/^\/api\/orders\/([^/]+)\/settlement$/);
 if(!m)return null;
 return {status:200,body:{settlement:settlementSummary(db,m[1],h)}};
}
export function validatePayment(db,orderId,body,h){
 if(!['cash','pix','credit','debit','other'].includes(body.method))h.bad('Meio de pagamento inválido');
 h.requireCents(body.amountCents,'Pagamento',false);
 const guest=body.guest===undefined||body.guest===null?null:h.requireString(body.guest,'Convidado',60);
 if(body.method==='cash'){
  h.requireCents(body.tenderedCents??body.amountCents,'Dinheiro recebido');
  if((body.tenderedCents??body.amountCents)<body.amountCents)h.bad('Dinheiro insuficiente');
 }else if(body.tenderedCents!==undefined)h.bad('Troco é exclusivo para dinheiro');
 const settlement=settlementSummary(db,orderId,h);
 if(body.amountCents>settlement.balanceCents)h.conflict('Pagamento excede saldo da comanda','OVERPAYMENT');
 const split=splitSummary(db,orderId);
 if(split.guests.length){
  if(!split.fullyAssigned)h.conflict('Distribuição de convidados incompleta','INCOMPLETE_SPLIT');
  if(!guest)h.bad('Informe o convidado antes de receber pagamento');
  const group=settlement.guests.find(g=>g.guest.toLocaleLowerCase('pt-BR')===guest.toLocaleLowerCase('pt-BR'));
  if(!group)h.bad('Convidado não pertence à comanda');
  if(body.amountCents>group.balanceCents)h.conflict('Pagamento excede saldo do convidado','GUEST_OVERPAYMENT');
 }else if(guest)h.bad('Distribua os itens entre convidados antes de receber por pessoa');
 return {guest,changeCents:body.method==='cash'?(body.tenderedCents??body.amountCents)-body.amountCents:0};
}
export function settlementWrite(db,method,route,body,h){
 const m=route.match(/^\/api\/orders\/([^/]+)\/payments$/);
 if(method!=='POST'||!m)return null;
 return h.transact(db,route,body,()=>{
  const order=h.databaseOrder(db,m[1]);h.assertRevision(order,body.expectedRevision);
  if(order.status!=='OPEN')h.conflict('Confirme a comanda antes de receber','ORDER_NOT_OPEN');
  if(db.prepare('SELECT suspended_at FROM sales_order WHERE id=?').get(order.id)?.suspended_at)h.conflict('Retome a comanda antes de receber');
  const session=h.cashSession(db);if(!session)h.conflict('Abra o caixa antes de receber','CASH_CLOSED');
  const {guest,changeCents}=validatePayment(db,order.id,body,h);
  const id=randomUUID();
  db.prepare(`INSERT INTO payment(id,order_id,method,amount_cents,state,created_at,cash_session_id,guest)
    VALUES(?,?,?,?,'CONFIRMED',?,?,?)`).run(id,order.id,body.method,body.amountCents,h.stamp(),session.id,guest);
  db.prepare('UPDATE sales_order SET revision=revision+1 WHERE id=?').run(order.id);
  h.audit(db,order.id,'PARTIAL_PAYMENT_CONFIRMED',{paymentId:id,guest,method:body.method,amountCents:body.amountCents,changeCents});
  return {paymentId:id,order:h.databaseOrder(db,order.id),settlement:settlementSummary(db,order.id,h),changeCents};
 },201);
}
