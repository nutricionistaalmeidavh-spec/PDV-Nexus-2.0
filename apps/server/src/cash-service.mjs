/** Caixa local: movimentações transacionais e autoria real do operador. */
import {randomUUID} from 'node:crypto';

export function cashWrite(db,method,route,body,h){
 if(method!=='POST')return null;
 const {transact,requireCents,bad,conflict,audit,actor,stamp,cashSession,cashExpected,visibleCash}=h;
 if(route==='/api/cash/open')return transact(db,route,body,()=>{
   requireCents(body.openingCents,'Abertura');
   if(cashSession(db))conflict('Já existe caixa aberto');
   const id=randomUUID();
   db.prepare('INSERT INTO cash_session(id,terminal_id,opened_at,opening_amount_cents,status) VALUES(?,?,?,?,?)')
    .run(id,'t-local',stamp(),body.openingCents,'OPEN');
   audit(db,id,'CASH_OPENED',{openingCents:body.openingCents});
   return {session:visibleCash(db)};
 },201);
 if(route==='/api/cash/movements')return transact(db,route,body,()=>{
   const session=cashSession(db);if(!session)conflict('Caixa fechado');
   if(!['SUPPLY','WITHDRAWAL'].includes(body.kind))bad('Tipo de movimentação inválido');
   requireCents(body.amountCents,'Valor',false);
   if(body.kind==='WITHDRAWAL'&&body.amountCents>cashExpected(db,session))bad('Sangria superior ao saldo');
   const id=randomUUID();
   db.prepare('INSERT INTO cash_movement(id,session_id,kind,amount_cents,actor_id,created_at) VALUES(?,?,?,?,?,?)')
    .run(id,session.id,body.kind,body.amountCents,actor,stamp());
   audit(db,session.id,'CASH_MOVEMENT',{kind:body.kind,amountCents:body.amountCents});
   return {session:visibleCash(db)};
 },201);
 if(route==='/api/cash/close')return transact(db,route,body,()=>{
   const session=cashSession(db);if(!session)conflict('Caixa fechado');
   requireCents(body.countedCents,'Dinheiro contado');
   const expected=cashExpected(db,session);
   db.prepare("UPDATE cash_session SET status='CLOSED',counted_amount_cents=?,expected_amount_cents=?,closed_at=? WHERE id=?")
    .run(body.countedCents,expected,stamp(),session.id);
   audit(db,session.id,'CASH_CLOSED',{expected,counted:body.countedCents});
   return {id:session.id,expectedCents:expected,countedCents:body.countedCents,differenceCents:body.countedCents-expected};
 });
 return null;
}
