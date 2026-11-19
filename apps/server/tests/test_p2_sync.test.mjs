import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.mjs';

const command = (id, rest={}) => ({commandId:`sync-${id}`,...rest});
async function createUnit(t, name){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-multiunit-'));
 const app=createApp({dataPath:path.join(dir,'unit.sqlite')});
 const origin=await app.listen({port:0});
 let cookie='';
 async function request(method, endpoint, body){
  const headers=body?{'content-type':'application/json'}:{};
  if(cookie)headers.cookie=cookie;
  const response=await fetch(origin+endpoint,{method,headers,body:body?JSON.stringify(body):undefined});
  const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
  return {status:response.status,body:await response.json()};
 }
 t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true})});
 assert.equal((await request('POST','/api/auth/setup',{username:'admin',password:'senhaSupervisora-2026'})).status,201);
 return {request,origin};
}
async function sellOnce(request, name, suffix){
 const p=(await request('POST','/api/products',command('p-'+suffix,{name,priceCents:2200}))).body.product;
 await request('POST','/api/cash/open',command('cash-'+suffix,{openingCents:0}));
 const o=(await request('POST','/api/orders',command('order-'+suffix,{serviceMode:'counter'}))).body.order;
 assert.equal((await request('POST',`/api/orders/${o.id}/lines`,command('line-'+suffix,{productId:p.id,quantity:1,expectedRevision:0}))).status,200);
 assert.equal((await request('POST',`/api/orders/${o.id}/confirm`,command('confirm-'+suffix,{expectedRevision:1}))).status,200);
 assert.equal((await request('POST',`/api/orders/${o.id}/close`,command('close-'+suffix,{expectedRevision:2,payments:[{method:'pix',amountCents:2200}]}))).status,200);
 return o.id;
}
test('dois bancos independentes consolidam apenas estatísticas, nunca duplicam pedidos, estoques ou PII',async t=>{
 const a=await createUnit(t,'a'),b=await createUnit(t,'b');
 await sellOnce(a.request,'Hambúrguer loja A','a');
 const snapshot=(await a.request('GET','/api/sync/export')).body;
 assert.equal(snapshot.documentType,'PDV_NEXUS_UNIT_SUMMARY');
 assert.ok(snapshot.unitId.startsWith('unit-'));
 assert.equal(snapshot.revision,1);
 assert.equal(snapshot.daily.length,1);
 assert.equal(snapshot.daily[0].grossSalesCents,2200);
 assert.equal(JSON.stringify(snapshot).includes('customerName'),false);
 const imported=await b.request('POST','/api/sync/import',command('import-a',{snapshot}));
 assert.equal(imported.status,201,JSON.stringify(imported.body));
 assert.equal(imported.body.imported,true);
 const duplicate=await b.request('POST','/api/sync/import',command('import-a-again',{snapshot}));
 assert.equal(duplicate.status,200,JSON.stringify(duplicate.body));
 assert.equal(duplicate.body.imported,false);
 const report=await b.request('GET','/api/sync/units');
 assert.equal(report.status,200);
 assert.equal(report.body.units.length,2);
 assert.equal(report.body.totals.grossSalesCents,2200);
 assert.equal((await b.request('GET','/api/orders')).body.orders.length,0,'unidades remotas nunca geram pedidos locais');
 assert.equal((await b.request('GET','/api/stock/report')).body.totalValueCents,0);
 assert.notEqual(report.body.units[0].unitId,report.body.units[1].unitId);
});
test('revisão incrementa por mudança real; pacote antigo ou divergente não sobrescreve consolidação',async t=>{
 const a=await createUnit(t,'a'),b=await createUnit(t,'b');
 const first=(await a.request('GET','/api/sync/export')).body;
 const repeat=(await a.request('GET','/api/sync/export')).body;
 assert.equal(repeat.revision,first.revision);
 assert.equal(repeat.hash,first.hash);
 assert.equal((await b.request('POST','/api/sync/import',command('first',{snapshot:first}))).status,201);
 await sellOnce(a.request,'Pizza artesanal','rev');
 const second=(await a.request('GET','/api/sync/export')).body;
 assert.equal(second.revision,first.revision+1);
 assert.equal(second.previousHash,first.hash);
 assert.equal((await b.request('POST','/api/sync/import',command('second',{snapshot:second}))).status,201);
 assert.equal((await b.request('POST','/api/sync/import',command('stale',{snapshot:first}))).status,409);
 const tampered={...second,hash:'0'.repeat(64)};
 assert.equal((await b.request('POST','/api/sync/import',command('tamper',{snapshot:tampered}))).status,400);
 const divergent={...second,daily:[{...second.daily[0],grossSalesCents:9999}]};
 assert.equal((await b.request('POST','/api/sync/import',command('divergent',{snapshot:divergent}))).status,400);
 const report=await b.request('GET','/api/sync/units');
 assert.equal(report.body.totals.grossSalesCents,2200);
});
test('unidade rejeita importar seu próprio resumo e exige supervisor autenticado',async t=>{
 const a=await createUnit(t,'a');
 const snapshot=(await a.request('GET','/api/sync/export')).body;
 assert.equal((await a.request('POST','/api/sync/import',command('self',{snapshot}))).status,400);
 const unauth=await fetch(a.origin+'/api/sync/units');assert.equal(unauth.status,401);
 const cashier=await a.request('POST','/api/auth/operators',{username:'caixa1',password:'senhaOperador-2026',role:'cashier'});
 assert.equal(cashier.status,201);
 await a.request('POST','/api/auth/logout',{});
 await a.request('POST','/api/auth/login',{username:'caixa1',password:'senhaOperador-2026'});
 assert.equal((await a.request('GET','/api/sync/export')).status,403);
 assert.equal((await a.request('GET','/api/sync/units')).status,403);
});
