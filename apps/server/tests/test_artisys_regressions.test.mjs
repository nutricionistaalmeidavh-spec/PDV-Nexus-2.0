/** Regressões do PDV ArtiSys #180, #181, #200, #205, #211 adaptadas ao host canônico Nexus. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/server.mjs';
import {openDatabase} from '../src/db.mjs';

const cmd=(id,fields={})=>({commandId:'artisys-'+id,...fields});
async function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-artisys-regression-'));
 const dataPath=path.join(dir,'nexus.db');
 const app=createApp({dataPath,publicMenuEnabled:true});
 const base=await app.listen({port:0});
 const sessions=new Map();
 async function api(who,method,route,body){
  const headers=body?{'content-type':'application/json'}:{};
  if(sessions.has(who))headers.cookie=sessions.get(who);
  const response=await fetch(base+route,{method,headers,body:body?JSON.stringify(body):undefined});
  const cookie=response.headers.get('set-cookie');
  if(cookie)sessions.set(who,cookie.split(';')[0]);
  return {status:response.status,body:await response.json()};
 }
 function expect(response,status){
  assert.equal(response.status,status,JSON.stringify(response.body));
  return response.body;
 }
 const admin=expect(await api('admin','POST','/api/auth/setup',{username:'admin',password:'senhaMuitoForte-2026'}),201).user;
 t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {api,expect,admin,dataPath};
}
async function createProduct(f,name,priceCents){
 return f.expect(await f.api('admin','POST','/api/products',cmd(randomUUID(),{name,priceCents})),201).product;
}
async function createTableOrder(f,label){
 const table=f.expect(await f.api('admin','POST','/api/tables',cmd(randomUUID(),{label})),201).table;
 const order=f.expect(await f.api('admin','POST',`/api/tables/${table.id}/open`,cmd(randomUUID())),201).order;
 return {table,order};
}
async function withProduct(f,order,product,command='add'){
 return f.expect(await f.api('admin','POST',`/api/orders/${order.id}/lines`,cmd(command+randomUUID(),{expectedRevision:order.revision,productId:product.id,quantity:1})),200).order;
}
async function confirm(f,order){
 return f.expect(await f.api('admin','POST',`/api/orders/${order.id}/confirm`,cmd(randomUUID(),{expectedRevision:order.revision})),200).order;
}

test('P0: 20 linhas públicas intencionais, inclusive produto repetido, persistem sem fantasmas em QR e KDS',async t=>{
 const f=await setup(t);
 const product=await createProduct(f,'Esfiha QR',900);
 const payload={clientRequestId:randomUUID(),customerName:'Cliente QR',phone:'16998765432',address:'Rua Comercial 123, Centro',
   items:Array.from({length:20},()=>({productId:product.id,quantity:1}))};
 const sent=f.expect(await f.api('guest','POST','/api/public/delivery/requests',payload),202);
 const retry=f.expect(await f.api('guest','POST','/api/public/delivery/requests',payload),202);
 assert.equal(retry.requestId,sent.requestId,'reenvio não pode criar outro pedido público');
 assert.equal((await f.api('admin','GET','/api/delivery/requests')).body.requests.length,1);
 const accepted=f.expect(await f.api('admin','POST',`/api/delivery/requests/${sent.requestId}/accept`,cmd('accept-20')),201);
 assert.equal(accepted.order.lines.length,20);
 assert.equal(new Set(accepted.order.lines.map(l=>l.id)).size,20,'cada unidade tem identidade própria');
 assert.equal(accepted.order.totalCents,18000);
 const retryAccept=f.expect(await f.api('admin','POST',`/api/delivery/requests/${sent.requestId}/accept`,cmd('accept-20')),201);
 assert.equal(retryAccept.order.id,accepted.order.id);
 const confirmed=await confirm(f,accepted.order);
 assert.equal(confirmed.lines.length,20);
 const tickets=f.expect(await f.api('admin','GET','/api/kitchen/tickets'),200).tickets.filter(t=>t.orderId===confirmed.id);
 assert.equal(tickets.length,20);
 assert.deepEqual(new Set(tickets.map(t=>t.lineId)),new Set(confirmed.lines.map(l=>l.id)));
 assert.equal((await f.api('admin','GET',`/api/orders/${confirmed.id}`)).body.order.totalCents,18000);
});

test('P0: cancelar comanda em PREPARING não desaparece com a produção nem libera mesa',async t=>{
 const f=await setup(t),product=await createProduct(f,'Produto em preparo',1500);
 const {table,order}=await createTableOrder(f,'Mesa de produção');
 const added=await withProduct(f,order,product);
 const open=await confirm(f,added);
 const ticket=f.expect(await f.api('admin','GET','/api/kitchen/tickets'),200).tickets.find(x=>x.orderId===open.id);
 f.expect(await f.api('admin','POST',`/api/kitchen/tickets/${ticket.id}/status`,cmd('preparing',{status:'PREPARING',expectedRevision:ticket.revision})),200);
 const cancelled=await f.api('admin','POST',`/api/orders/${open.id}/cancel`,cmd('cancel-preparing',{expectedRevision:open.revision,reason:'Cancelamento durante produção'}));
 assert.equal(cancelled.status,409,JSON.stringify(cancelled.body));
 assert.equal((await f.api('admin','GET',`/api/orders/${open.id}`)).body.order.status,'OPEN');
 assert.equal((await f.api('admin','GET','/api/tables')).body.tables.find(x=>x.id===table.id).orderId,open.id);
 assert.equal((await f.api('admin','GET','/api/kitchen/tickets')).body.tickets.find(x=>x.id===ticket.id).status,'PREPARING');
});

test('P0: operador de caixa não cancela comanda confirmada sem supervisor; cancelamento pendente é atômico',async t=>{
 const f=await setup(t),product=await createProduct(f,'Comanda com autorização',2000);
 const cashier=f.expect(await f.api('admin','POST','/api/auth/operators',{username:'operador',password:'senhaDoCaixa-2026',role:'cashier'}),201).user;
 f.expect(await f.api('cashier','POST','/api/auth/login',{username:'operador',password:'senhaDoCaixa-2026'}),200);
 const {table,order}=await createTableOrder(f,'Mesa com supervisão');
 const open=await confirm(f,await withProduct(f,order,product));
 const unauthorized=await f.api('cashier','POST',`/api/orders/${open.id}/cancel`,cmd('cashier-cancel',{expectedRevision:open.revision,reason:'Sem supervisor'}));
 assert.equal(unauthorized.status,403,JSON.stringify(unauthorized.body));
 assert.equal((await f.api('admin','GET','/api/kitchen/tickets')).body.tickets.filter(x=>x.orderId===open.id).length,1);
 const cancelled=f.expect(await f.api('admin','POST',`/api/orders/${open.id}/cancel`,cmd('admin-cancel',{expectedRevision:open.revision,reason:'Supervisor autorizou'})),200);
 assert.equal(cancelled.order.status,'CANCELLED');
 assert.equal((await f.api('admin','GET','/api/tables')).body.tables.find(x=>x.id===table.id).orderId,null);
 assert.equal((await f.api('admin','GET','/api/kitchen/tickets')).body.tickets.filter(x=>x.orderId===open.id).length,0);
 const db=openDatabase(f.dataPath);
 try{
  const log=db.prepare("SELECT actor_id FROM audit_log WHERE aggregate_id=? AND action='ORDER_CANCELLED'").get(open.id);
  assert.equal(log.actor_id,f.admin.id);
 }finally{db.close();}
 assert.ok(cashier.id!==f.admin.id);
});

test('P1: devolução e movimentos do caixa registram usuário real e não alteram fechamento histórico',async t=>{
 const f=await setup(t),product=await createProduct(f,'Item pago',2500);
 const cashier=f.expect(await f.api('admin','POST','/api/auth/operators',{username:'caixa2',password:'senhaDoCaixa-2026',role:'cashier'}),201).user;
 f.expect(await f.api('cashier','POST','/api/auth/login',{username:'caixa2',password:'senhaDoCaixa-2026'}),200);
 const opened=f.expect(await f.api('admin','POST','/api/cash/open',cmd('cash-open',{openingCents:10000})),201).session;
 const order=f.expect(await f.api('admin','POST','/api/orders',cmd('counter-sale',{serviceMode:'counter'})),201).order;
 const confirmed=await confirm(f,await withProduct(f,order,product));
 f.expect(await f.api('admin','POST',`/api/orders/${confirmed.id}/close`,cmd('pay',{expectedRevision:confirmed.revision,
  payments:[{method:'cash',amountCents:1000},{method:'pix',amountCents:1500}]})),200);
 f.expect(await f.api('admin','POST',`/api/orders/${confirmed.id}/refund`,cmd('refund',{reason:'Compra desfeita',externalRefundConfirmed:true})),201);
 f.expect(await f.api('cashier','POST','/api/cash/movements',cmd('supply',{kind:'SUPPLY',amountCents:500})),201);
 f.expect(await f.api('cashier','POST','/api/cash/movements',cmd('withdraw',{kind:'WITHDRAWAL',amountCents:200})),201);
 const closed=f.expect(await f.api('cashier','POST','/api/cash/close',cmd('close',{countedCents:10200})),200);
 assert.equal(closed.id,opened.id);
 assert.equal(closed.expectedCents,10300);
 assert.equal(closed.differenceCents,-100);
 const db=openDatabase(f.dataPath);
 try{
  const refund=db.prepare('SELECT actor_id FROM order_refund WHERE order_id=?').get(confirmed.id);
  assert.equal(refund.actor_id,f.admin.id);
  const rows=db.prepare('SELECT actor_id,kind,amount_cents FROM cash_movement WHERE session_id=? ORDER BY rowid').all(opened.id);
  assert.deepEqual(rows.map(x=>x.actor_id),[f.admin.id,cashier.id,cashier.id]);
  assert.deepEqual(rows.map(x=>x.amount_cents),[1000,500,200]);
  const closedAudit=db.prepare("SELECT actor_id FROM audit_log WHERE aggregate_id=? AND action='CASH_CLOSED'").get(opened.id);
  assert.equal(closedAudit.actor_id,cashier.id);
 }finally{db.close();}
 f.expect(await f.api('admin','POST','/api/cash/open',cmd('cash-new',{openingCents:500})),201);
 const db2=openDatabase(f.dataPath);
 try{
  const previous=db2.prepare('SELECT status,expected_amount_cents,counted_amount_cents FROM cash_session WHERE id=?').get(opened.id);
  assert.deepEqual(previous,{status:'CLOSED',expected_amount_cents:10300,counted_amount_cents:10200});
 }finally{db2.close();}
});
