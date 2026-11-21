import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/server.mjs';
const cmd=(rest={})=>({commandId:randomUUID(),...rest});
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p1p2-')),app=createApp({dataPath:path.join(dir,'nexus.db')});
 const origin=await app.listen({port:0});let cookie='';
 async function api(method,route,body){
  const headers=body?{'content-type':'application/json'}:{};
  if(cookie)headers.cookie=cookie;
  const res=await fetch(origin+route,{method,headers,body:body?JSON.stringify(body):undefined});
  const json=await res.json();const c=res.headers.get('set-cookie');
  if(c)cookie=c.split(';')[0];
  return {status:res.status,...json};
 }
 t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true})});
 assert.equal((await api('POST','/api/auth/setup',{username:'admin',password:'Strong-Test-Password-2026'})).status,201);
 return api;
}
async function ok(api,method,url,body,code=200){
 const res=await api(method,url,body);
 assert.equal(res.status,code,JSON.stringify(res));
 return res;
}
async function openCash(api){
 await ok(api,'POST','/api/cash/open',cmd({openingCents:100000}),201);
}
async function orderWithLines(api,table=false){
 const p=(await ok(api,'POST','/api/products',cmd({name:'Hambúrguer',priceCents:1500}),201)).product;
 const t=table?(await ok(api,'POST','/api/tables',cmd({label:'Mesa 22'}),201)).table:null;
 const first=table?(await ok(api,'POST',`/api/tables/${t.id}/open`,cmd(),201)).order
  :(await ok(api,'POST','/api/orders',cmd({serviceMode:'counter'}),201)).order;
 const added=(await ok(api,'POST',`/api/orders/${first.id}/lines`,cmd({expectedRevision:first.revision,productId:p.id,quantity:2}))).order;
 const confirmed=(await ok(api,'POST',`/api/orders/${first.id}/confirm`,cmd({expectedRevision:added.revision}))).order;
 return {p,t,order:confirmed,lineId:confirmed.lines[0].id};
}

test('P1 recebimentos parciais sucessivos por convidado não duplicam saldos',async t=>{
 const api=await fixture(t);await openCash(api);
 const {order,lineId}=await orderWithLines(api,true);
 const split=await ok(api,'POST',`/api/orders/${order.id}/split`,cmd({expectedRevision:order.revision,allocations:[{lineId,guests:[{guest:'Ana',quantity:1},{guest:'Bruno',quantity:1}]}]}));
 const first=cmd({expectedRevision:split.order.revision,guest:'Ana',payments:[{method:'cash',amountCents:1500,tenderedCents:2000}]});
 const paid=await ok(api,'POST',`/api/orders/${order.id}/payments/partial`,first,201);
 assert.equal(paid.remainingCents,1500);assert.equal(paid.changeCents,500);
 const repeat=await ok(api,'POST',`/api/orders/${order.id}/payments/partial`,first,201);
 assert.deepEqual(repeat,paid);
 assert.equal((await api('POST',`/api/orders/${order.id}/lines/${lineId}/edit`,cmd({expectedRevision:paid.order.revision,quantity:3}))).status,409);
 const final=await ok(api,'POST',`/api/orders/${order.id}/payments/partial`,cmd({expectedRevision:paid.order.revision,guest:'Bruno',payments:[{method:'pix',amountCents:1500}]}),201);
 assert.equal(final.remainingCents,0);assert.equal(final.order.status,'CLOSED');
 assert.equal(final.order.payments.filter(p=>p.state==='CONFIRMED').length,2);
});

test('P1 estorno individual respeita quantidade, não duplica e exige confirmação externa',async t=>{
 const api=await fixture(t);await openCash(api);
 const {order,lineId}=await orderWithLines(api);
 const closed=await ok(api,'POST',`/api/orders/${order.id}/close`,cmd({expectedRevision:order.revision,payments:[{method:'pix',amountCents:3000}]}));
 const body=cmd({lineId,quantity:1,reason:'Produto com defeito',externalRefundConfirmed:true});
 const done=await ok(api,'POST',`/api/orders/${order.id}/refund-items`,body,201);
 assert.equal(done.refundedCents,1500);
 assert.equal((await ok(api,'POST',`/api/orders/${order.id}/refund-items`,body,201)).refundedCents,1500);
 assert.equal((await api('POST',`/api/orders/${order.id}/refund-items`,cmd({lineId,quantity:2,reason:'Duplicado',externalRefundConfirmed:true}))).status,409);
 const denied=await api('POST',`/api/orders/${order.id}/refund-items`,cmd({lineId,quantity:1,reason:'Defeito',externalRefundConfirmed:false}));
 assert.equal(denied.status,409);
 const report=await ok(api,'GET',`/api/orders/${order.id}/refund-items`);
 assert.equal(report.totalRefundedCents,1500);
 assert.equal((await api('POST',`/api/orders/${order.id}/refund`,cmd({reason:'Integral',externalRefundConfirmed:true}))).status,409);
});

