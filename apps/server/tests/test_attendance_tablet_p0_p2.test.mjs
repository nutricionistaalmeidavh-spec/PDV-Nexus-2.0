import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/server.mjs';

const cmd=(body={})=>({commandId:randomUUID(),...body});
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-attendance-'));
 const app=createApp({dataPath:path.join(dir,'local.sqlite')});
 const origin=await app.listen({port:0});
 let cookie='';
 async function api(method,route,body,token){
  const headers={};
  if(body!==undefined)headers['content-type']='application/json';
  if(token)headers.authorization='Bearer '+token;
  else if(cookie)headers.cookie=cookie;
  const response=await fetch(origin+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const setCookie=response.headers.get('set-cookie');
  if(setCookie&&!token)cookie=setCookie.split(';')[0];
  return {status:response.status,...await response.json()};
 }
 assert.equal((await api('POST','/api/auth/setup',{username:'admin',password:'senhaMuitoForte-2026'})).status,201);
 t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {api};
}
async function setupTable(api){
 const t=await api('POST','/api/tables',cmd({label:'Mesa 05'}));
 assert.equal(t.status,201,JSON.stringify(t));
 const p=await api('POST','/api/products',cmd({name:'Hamburguer',priceCents:2500}));
 assert.equal(p.status,201,JSON.stringify(p));
 const pair=await api('POST','/api/tables/'+t.table.id+'/tablet/pair',cmd());
 assert.equal(pair.status,201,JSON.stringify(pair));
 assert.match(pair.token,/^[a-f0-9]{64}$/);
 return {table:t.table,product:p.product,token:pair.token};
}

test('tablet fixo abre atendimento, registra pedido sem duplicar e bloqueia após solicitar conta',async t=>{
 const {api}=await fixture(t);
 const {table,product,token}=await setupTable(api);
 const before=await api('GET','/api/tablet/state',undefined,token);
 assert.equal(before.status,200);
 assert.equal(before.order,null);
 const started=await api('POST','/api/tablet/start',cmd(),token);
 assert.equal(started.status,201,JSON.stringify(started));
 assert.equal(started.order.tableId,table.id);
 const again=await api('POST','/api/tablet/start',cmd(),token);
 assert.equal(again.order.id,started.order.id);
 assert.equal(again.reused,true);
 const id=randomUUID(),payload={clientRequestId:id,items:[{productId:product.id,quantity:1}]};
 const queued=await api('POST','/api/tablet/orders',payload,token);
 assert.equal(queued.status,202,JSON.stringify(queued));
 assert.equal(queued.statusText,'PENDING');
 const replay=await api('POST','/api/tablet/orders',payload,token);
 assert.equal(replay.requestId,queued.requestId);
 const bill=await api('POST','/api/tablet/close-request',cmd(),token);
 assert.equal(bill.status,200,JSON.stringify(bill));
 assert.equal(bill.closeRequested,true);
 const blocked=await api('POST','/api/tablet/orders',{clientRequestId:randomUUID(),items:[{productId:product.id,quantity:1}]},token);
 assert.equal(blocked.status,409,JSON.stringify(blocked));
 assert.equal((await api('GET','/api/tablet/state',undefined,token)).closeRequested,true);
 const reopened=await api('POST','/api/orders/'+started.order.id+'/reopen-service',cmd({reason:'Cliente decidiu continuar consumindo'}));
 assert.equal(reopened.status,200,JSON.stringify(reopened));
 assert.equal(reopened.closeRequested,false);
 const newRequest=await api('POST','/api/tablet/orders',{clientRequestId:randomUUID(),items:[{productId:product.id,quantity:1}]},token);
 assert.equal(newRequest.status,202,JSON.stringify(newRequest));
 assert.equal((await api('POST','/api/tablet/close-request',cmd(),token)).status,200);
 const dashboard=await api('GET','/api/attendance/overview');
 assert.equal(dashboard.status,200);
 assert.ok(dashboard.closingRequests.some(x=>x.orderId===started.order.id));
});

