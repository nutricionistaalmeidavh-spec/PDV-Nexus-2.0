import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/server.mjs';

const command=values=>({commandId:randomUUID(),...values});
async function unit(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p2-bi-'));
 const app=createApp({dataPath:path.join(dir,'local.sqlite')});
 const origin=await app.listen({port:0});
 let cookie='';
 async function api(method,route,body){
  const headers=body?{'content-type':'application/json'}:{};
  if(cookie)headers.cookie=cookie;
  const res=await fetch(origin+route,{method,headers,body:body?JSON.stringify(body):undefined});
  if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
  return {status:res.status,body:await res.json()};
 }
 t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
 assert.equal((await api('POST','/api/auth/setup',{username:'administrador',password:'senhaForte-BI-2026'})).status,201);
 return {api};
}
async function sale(api){
 const product=(await api('POST','/api/products',command({name:'Suco verde',priceCents:2500}))).body.product;
 const ing=(await api('POST','/api/stock/ingredients',command({name:'Polpa',unit:'g',lowStockMilli:6000}))).body.ingredient;
 assert.equal((await api('POST','/api/stock/recipes/'+product.id,command({items:[{ingredientId:ing.id,quantityMilli:2000}]}))).status,200);
 assert.equal((await api('POST','/api/stock/ingredients/'+ing.id+'/receive',command({quantityMilli:20000,costCents:5000}))).status,201);
 assert.equal((await api('POST','/api/cash/open',command({openingCents:0}))).status,201);
 const order=(await api('POST','/api/orders',command({serviceMode:'counter'}))).body.order;
 const line=(await api('POST','/api/orders/'+order.id+'/lines',command({productId:product.id,quantity:2,expectedRevision:order.revision}))).body.order;
 assert.equal((await api('POST','/api/orders/'+order.id+'/confirm',command({expectedRevision:line.revision}))).status,200);
 const paid=await api('POST','/api/orders/'+order.id+'/close',command({expectedRevision:line.revision+1,payments:[{method:'pix',amountCents:5000}]}));
 assert.equal(paid.status,200,JSON.stringify(paid.body));
 return {product,ing,orderId:order.id,lineId:line.lines[0].id};
}

test('P2 BI usa venda confirmada e devolução por item, sem somar pagamento duas vezes',async t=>{
 const {api}=await unit(t);
 const {ing,orderId,lineId}=await sale(api);
 const refund=await api('POST','/api/orders/'+orderId+'/refund-items',command({lineId,quantity:1,reason:'Devolvido',externalRefundConfirmed:true}));
 assert.equal(refund.status,201,JSON.stringify(refund.body));
 const report=await api('GET','/api/bi/dashboard');
 assert.equal(report.status,200,JSON.stringify(report.body));
 assert.equal(report.body.totals.orders,1);
 assert.equal(report.body.totals.grossSalesCents,5000);
 assert.equal(report.body.totals.refundedCents,2500);
 assert.equal(report.body.totals.netSalesCents,2500);
 assert.equal(report.body.totals.cogsCents,1000);
 assert.equal(report.body.byDay.reduce((s,d)=>s+d.netSalesCents,0),2500);
 assert.equal(report.body.topProducts[0].quantity,2);
 const packet=(await api('GET','/api/sync/export')).body;
 assert.equal(packet.daily.at(-1).refundedCents,2500,'snapshot multiloja inclui devolução parcial');
 assert.equal(packet.daily.at(-1).netSalesCents,2500);
 assert.equal(report.body.source,'canonical-sqlite');
 const stock=await api('GET','/api/bi/replenishment?lookbackDays=28&leadDays=3&safetyDays=2');
 assert.equal(stock.status,200,JSON.stringify(stock.body));
 const ingredient=stock.body.ingredients.find(i=>i.id===ing.id);
 assert.equal(ingredient.onHandMilli,16000);
 assert.equal(ingredient.usableMilli,16000);
 assert.equal(ingredient.automaticPurchase,false);
 const forecast=await api('GET','/api/bi/forecast?days=7&lookbackDays=56');
 assert.equal(forecast.status,200,JSON.stringify(forecast.body));
 assert.equal(forecast.body.products[0].status,'INSUFFICIENT_HISTORY');
 assert.equal(forecast.body.products[0].expectedUnits,null);
});

test('P2 BI consolida duas unidades de snapshot sem copiar pedidos e com frescor explícito',async t=>{
 const a=await unit(t),b=await unit(t);
 await sale(a.api);
 const snapshot=(await a.api('GET','/api/sync/export')).body;
 assert.equal((await b.api('POST','/api/sync/import',command({snapshot}))).status,201);
 const summary=await b.api('GET','/api/bi/consolidated');
 assert.equal(summary.status,200,JSON.stringify(summary.body));
 assert.equal(summary.body.units.length,2);
 assert.equal(summary.body.totals.orders,1);
 assert.equal(summary.body.totals.grossSalesCents,5000);
 assert.equal(summary.body.totals.refundedCents,0);
 assert.equal(summary.body.mode,'MANUAL_OPT_IN');
 assert.equal(summary.body.realTime,false);
 const external=summary.body.units.find(u=>u.unitId===snapshot.unitId);
 assert.equal(external.local,false);
 assert.ok(external.importedAt);
 assert.equal(typeof external.stale,'boolean');
 assert.equal((await b.api('GET','/api/orders')).body.orders.length,0,'sem replicar vendas');
 const repeat=await b.api('GET','/api/bi/consolidated');
 assert.equal(repeat.body.totals.grossSalesCents,summary.body.totals.grossSalesCents);
});

test('P2 BI restringe caixa, impede filtros inválidos e não importa dados automaticamente',async t=>{
 const {api}=await unit(t);
 assert.equal((await api('GET','/api/bi/dashboard?from=2026-02-30')).status,400);
 assert.equal((await api('GET','/api/bi/dashboard?from=2020-01-01&to=2026-11-22')).status,400);
 assert.equal((await api('GET','/api/bi/forecast?days=400')).status,400);
 assert.equal((await api('POST','/api/auth/operators',{username:'caixanova',password:'senhaCaixaForte-2026',role:'cashier'})).status,201);
 await api('POST','/api/auth/logout',{});
 await api('POST','/api/auth/login',{username:'caixanova',password:'senhaCaixaForte-2026'});
 assert.equal((await api('GET','/api/bi/dashboard')).status,403);
 assert.equal((await api('GET','/api/bi/consolidated')).status,403);
});
