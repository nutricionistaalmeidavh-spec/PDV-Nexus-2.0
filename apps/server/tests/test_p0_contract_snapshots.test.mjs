/** P0: baseline público das rotas de pedidos (sem fixtures externos). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.mjs';
import {openDatabase} from '../src/db.mjs';
const command=(name,fields={})=>({commandId:'p0-'+name,...fields});
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-contract-p0-')),file=path.join(dir,'nexus.sqlite');
 const app=createApp({dataPath:file}),origin=await app.listen({port:0});
 let cookie='';
 async function request(method,url,body){
  const headers=body?{'content-type':'application/json'}:{};
  if(cookie)headers.cookie=cookie;
  const r=await fetch(origin+url,{method,headers,body:body?JSON.stringify(body):undefined});
  const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
  return {status:r.status,body:await r.json()};
 }
 const setup=await request('POST','/api/auth/setup',{username:'admin',password:'senhaMuitoForte-2026'});
 assert.equal(setup.status,201);
 t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {request,file,actor:setup.body.user.id};
}
const ok=async(r,m,url,b,status=200)=>{
 const result=await r(m,url,b);assert.equal(result.status,status,JSON.stringify(result.body));return result.body;
};
const shape=o=>({
 status:o.status,revision:o.revision,serviceMode:o.serviceMode,totalCents:o.totalCents,
 refunded:o.refunded,lines:o.lines.map(l=>({
  name:l.productName,price:l.unitPriceCents,qty:l.quantity,note:l.note,
  extras:l.modifiers.map(m=>[m.name,m.priceCents])
 })),payments:o.payments.map(p=>[p.method,p.amountCents,p.state])
});
test('P0 snapshots dos contratos HTTP e efeitos persistidos de pedido, KDS, caixa e impressão',async t=>{
 const {request:r,file,actor}=await fixture(t);
 const p=(await ok(r,'POST','/api/products',command('p',{name:'Pizza',priceCents:1900}),201)).product;
 const mod=(await ok(r,'POST','/api/products/'+p.id+'/modifiers',command('mod',{name:'Borda',priceCents:300}),201)).modifier;
 const created=await ok(r,'POST','/api/orders',command('order',{serviceMode:'counter'}),201);
 assert.deepEqual(shape(created.order),{status:'DRAFT',revision:0,serviceMode:'counter',totalCents:0,refunded:false,lines:[],payments:[]});
 const id=created.order.id,url='/api/orders/'+id;
 const add=command('add',{expectedRevision:0,productId:p.id,quantity:2,modifierIds:[mod.id],note:'Sem tomate'});
 const added=await ok(r,'POST',url+'/lines',add);
 assert.deepEqual(await ok(r,'POST',url+'/lines',add),added);
 assert.deepEqual(shape(added.order).lines,[{name:'Pizza',price:2200,qty:2,note:'Sem tomate',extras:[['Borda',300]]}]);
 const lineId=added.order.lines[0].id;
 await ok(r,'PATCH','/api/products/'+p.id,command('edit',{name:'Pizza nova',priceCents:3000}));
 const confirm=await ok(r,'POST',url+'/confirm',command('confirm',{expectedRevision:1}));
 assert.equal(confirm.order.status,'OPEN');
 assert.equal(confirm.order.totalCents,4400);
 assert.equal(confirm.order.lines[0].id,lineId);
 assert.equal(confirm.order.lines[0].productName,'Pizza');
 assert.equal((await ok(r,'GET','/api/kitchen/tickets')).tickets[0].lineId,lineId);
 await ok(r,'POST','/api/cash/open',command('cash',{openingCents:1000}),201);
 const close=command('close',{expectedRevision:2,payments:[{method:'cash',amountCents:2400,tenderedCents:3000},{method:'pix',amountCents:2000}]});
 const done=await ok(r,'POST',url+'/close',close);
 assert.deepEqual(await ok(r,'POST',url+'/close',close),done);
 assert.equal(done.changeCents,600);
 assert.deepEqual(shape(done.order),{status:'CLOSED',revision:3,serviceMode:'counter',totalCents:4400,refunded:false,
   lines:[{name:'Pizza',price:2200,qty:2,note:'Sem tomate',extras:[['Borda',300]]}],
   payments:[['cash',2400,'CONFIRMED'],['pix',2000,'CONFIRMED']]});
 const db=openDatabase(file);
 try{
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payment WHERE order_id=?').get(id).n,2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM outbox_event WHERE aggregate_id=? AND kind='PRINT_RECEIPT'").get(id).n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE aggregate_id=? AND action='ORDER_CLOSED' AND actor_id=?").get(id,actor).n,1);
  const payload=JSON.parse(db.prepare("SELECT payload_json FROM outbox_event WHERE aggregate_id=? AND kind='PRINT_RECEIPT'").get(id).payload_json);
  assert.equal(payload.lines[0].id,lineId);
 }finally{db.close();}
 assert.equal((await ok(r,'GET','/api/print/jobs')).jobs.length,1);
 assert.equal((await ok(r,'GET','/api/cash/current')).expectedCents,3400);
});

test('P0 invariantes: idempotência, revisão otimista, pagamentos e impressão não duplicam após falha',async t=>{
 const {request:r,file}=await fixture(t);
 const p=(await ok(r,'POST','/api/products',command('p2',{name:'Coxinha',priceCents:700}),201)).product;
 const created=await ok(r,'POST','/api/orders',command('o2',{serviceMode:'counter'}),201);
 assert.deepEqual(await ok(r,'POST','/api/orders',command('o2',{serviceMode:'counter'}),201),created);
 const id=created.order.id,url='/api/orders/'+id;
 const add=command('line2',{expectedRevision:0,productId:p.id,quantity:2});
 await ok(r,'POST',url+'/lines',add);
 const reused=await r('POST',url+'/lines',{...add,quantity:3});
 assert.equal(reused.status,409);
 assert.equal(reused.body.code,'IDEMPOTENCY_CONFLICT');
 const stale=await r('POST',url+'/lines',command('stale',{expectedRevision:0,productId:p.id,quantity:1}));
 assert.equal(stale.status,409);
 assert.equal(stale.body.code,'REVISION_CONFLICT');
 const c=await ok(r,'POST',url+'/confirm',command('confirm2',{expectedRevision:1}));
 const noCash=await r('POST',url+'/close',command('nocash',{expectedRevision:2,payments:[{method:'pix',amountCents:1400}]}));
 assert.equal(noCash.status,409);
 assert.equal(noCash.body.code,'CASH_CLOSED');
 assert.deepEqual(shape((await ok(r,'GET',url)).order),shape(c.order));
 const db=openDatabase(file);
 try{
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payment WHERE order_id=?').get(id).n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbox_event WHERE aggregate_id=?').get(id).n,0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM command_receipt WHERE command_id='p0-nocash'").get().n,0);
 }finally{db.close();}
});
test('P0 cancelamento preserva contrato, mesa livre, tickets sem pendências e trilha do supervisor',async t=>{
 const {request:r,file,actor}=await fixture(t);
 const p=(await ok(r,'POST','/api/products',command('p3',{name:'Água',priceCents:500}),201)).product;
 const table=(await ok(r,'POST','/api/tables',command('table',{label:'Mesa QA contrato'}),201)).table;
 const order=(await ok(r,'POST','/api/tables/'+table.id+'/open',command('open'),201)).order;
 const id=order.id,url='/api/orders/'+id;
 await ok(r,'POST',url+'/lines',command('line3',{productId:p.id,quantity:1,expectedRevision:0}));
 const confirmed=await ok(r,'POST',url+'/confirm',command('confirm3',{expectedRevision:1}));
 assert.equal((await ok(r,'GET','/api/kitchen/tickets')).tickets.length,1);
 const canceled=await ok(r,'POST',url+'/cancel',command('cancel',{reason:'Cliente desistiu',expectedRevision:confirmed.order.revision}));
 assert.equal(canceled.order.status,'CANCELLED');
 assert.deepEqual(await ok(r,'POST',url+'/cancel',command('cancel',{reason:'Cliente desistiu',expectedRevision:confirmed.order.revision})),canceled);
 assert.equal((await ok(r,'GET','/api/kitchen/tickets')).tickets.length,0);
 assert.equal((await ok(r,'GET','/api/tables')).tables.find(t=>t.id===table.id).orderId,null);
 const db=openDatabase(file);
 try{
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE aggregate_id=? AND actor_id=? AND action='ORDER_CANCELLED'").get(id,actor).n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM kitchen_ticket WHERE order_id=? AND status='CANCELLED'").get(id).n,1);
 }finally{db.close();}
});