test('P1 KDS estações roteiam por produto e permitem comprovante de cozinha',async t=>{
 const api=await fixture(t);
 const station=(await ok(api,'POST','/api/kitchen/stations',cmd({name:'Bebidas'}),201)).station;
 const p=(await ok(api,'POST','/api/products',cmd({name:'Refrigerante',priceCents:700}),201)).product;
 await ok(api,'POST',`/api/products/${p.id}/station`,cmd({stationId:station.id}));
 const order=(await ok(api,'POST','/api/orders',cmd({serviceMode:'counter'}),201)).order;
 const added=(await ok(api,'POST',`/api/orders/${order.id}/lines`,cmd({expectedRevision:order.revision,productId:p.id,quantity:1}))).order;
 await ok(api,'POST',`/api/orders/${order.id}/confirm`,cmd({expectedRevision:added.revision}));
 const tickets=await ok(api,'GET','/api/kitchen/tickets');
 assert.equal(tickets.tickets[0].stationId,station.id);
 const job=await ok(api,'POST',`/api/orders/${order.id}/print`,cmd({type:'KITCHEN',stationId:station.id}),201);
 assert.equal(job.printJob.kind,'PRINT_KITCHEN');
 assert.equal((await ok(api,'GET','/api/print/jobs')).jobs.some(j=>j.id===job.printJob.id),true);
});

test('P2 pizza fracionada calcula preço sem float e preserva sabores',async t=>{
 const api=await fixture(t);
 const pizza=(await ok(api,'POST','/api/pizza/products',cmd({name:'Pizza Especial',categoryId:'c-default'}),201)).product;
 const size=(await ok(api,'POST',`/api/pizza/products/${pizza.id}/sizes`,cmd({name:'Grande',basePriceCents:4500,pricingRule:'MAX',maxFlavors:4}),201)).size;
 const cheese=(await ok(api,'POST',`/api/pizza/products/${pizza.id}/flavors`,cmd({name:'Queijo',additionalPriceCents:300}),201)).flavor;
 const bacon=(await ok(api,'POST',`/api/pizza/products/${pizza.id}/flavors`,cmd({name:'Bacon',additionalPriceCents:900}),201)).flavor;
 const border=(await ok(api,'POST',`/api/pizza/products/${pizza.id}/borders`,cmd({name:'Catupiry',priceCents:600}),201)).border;
 const order=(await ok(api,'POST','/api/orders',cmd({serviceMode:'counter'}),201)).order;
 const added=await ok(api,'POST',`/api/orders/${order.id}/pizza-lines`,cmd({expectedRevision:order.revision,productId:pizza.id,sizeId:size.id,flavorIds:[cheese.id,bacon.id],borderId:border.id,quantity:2}));
 assert.equal(added.order.totalCents,2*(4500+900+600));
 const line=added.order.lines[0];
 assert.equal(line.pizza.flavors.length,2);
 assert.equal(line.pizza.sizeName,'Grande');
});

test('P2 preço por peso exige leitura estável e evita overflow',async t=>{
 const api=await fixture(t);
 const p=(await ok(api,'POST','/api/products',cmd({name:'Comida por Kg',priceCents:6000}),201)).product;
 await ok(api,'POST',`/api/products/${p.id}/sale-unit`,cmd({saleUnit:'kg'}));
 const order=(await ok(api,'POST','/api/orders',cmd({serviceMode:'counter'}),201)).order;
 const result=await ok(api,'POST',`/api/orders/${order.id}/weight-lines`,cmd({expectedRevision:order.revision,productId:p.id,weightGrams:1250,stable:true,manualConfirmed:true}));
 assert.equal(result.order.lines[0].unitPriceCents,7500);
 assert.equal(result.order.totalCents,7500);
 const rejected=await api('POST',`/api/orders/${order.id}/weight-lines`,cmd({expectedRevision:result.order.revision,productId:p.id,weightGrams:1000,stable:false}));
 assert.equal(rejected.status,400);
});