test('pedido pago permanece no KDS, libera mesa e pode ser assumido no painel central',async t=>{
 const {api}=await fixture(t);
 const {table,product,token}=await setupTable(api);
 const config=await api('POST','/api/tablet/settings',cmd({autoAccept:true}));
 assert.equal(config.status,200,JSON.stringify(config));
 const started=await api('POST','/api/tablet/start',cmd(),token);
 const queued=await api('POST','/api/tablet/orders',{clientRequestId:randomUUID(),items:[{productId:product.id,quantity:1}]},token);
 assert.equal(queued.status,201,JSON.stringify(queued));
 const tickets=await api('GET','/api/kitchen/tickets');
 assert.equal(tickets.tickets.length,1);
 const ticket=tickets.tickets[0];
 assert.equal(ticket.attendanceId,started.order.id);
 const bill=await api('POST','/api/tablet/close-request',cmd(),token);
 assert.equal(bill.status,200);
 assert.equal((await api('POST','/api/cash/open',cmd({openingCents:0}))).status,201);
 const latest=(await api('GET','/api/orders/'+started.order.id)).order;
 const paid=await api('POST','/api/orders/'+started.order.id+'/close',cmd({expectedRevision:latest.revision,payments:[{method:'pix',amountCents:2500}]}));
 assert.equal(paid.status,200,JSON.stringify(paid));
 assert.equal(paid.order.status,'CLOSED');
 assert.equal((await api('GET','/api/tables')).tables[0].orderId,null);
 const preparing=(await api('GET','/api/kitchen/tickets')).tickets[0];
 assert.equal(preparing.paid,true);
 assert.equal(preparing.attendanceId,started.order.id);
 let state=await api('POST','/api/kitchen/tickets/'+ticket.id+'/status',cmd({expectedRevision:preparing.revision,status:'PREPARING'}));
 assert.equal(state.status,200);
 state=await api('POST','/api/kitchen/tickets/'+ticket.id+'/status',cmd({expectedRevision:state.ticket.revision,status:'READY'}));
 assert.equal(state.status,200);
 const dashboard=await api('GET','/api/attendance/overview');
 assert.ok(dashboard.readyUnassigned.some(x=>x.id===ticket.id&&x.paid===true));
 const waiterPin=await api('POST','/api/pairing/start',{role:'waiter',label:'Carlos'});
 assert.equal(waiterPin.status,201);
 const waiter=await api('POST','/api/pairing/redeem',{code:waiterPin.code});
 assert.equal(waiter.status,200);
 const claim=await api('POST','/api/attendance/tickets/'+ticket.id+'/claim',cmd({waiterDeviceId:waiter.deviceId}));
 assert.equal(claim.status,200,JSON.stringify(claim));
 const second=await api('POST','/api/attendance/tickets/'+ticket.id+'/claim',cmd({waiterDeviceId:waiter.deviceId}));
 assert.equal(second.status,409);
 const delivered=await api('POST','/api/attendance/tickets/'+ticket.id+'/deliver',cmd({waiterDeviceId:waiter.deviceId}));
 assert.equal(delivered.status,200,JSON.stringify(delivered));
 const next=await api('POST','/api/tablet/start',cmd(),token);
 assert.equal(next.status,201);
 assert.notEqual(next.order.id,started.order.id);
 assert.equal(next.order.tableId,table.id);
});

test('auditoria preserva transferência do garçom e responsável por item',async t=>{
 const {api}=await fixture(t);
 const {table,product}=await setupTable(api);
 async function waiter(name){
  const pin=await api('POST','/api/pairing/start',{role:'waiter',label:name});
  return (await api('POST','/api/pairing/redeem',{code:pin.code})).deviceId;
 }
 const carlos=await waiter('Carlos'),ana=await waiter('Ana');
 const order=(await api('POST','/api/tables/'+table.id+'/open',cmd())).order;
 assert.equal((await api('POST','/api/orders/'+order.id+'/waiter',cmd({waiterDeviceId:carlos}))).status,200);
 const added=await api('POST','/api/orders/'+order.id+'/lines',cmd({expectedRevision:order.revision,productId:product.id,quantity:1}));
 assert.equal(added.status,200);
 assert.equal(added.order.lines[0].waiterDeviceId,carlos);
 const transfer=await api('POST','/api/orders/'+order.id+'/waiter',cmd({waiterDeviceId:ana}));
 assert.equal(transfer.status,200,JSON.stringify(transfer));
 const read=await api('GET','/api/orders/'+order.id);
 assert.equal(read.order.waiter.deviceId,ana);
 assert.equal(read.order.lines[0].waiterDeviceId,carlos);
 const overview=await api('GET','/api/attendance/overview');
 assert.equal(overview.status,200);
 assert.ok(overview.activeAttendants.some(x=>x.orderId===order.id&&x.waiterDeviceId===ana));
});

test('tablet inválido não acessa outra mesa e token antigo é revogado na nova vinculação',async t=>{
 const {api}=await fixture(t);
 const {table,token}=await setupTable(api);
 assert.equal((await api('GET','/api/tablet/state',undefined,'0'.repeat(64))).status,401);
 const rotated=await api('POST','/api/tables/'+table.id+'/tablet/pair',cmd());
 assert.equal(rotated.status,201);
 assert.equal((await api('GET','/api/tablet/state',undefined,token)).status,401);
 assert.equal((await api('GET','/api/tablet/state',undefined,rotated.token)).status,200);
});
