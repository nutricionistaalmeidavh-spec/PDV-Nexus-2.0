/** Atendimento por mesa: identidade de visita é sales_order.id, sem duplicar livro de pedidos.
 * Tablets usam credencial restrita por mesa e apenas a API LAN HTTPS. */
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createOrder} from '../../../packages/core/src/order.ts';
import {publicTableRead,publicTableSubmit} from './table-qr.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const activeOrder=db=>db.prepare("SELECT id,status FROM sales_order WHERE service_table_id=? AND status IN ('DRAFT','OPEN') ORDER BY created_at DESC LIMIT 1");
const tokenFor=(raw,orderId)=>sha(raw+':'+orderId);
const withSession=(db,raw,orderId)=>'/api/public/table/'+tokenFor(raw,orderId);
const paid=(status)=>status==='CLOSED';
const activeWaiter=(db,id)=>db.prepare(`SELECT ow.waiter_device_id AS deviceId, pd.label,ow.assigned_at AS assignedAt
 FROM order_waiter ow JOIN paired_device pd ON pd.id=ow.waiter_device_id WHERE ow.order_id=?`).get(id)??null;

export function pairedWaiterIdentity(db,raw){
 if(typeof raw!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(raw))return null;
 return db.prepare("SELECT id,label FROM paired_device WHERE token_hash=? AND role='waiter' AND revoked_at IS NULL AND expires_at>?")
  .get(sha(raw),new Date().toISOString())??null;
}
export function tabletIdentity(db,authorization){
 const raw=typeof authorization==='string'&&authorization.startsWith('Bearer ')?authorization.slice(7):'';
 if(!/^[0-9a-f]{64}$/.test(raw))return null;
 const row=db.prepare(`SELECT p.id,p.table_id AS tableId,t.label AS tableLabel FROM paired_tablet p
   JOIN service_table t ON t.id=p.table_id WHERE p.token_hash=? AND p.revoked_at IS NULL`).get(sha(raw));
 return row?{...row,token:raw}:null;
}
function current(db,identity){
 const order=activeOrder(db).get(identity.tableId);
 const lock=order?db.prepare('SELECT close_requested_at AS at FROM table_attendance_state WHERE order_id=?').get(order.id):null;
 return {order,closeRequested:Boolean(lock?.at)};
}
function ticketSummary(db,where,params=[]){
 return db.prepare(`SELECT kt.id,kt.order_id AS orderId,kt.line_id AS lineId,kt.status,kt.revision,
   st.label AS tableLabel,ol.product_name_snapshot AS productName,ol.quantity,
   CASE WHEN so.status='CLOSED' THEN 1 ELSE 0 END AS paid,
   ow.waiter_device_id AS waiterDeviceId,pd.label AS waiterName,
   dc.waiter_device_id AS claimedBy, dc.claimed_at AS claimedAt
 FROM kitchen_ticket kt JOIN sales_order so ON so.id=kt.order_id
 JOIN order_line ol ON ol.id=kt.line_id
 LEFT JOIN service_table st ON st.id=so.service_table_id
 LEFT JOIN order_waiter ow ON ow.order_id=so.id
 LEFT JOIN paired_device pd ON pd.id=ow.waiter_device_id
 LEFT JOIN kitchen_delivery_claim dc ON dc.ticket_id=kt.id
 WHERE ${where} ORDER BY kt.updated_at ASC LIMIT 200`).all(...params).map(row=>({...row,paid:!!row.paid}));
}
export function attendanceRead(db,method,route){
 if(method!=='GET')return null;
 if(route==='/api/attendance/overview'){
  const closingRequests=db.prepare(`SELECT s.order_id AS orderId,st.label AS tableLabel,s.close_requested_at AS requestedAt,
   (SELECT COALESCE(SUM(l.unit_price_cents*l.quantity),0) FROM order_line l WHERE l.order_id=s.order_id AND l.cancelled_at IS NULL) AS totalCents,
   (SELECT COALESCE(SUM(p.amount_cents),0) FROM payment p WHERE p.order_id=s.order_id AND p.state='CONFIRMED') AS paidCents,
   (SELECT COUNT(*) FROM kitchen_ticket k WHERE k.order_id=s.order_id AND k.status IN ('PENDING','PREPARING')) AS preparingTickets
   FROM table_attendance_state s JOIN sales_order so ON so.id=s.order_id
   JOIN service_table st ON st.id=so.service_table_id
   WHERE s.close_requested_at IS NOT NULL AND so.status IN ('DRAFT','OPEN')
   ORDER BY s.close_requested_at LIMIT 100`).all();
  const activeAttendants=db.prepare(`SELECT ow.order_id AS orderId,ow.waiter_device_id AS waiterDeviceId,pd.label AS waiterName,
   st.label AS tableLabel FROM order_waiter ow
   JOIN paired_device pd ON pd.id=ow.waiter_device_id
   JOIN sales_order so ON so.id=ow.order_id
   LEFT JOIN service_table st ON st.id=so.service_table_id
   WHERE so.status IN ('DRAFT','OPEN') ORDER BY so.created_at DESC LIMIT 100`).all();
  return {status:200,body:{
   closingRequests,activeAttendants,
   readyUnassigned:ticketSummary(db,"kt.status='READY' AND ow.waiter_device_id IS NULL AND dc.ticket_id IS NULL"),
   readyAssigned:ticketSummary(db,"kt.status='READY' AND (ow.waiter_device_id IS NOT NULL OR dc.ticket_id IS NOT NULL)"),
   paidPreparing:ticketSummary(db,"so.status='CLOSED' AND kt.status IN ('PENDING','PREPARING')")
  }};
 }
 if(route==='/api/attendance/analytics'){
  const prep=db.prepare(`SELECT kt.status,COUNT(*) AS quantity FROM kitchen_ticket kt GROUP BY kt.status`).all();
  const paidPending=db.prepare(`SELECT COUNT(*) AS count FROM kitchen_ticket kt
   JOIN sales_order o ON o.id=kt.order_id WHERE o.status='CLOSED' AND kt.status IN ('PENDING','PREPARING','READY')`).get().count;
  const deliveries=db.prepare("SELECT COUNT(*) AS count FROM kitchen_delivery_claim WHERE delivered_at IS NOT NULL").get().count;
  const payouts=db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM payment WHERE state='CONFIRMED'").get().cents;
  return {status:200,body:{ticketStatuses:prep,paidPendingTickets:paidPending,deliveredClaims:deliveries,confirmedPaymentCents:payouts,source:'canonical-sqlite'}};
 }
 if(route==='/api/tablet/settings'){
  const config=db.prepare("SELECT auto_accept AS autoAccept FROM tablet_settings WHERE id='local'").get();
  return {status:200,body:{autoAccept:!!config.autoAccept}};
 }
 return null;
}
export function tabletRead(db,method,route,identity){
 if(method!=='GET')return null;
 if(route==='/api/tablet/state'){
  const state=current(db,identity),qr=state.order?publicTableRead(db,'GET',withSession(db,identity.token,state.order.id)):null;
  return {status:200,body:{
   table:{id:identity.tableId,label:identity.tableLabel},
   order:state.order?{id:state.order.id,status:state.order.status}:null,
   closeRequested:state.closeRequested,
   approvalMode:qr?.body?.approvalMode??null,
   products:qr?.body?.products??[]
  }};
 }
 const m=route.match(/^\/api\/tablet\/requests\/([^/]+)$/);
 if(m){
  const state=current(db,identity);
  if(!state.order)return {status:404,body:{code:'NO_ACTIVE_ATTENDANCE'}};
  return publicTableRead(db,method,withSession(db,identity.token,state.order.id)+'/requests/'+m[1]);
 }
 return null;
}
export function tabletWrite(db,method,route,body,identity,h){
 if(method!=='POST')return null;
 if(route==='/api/tablet/start')return h.transact(db,route+':'+identity.id,body,()=>{
  const existing=current(db,identity);
  if(existing.closeRequested)h.conflict('Conta solicitada: aguarde o fechamento','CLOSING_REQUESTED');
  let orderId=existing.order?.id;
  if(!orderId){
   const order=createOrder({id:randomUUID(),serviceMode:'table',createdAt:h.stamp()});
   db.prepare(`INSERT INTO sales_order
    (id,restaurant_id,terminal_id,service_table_id,service_mode,status,revision,created_at)
    VALUES(?,'r-local','t-local',?,'table',?,?,?)`)
    .run(order.id,identity.tableId,order.status,order.revision,order.createdAt);
   orderId=order.id;
   h.audit(db,orderId,'TABLET_ATTENDANCE_STARTED',{tableId:identity.tableId,tabletId:identity.id});
  }
  db.prepare('INSERT OR IGNORE INTO table_attendance_state(order_id) VALUES(?)').run(orderId);
  const digest=sha(tokenFor(identity.token,orderId)),now=h.stamp();
  const config=db.prepare("SELECT auto_accept FROM tablet_settings WHERE id='local'").get();
  const expiry=new Date(Date.now()+7*24*60*60*1000).toISOString();
  db.prepare(`INSERT OR IGNORE INTO table_qr_session
    (id,table_id,order_id,token_hash,auto_accept,created_at,expires_at)
    VALUES(?,?,?,?,?,?,?)`)
    .run(randomUUID(),identity.tableId,orderId,digest,config.auto_accept,now,expiry);
  db.prepare('UPDATE table_qr_session SET expires_at=? WHERE token_hash=? AND revoked_at IS NULL').run(expiry,digest);
  return {order:{id:orderId,tableId:identity.tableId},reused:!!existing.order};
 },201);
 if(route==='/api/tablet/orders'){
  const state=current(db,identity);
  if(!state.order)return {status:409,body:{code:'TABLE_NOT_STARTED',message:'Inicie o atendimento antes de pedir'}};
  if(state.closeRequested)return {status:409,body:{code:'CLOSING_REQUESTED',message:'Conta solicitada; novos pedidos bloqueados'}};
  return publicTableSubmit(db,withSession(db,identity.token,state.order.id)+'/requests',body,{
   stamp:h.stamp,databaseOrder:h.databaseOrder,snapshotLineRecipe:h.snapshotLineRecipe,
   audit:(db,id,kind,payload)=>h.audit(db,id,kind,{...payload,tabletId:identity.id}),notifyKitchen:h.notifyKitchen
  });
 }
 if(route==='/api/tablet/close-request')return h.transact(db,route+':'+identity.id,body,()=>{
  const state=current(db,identity);
  if(!state.order)h.conflict('Mesa sem atendimento','TABLE_NOT_STARTED');
  db.prepare('INSERT OR IGNORE INTO table_attendance_state(order_id) VALUES(?)').run(state.order.id);
  if(state.closeRequested)return {closeRequested:true,orderId:state.order.id,reused:true};
  db.prepare('UPDATE table_attendance_state SET close_requested_at=? WHERE order_id=?').run(h.stamp(),state.order.id);
  h.audit(db,state.order.id,'TABLET_BILL_REQUESTED',{tableId:identity.tableId});
  return {closeRequested:true,orderId:state.order.id};
 });
 return null;
}
export function attendanceWrite(db,method,route,body,h){
 if(method!=='POST')return null;
 const pairing=route.match(/^\/api\/tables\/([^/]+)\/tablet\/pair$/);
 if(pairing){
  if(!h.supervisor)h.forbidden('Pareamento exige gerente ou administrador','SUPERVISOR_REQUIRED');
  const commandId=h.requireString(body.commandId,'Comando',128);
  if(!/^[A-Za-z0-9_-]{3,128}$/.test(commandId))h.bad('Comando inválido');
  // Credencial não pode ficar em command_receipt (histórico/idempotência).
  db.exec('BEGIN IMMEDIATE');
  try{
   if(db.prepare('SELECT 1 FROM command_receipt WHERE command_id=?').get(commandId))h.conflict('Pareamento já processado','PAIR_REPLAY');
   if(!db.prepare('SELECT 1 FROM service_table WHERE id=?').get(pairing[1]))h.missing('Mesa');
   const token=randomBytes(32).toString('hex'),id=randomUUID(),now=h.stamp();
   db.prepare('DELETE FROM paired_tablet WHERE table_id=?').run(pairing[1]);
   db.prepare('INSERT INTO paired_tablet(id,table_id,token_hash,created_at) VALUES(?,?,?,?)').run(id,pairing[1],sha(token),now);
   h.audit(db,pairing[1],'TABLET_PAIRED',{tabletId:id});
   db.prepare('INSERT INTO command_receipt(command_id,request_hash,response_json,created_at) VALUES(?,?,?,?)')
    .run(commandId,sha(JSON.stringify({route,tableId:pairing[1]})),JSON.stringify({status:201,body:{paired:true}}),now);
   db.exec('COMMIT');
   return {status:201,body:{tabletId:id,token,tableId:pairing[1]}};
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 if(route==='/api/tablet/settings')return h.transact(db,route,body,()=>{
  if(!h.supervisor)h.forbidden('Configuração exige supervisor','SUPERVISOR_REQUIRED');
  if(typeof body.autoAccept!=='boolean')h.bad('Selecione aprovação manual ou automática');
  db.prepare("UPDATE tablet_settings SET auto_accept=? WHERE id='local'").run(body.autoAccept?1:0);
  h.audit(db,'r-local','TABLET_APPROVAL_MODE_CHANGED',{autoAccept:body.autoAccept});
  return {autoAccept:body.autoAccept};
 });
 const assign=route.match(/^\/api\/orders\/([^/]+)\/waiter$/);
 if(assign)return h.transact(db,route,body,()=>{
  const order=db.prepare("SELECT id,status FROM sales_order WHERE id=? AND service_mode='table'").get(assign[1]);
  if(!order)h.missing('Atendimento de mesa');
  if(!['DRAFT','OPEN'].includes(order.status))h.conflict('Atendimento encerrado','ATTENDANCE_CLOSED');
  const waiterId=h.requireString(body.waiterDeviceId,'Garçom',128);
  const target=db.prepare("SELECT id,label FROM paired_device WHERE id=? AND role='waiter' AND revoked_at IS NULL AND expires_at>?")
   .get(waiterId,h.stamp());
  if(!target)h.missing('Garçom ativo');
  const previous=activeWaiter(db,order.id);
  if(!h.supervisor && (!h.deviceId||!(previous?previous.deviceId===h.deviceId:waiterId===h.deviceId)))
   h.forbidden('Somente o responsável atual ou gerente pode transferir','WAITER_ASSIGNMENT_DENIED');
  db.prepare(`INSERT INTO order_waiter(order_id,waiter_device_id,assigned_at) VALUES(?,?,?)
    ON CONFLICT(order_id) DO UPDATE SET waiter_device_id=excluded.waiter_device_id,assigned_at=excluded.assigned_at`)
   .run(order.id,waiterId,h.stamp());
  h.audit(db,order.id,'ATTENDANCE_WAITER_CHANGED',{before:previous?.deviceId??null,after:waiterId,waiterName:target.label});
  return {orderId:order.id,waiter:{deviceId:waiterId,label:target.label}};
 });
 const claim=route.match(/^\/api\/attendance\/tickets\/([^/]+)\/(claim|deliver)$/);
 if(claim)return h.transact(db,route,body,()=>{
  const ticket=db.prepare(`SELECT kt.id,kt.order_id AS orderId,kt.status,kt.revision,
    ow.waiter_device_id AS waiterId
    FROM kitchen_ticket kt LEFT JOIN order_waiter ow ON ow.order_id=kt.order_id WHERE kt.id=?`).get(claim[1]);
  if(!ticket)h.missing('Ticket');
  const waiterId=h.requireString(body.waiterDeviceId,'Garçom',128);
  const waiter=db.prepare("SELECT id,label FROM paired_device WHERE id=? AND role='waiter' AND revoked_at IS NULL AND expires_at>?")
   .get(waiterId,h.stamp());
  if(!waiter)h.missing('Garçom ativo');
  if(!h.supervisor && waiterId!==h.deviceId)h.forbidden('Garçom não autenticado','WAITER_MISMATCH');
  if(ticket.status!=='READY')h.conflict('Somente pedido pronto pode ser assumido ou entregue','TICKET_NOT_READY');
  const claimed=db.prepare('SELECT waiter_device_id AS waiterId,delivered_at AS deliveredAt FROM kitchen_delivery_claim WHERE ticket_id=?').get(ticket.id);
  if(claim[2]==='claim'){
   if(ticket.waiterId)h.conflict('Pedido já possui garçom responsável','WAITER_ALREADY_ASSIGNED');
   if(claimed)h.conflict('Pedido já foi assumido','TICKET_CLAIMED');
   const saved=db.prepare('INSERT OR IGNORE INTO kitchen_delivery_claim(ticket_id,waiter_device_id,claimed_at) VALUES(?,?,?)')
    .run(ticket.id,waiterId,h.stamp());
   if(saved.changes!==1)h.conflict('Pedido assumido simultaneamente','TICKET_CLAIMED');
   h.audit(db,ticket.orderId,'KITCHEN_TICKET_CLAIMED',{ticketId:ticket.id,waiterDeviceId:waiterId});
   return {ticketId:ticket.id,waiterDeviceId:waiterId,claimed:true};
  }
  if(claimed?.waiterId!==waiterId && ticket.waiterId!==waiterId)h.conflict('Garçom não responsável por este pedido','WAITER_NOT_RESPONSIBLE');
  const result=db.prepare("UPDATE kitchen_ticket SET status='SERVED',revision=revision+1,updated_at=? WHERE id=? AND status='READY'")
   .run(h.stamp(),ticket.id);
  if(result.changes!==1)h.conflict('Ticket alterado simultaneamente','REVISION_CONFLICT');
  if(claimed)db.prepare('UPDATE kitchen_delivery_claim SET delivered_at=? WHERE ticket_id=?').run(h.stamp(),ticket.id);
  h.audit(db,ticket.orderId,'KITCHEN_TICKET_DELIVERED',{ticketId:ticket.id,waiterDeviceId:waiterId});
  return {ticketId:ticket.id,status:'SERVED',waiterDeviceId:waiterId};
 });
 return null;
}
