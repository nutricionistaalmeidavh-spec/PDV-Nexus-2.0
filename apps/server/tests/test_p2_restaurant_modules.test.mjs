/** P2: provider modules preserve public operations and kitchen concurrency. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.mjs';
import {tableRead,tableWrite} from '../src/table-service.mjs';
import {kitchenRead,kitchenWrite,dispatchKitchenTickets,kitchenTransitionAllowed} from '../src/kitchen-service.mjs';
import {modifierRead,modifierWrite} from '../src/modifier-service.mjs';

test('P2 módulos especializados expõem os mesmos contratos (sem estado paralelo)',()=>{
 for(const fn of [tableRead,tableWrite,kitchenRead,kitchenWrite,dispatchKitchenTickets,modifierRead,modifierWrite])assert.equal(typeof fn,'function');
 assert.equal(kitchenTransitionAllowed('PENDING','PREPARING'),true);
 assert.equal(kitchenTransitionAllowed('PENDING','READY'),false);
 assert.equal(kitchenTransitionAllowed('READY','SERVED'),true);
 assert.equal(kitchenTransitionAllowed('SERVED','PENDING'),false);
 assert.equal(kitchenTransitionAllowed('CANCELLED','READY'),false);
});
test('P2: múltiplas linhas na mesma comanda têm tickets persistentes e revisão concorrente por ticket',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p2-restaurant-'));
 const app=createApp({dataPath:path.join(dir,'db.sqlite')});
 const base=await app.listen({port:0});
 let cookie='';
 async function request(method,route,body){
  const headers=body?{'content-type':'application/json'}:{};
  if(cookie)headers.cookie=cookie;
  const res=await fetch(base+route,{method,headers,body:body?JSON.stringify(body):undefined});
  const sid=res.headers.get('set-cookie');if(sid)cookie=sid.split(';')[0];
  return {status:res.status,body:await res.json()};
 }
 const cmd=(value,more={})=>({commandId:'p2-'+value+'-'+randomUUID(),...more});
 const ok=async(method,route,body,status=200)=>{
  const r=await request(method,route,body);assert.equal(r.status,status,JSON.stringify(r.body));return r.body;
 };
 t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
 await ok('POST','/api/auth/setup',{username:'admin',password:'senhaMuitoForte-2026'},201);
 const product=(await ok('POST','/api/products',cmd('product',{name:'Pastel',priceCents:1200}),201)).product;
 const table=(await ok('POST','/api/tables',cmd('table',{label:'Mesa KDS 2'}),201)).table;
 const order=(await ok('POST',`/api/tables/${table.id}/open`,cmd('open'),201)).order;
 let current=order;
 for(let n=0;n<2;n++){
  const added=await ok('POST',`/api/orders/${order.id}/lines`,cmd('line'+n,{expectedRevision:current.revision,productId:product.id,quantity:1,note:'Linha '+n}));
  current=added.order;
 }
 current=(await ok('POST',`/api/orders/${order.id}/confirm`,cmd('confirm',{expectedRevision:current.revision}))).order;
 const tickets=(await ok('GET','/api/kitchen/tickets')).tickets.filter(t=>t.orderId===order.id);
 assert.equal(tickets.length,2);
 assert.deepEqual(new Set(tickets.map(t=>t.lineId)),new Set(current.lines.map(l=>l.id)));
 const [first,second]=tickets;
 const change={commandId:'p2-one-shot-'+randomUUID(),expectedRevision:first.revision,status:'PREPARING'};
 const response=await ok('POST',`/api/kitchen/tickets/${first.id}/status`,change);
 assert.deepEqual(await ok('POST',`/api/kitchen/tickets/${first.id}/status`,change),response);
 assert.equal((await request('POST',`/api/kitchen/tickets/${first.id}/status`,cmd('stale',{expectedRevision:first.revision,status:'READY'}))).status,409);
 assert.equal((await request('POST',`/api/orders/${order.id}/cancel`,cmd('cancel',{reason:'Cancelamento durante preparo',expectedRevision:current.revision}))).status,409);
 const persisted=(await ok('GET','/api/kitchen/tickets')).tickets;
 assert.equal(persisted.find(t=>t.id===first.id).status,'PREPARING');
 assert.equal(persisted.find(t=>t.id===second.id).status,'PENDING');
 assert.equal((await ok('GET','/api/tables')).tables.find(t=>t.id===table.id).orderId,order.id);
});
