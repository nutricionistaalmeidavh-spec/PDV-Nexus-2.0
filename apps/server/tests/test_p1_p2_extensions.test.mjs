import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/server.mjs';
const cmd=(data={})=>({commandId:randomUUID(),...data});
async function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p1-p2-'));
 const app=createApp({dataPath:path.join(dir,'data.db')});
 const origin=await app.listen({port:0});let cookie='';
 async function api(method,route,body){
  const headers=body?{'content-type':'application/json'}:{};if(cookie)headers.cookie=cookie;
  const res=await fetch(origin+route,{method,headers,body:body?JSON.stringify(body):undefined});
  const set=res.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
  return {status:res.status,body:await res.json()};
 }
 const auth=await api('POST','/api/auth/setup',{username:'admin',password:'SenhaForte-2026-Complexa'});
 assert.equal(auth.status,201,JSON.stringify(auth.body));
 t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true})});
 async function ok(m,p,b,status=200){const v=await api(m,p,b);assert.equal(v.status,status,JSON.stringify(v.body));return v.body;}
 return {api,ok};
}
test('P1: pagamentos sucessivos por convidados fecham a mesa sem duplicar valores',async t=>{
 const {api,ok}=await setup(t);
 const a=(await ok('POST','/api/products',cmd({name:'A',priceCents:1500}),201)).product;
 const b=(await ok('POST','/api/products',cmd({name:'B',priceCents:2500}),201)).product;
 let order=(await ok('POST','/api/orders',cmd({serviceMode:'counter'}),201)).order;
 for(const p of [a,b])order=(await ok('POST',`/api/orders/${order.id}/lines`,cmd({expectedRevision:order.revision,productId:p.id,quantity:1}))).order;
 const lines=order.lines;
 order=(await ok('POST',`/api/orders/${order.id}/split`,cmd({expectedRevision:order.revision,allocations:[
  {lineId:lines[0].id,guests:[{guest:'Ana',quantity:1}]},
  {lineId:lines[1].id,guests:[{guest:'Bruno',quantity:1}]}
 ]}))).order;
 order=(await ok('POST',`/api/orders/${order.id}/confirm`,cmd({expectedRevision:order.revision}))).order;
 await ok('POST','/api/cash/open',cmd({openingCents:10000}),201);
 const first=cmd({expectedRevision:order.revision,guest:'Ana',method:'cash',amountCents:1500,tenderedCents:2000});
 let paid=await ok('POST',`/api/orders/${order.id}/payments`,first,201);
 assert.equal(paid.settlement.paidCents,1500);
 assert.equal(paid.settlement.balanceCents,2500);
 assert.equal((await ok('POST',`/api/orders/${order.id}/payments`,first,201)).settlement.paidCents,1500);
 assert.equal((await api('POST',`/api/orders/${order.id}/split`,cmd({expectedRevision:paid.order.revision,allocations:[]}))).status,409);
 assert.equal((await api('POST',`/api/orders/${order.id}/payments`,cmd({expectedRevision:paid.order.revision,guest:'Ana',method:'pix',amountCents:1}))).status,409);
 paid=await ok('POST',`/api/orders/${order.id}/payments`,cmd({expectedRevision:paid.order.revision,guest:'Bruno',method:'pix',amountCents:2500}),201);
 assert.equal(paid.settlement.balanceCents,0);
 const closed=await ok('POST',`/api/orders/${order.id}/close`,cmd({expectedRevision:paid.order.revision,payments:[]}));
 assert.equal(closed.order.status,'CLOSED');
 assert.equal(closed.order.payments.filter(x=>x.state==='CONFIRMED').length,2);
});
test('P1: estorno parcial por linha e quantidade é auditável e protegido contra double refund',async t=>{
 const {api,ok}=await setup(t);
 const p=(await ok('POST','/api/products',cmd({name:'Suco',priceCents:1200}),201)).product;
 let order=(await ok('POST','/api/orders',cmd({serviceMode:'counter'}),201)).order;
 order=(await ok('POST',`/api/orders/${order.id}/lines`,cmd({productId:p.id,quantity:3,expectedRevision:order.revision}))).order;
 const lineId=order.lines[0].id;
 order=(await ok('POST',`/api/orders/${order.id}/confirm`,cmd({expectedRevision:order.revision}))).order;
 await ok('POST','/api/cash/open',cmd({openingCents:10000}),201);
 order=(await ok('POST',`/api/orders/${order.id}/close`,cmd({expectedRevision:order.revision,payments:[{method:'cash',amountCents:3600}]}))).order;
 const refund=cmd({lineId,quantity:1,cashCents:1200,reason:'Produto devolvido',returnToStock:false});
 const a=await ok('POST',`/api/orders/${order.id}/refund-items`,refund,201);
 assert.equal(a.refund.amountCents,1200);
 assert.equal((await ok('POST',`/api/orders/${order.id}/refund-items`,refund,201)).refund.id,a.refund.id);
 const b=await ok('POST',`/api/orders/${order.id}/refund-items`,cmd({lineId,quantity:2,cashCents:2400,reason:'Restante devolvido',returnToStock:false}),201);
 assert.equal(b.refund.amountCents,2400);
 assert.equal((await api('POST',`/api/orders/${order.id}/refund-items`,cmd({lineId,quantity:1,cashCents:1200,reason:'Duplicada',returnToStock:false}))).status,409);
 const report=await ok('GET',`/api/orders/${order.id}/refund-items`);
 assert.equal(report.totalRefundedCents,3600);
 assert.equal(report.refunds.length,2);
});
test('P1: KDS roteia novos produtos para estação e gera pré-conta não fiscal',async t=>{
 const {ok}=await setup(t);
 const station=(await ok('POST','/api/kitchen/stations',cmd({name:'Bebidas'}),201)).station;
 const p=(await ok('POST','/api/products',cmd({name:'Água',priceCents:500}),201)).product;
 await ok('POST',`/api/kitchen/stations/${station.id}/products`,cmd({productId:p.id}),200);
 let order=(await ok('POST','/api/orders',cmd({serviceMode:'counter'}),201)).order;
 order=(await ok('POST',`/api/orders/${order.id}/lines`,cmd({expectedRevision:order.revision,productId:p.id,quantity:1}))).order;
 order=(await ok('POST',`/api/orders/${order.id}/confirm`,cmd({expectedRevision:order.revision}))).order;
 const tickets=await ok('GET',`/api/kitchen/tickets?stationId=${station.id}`);
 assert.equal(tickets.tickets.length,1);assert.equal(tickets.tickets[0].stationId,station.id);
 const job=await ok('POST',`/api/orders/${order.id}/print-requests`,cmd({type:'prebill'}),201);
 assert.equal(job.kind,'PREBILL');assert.ok(job.jobId);
});
test('P2: tamanho e sabores fracionados calculam preço determinístico e preservam snapshot',async t=>{
 const {ok}=await setup(t);
 const template=(await ok('POST','/api/products',cmd({name:'Pizza Montada',priceCents:0}),201)).product;
 const size=(await ok('POST','/api/pizza/sizes',cmd({name:'Grande',basePriceCents:2000}),201)).size;
 const flavor1=(await ok('POST','/api/pizza/flavors',cmd({name:'Queijo',priceCents:3000}),201)).flavor;
 const flavor2=(await ok('POST','/api/pizza/flavors',cmd({name:'Calabresa',priceCents:4000}),201)).flavor;
 let order=(await ok('POST','/api/orders',cmd({serviceMode:'counter'}),201)).order;
 const pizza=await ok('POST',`/api/orders/${order.id}/pizzas`,cmd({expectedRevision:order.revision,templateProductId:template.id,sizeId:size.id,flavorIds:[flavor1.id,flavor2.id],priceRule:'highest',quantity:1}));
 assert.equal(pizza.order.totalCents,6000);
 assert.equal(pizza.order.lines[0].id,pizza.pizza.lineId);
 assert.deepEqual(pizza.pizza.flavors.map(x=>x.id),[flavor1.id,flavor2.id]);
});
test('P2: balança calcula centavos por peso estável e não altera o catálogo',async()=>{
 const {weightedPriceCents}=await import('../src/weighted-sales.mjs');
 assert.equal(weightedPriceCents(3590,750),2693);
 assert.equal(weightedPriceCents(3590,1000),3590);
 assert.throws(()=>weightedPriceCents(3590,0),/Peso/);
});
test('P2: suspender/retomar venda, ajustar preço com auditoria e juntar mesas sem duplicar linhas',async t=>{
 const {ok}=await setup(t);
 const a=(await ok('POST','/api/tables',cmd({label:'01'}),201)).table;
 const b=(await ok('POST','/api/tables',cmd({label:'02'}),201)).table;
 let one=(await ok('POST',`/api/tables/${a.id}/open`,cmd(),201)).order;
 let two=(await ok('POST',`/api/tables/${b.id}/open`,cmd(),201)).order;
 const p=(await ok('POST','/api/products',cmd({name:'Café',priceCents:1000}),201)).product;
 one=(await ok('POST',`/api/orders/${one.id}/lines`,cmd({expectedRevision:one.revision,productId:p.id,quantity:1}))).order;
 two=(await ok('POST',`/api/orders/${two.id}/lines`,cmd({expectedRevision:two.revision,productId:p.id,quantity:1}))).order;
 one=(await ok('POST',`/api/orders/${one.id}/suspend`,cmd({expectedRevision:one.revision}))).order;
 assert.ok(one.suspendedAt);
 one=(await ok('POST',`/api/orders/${one.id}/resume`,cmd({expectedRevision:one.revision}))).order;
 assert.equal(one.suspendedAt,null);
 one=(await ok('POST',`/api/orders/${one.id}/price-adjustments`,cmd({expectedRevision:one.revision,lineId:one.lines[0].id,priceCents:850,reason:'Autorização gerente'}))).order;
 assert.equal(one.totalCents,850);
 const merged=(await ok('POST',`/api/orders/${one.id}/merge`,cmd({expectedRevision:one.revision,sourceOrderId:two.id,expectedSourceRevision:two.revision}))).order;
 assert.equal(merged.lines.length,2);assert.equal(merged.totalCents,1850);
});

test('P2: produto marcado como kg nao pode ser vendido como unidade; cadastro preserva unidade canonica',async t=>{
 const {api,ok}=await setup(t);
 const kg=(await ok('POST','/api/products',cmd({name:'Castanhas a granel',priceCents:3990,saleUnit:'kg'}),201)).product;
 const unit=(await ok('POST','/api/products',cmd({name:'Água sem gás',priceCents:500}),201)).product;
 assert.equal(kg.saleUnit,'kg');assert.equal(unit.saleUnit,'unit');
 const listed=await ok('GET','/api/products');
 assert.equal(listed.products.find(p=>p.id===kg.id).saleUnit,'kg');
 let order=(await ok('POST','/api/orders',cmd({serviceMode:'counter'}),201)).order;
 const invalid=await api('POST',`/api/orders/${order.id}/lines`,cmd({expectedRevision:order.revision,productId:kg.id,quantity:1}));
 assert.equal(invalid.status,404);
 order=(await ok('POST',`/api/orders/${order.id}/lines`,cmd({expectedRevision:order.revision,productId:unit.id,quantity:1}))).order;
 assert.equal(order.totalCents,500);
});
