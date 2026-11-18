import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.mjs';
import {roleAllows} from '../src/lan-security.mjs';

async function fixture(t, operationMode='production') {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-export-'));
  const app=createApp({dataPath:path.join(directory,'nexus.db'),operationMode});
  const origin=await app.listen({port:0});
  let cookie='';
  t.after(async()=>{await app.close();fs.rmSync(directory,{recursive:true,force:true});});
  async function json(method,url,body){
    const headers=body?{'content-type':'application/json'}:{};if(cookie)headers.cookie=cookie;
    const r=await fetch(origin+url,{method,headers,body:body&&JSON.stringify(body)});
    const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];
    return {status:r.status,body:await r.json()};
  }
  const setup=await json('POST','/api/auth/setup',{username:'admin',password:'senhaMuitoForte-2026'});
  assert.equal(setup.status,201);
  return {origin,json,get cookie(){return cookie;}};
}
const command=(commandId,rest={})=>({commandId,...rest});

async function closeSale(json,name='=HYPERLINK("https://malicioso.exemplo")'){
  const product=(await json('POST','/api/products',command('product-export',{name,priceCents:2500}))).body.product;
  assert.equal((await json('POST','/api/cash/open',command('cash-export',{openingCents:5000}))).status,201);
  const created=await json('POST','/api/orders',command('order-export',{serviceMode:'counter'}));
  assert.equal(created.status,201);
  const id=created.body.order.id;
  const added=await json('POST','/api/orders/'+id+'/lines',command('line-export',{productId:product.id,quantity:2,expectedRevision:0}));
  assert.equal(added.status,200);
  const confirmed=await json('POST','/api/orders/'+id+'/confirm',command('confirm-export',{expectedRevision:1}));
  assert.equal(confirmed.status,200);
  const closed=await json('POST','/api/orders/'+id+'/close',command('pay-export',{expectedRevision:2,payments:[{method:'cash',amountCents:5000}]}));
  assert.equal(closed.status,200,JSON.stringify(closed.body));
  return id;
}

test('operação comum não depende de NFC-e e exporta vendas fechadas em JSON',async t=>{
  const {origin,json,cookie}=await fixture(t);
  const id=await closeSale(json,'X-burger');
  const health=await json('GET','/api/health');
  assert.equal(health.status,200);
  const status=await json('GET','/api/exports/status');
  assert.equal(status.body.exportAvailable,true);
  assert.equal(status.body.emissionAvailable,false);
  const response=await fetch(origin+'/api/exports/sales.json',{headers:{cookie}});
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-disposition')??'',/attachment/);
  const doc=await response.json();
  assert.equal(doc.schemaVersion,1);
  assert.equal(doc.documentType,'DATA_ONLY_NON_FISCAL');
  assert.equal(doc.sales.length,1);
  assert.equal(doc.sales[0].orderId,id);
  assert.equal(doc.sales[0].grossCents,5000);
  assert.equal(doc.sales[0].netCents,5000);
  assert.equal(doc.sales[0].lines[0].productName,'X-burger');
  assert.equal(doc.sales[0].payments[0].method,'cash');
  assert.equal(doc.sales[0].payments[0].amountCents,5000);
  assert.equal((await json('POST','/api/fiscal/orders/'+id+'/issue',command('emission-removed'))).status,404);
});

test('CSV é baixável, preserva centavos e protege contra fórmula de planilha',async t=>{
  const {origin,json,cookie}=await fixture(t);
  await closeSale(json);
  const response=await fetch(origin+'/api/exports/sales.csv',{headers:{cookie}});
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type')??'',/text\/csv/);
  const csv=await response.text();
  assert.match(csv,/gross_order_cents/);
  assert.match(csv,/5000/);
  assert.doesNotMatch(csv,/(?:^|;)"?=HYPERLINK/m);
  assert.ok(csv.includes("'=HYPERLINK"),'célula de nome deve neutralizar fórmula');
});

test('período é opcional, validado e aplicado sobre a data de fechamento',async t=>{
  const {origin,json,cookie}=await fixture(t);
  await closeSale(json,'Pastel');
  const outside=await fetch(origin+'/api/exports/sales.json?from=2000-01-01&to=2000-01-31',{headers:{cookie}});
  assert.equal(outside.status,200);
  assert.equal((await outside.json()).sales.length,0);
  const bad=await json('GET','/api/exports/sales.json?from=2026-02-31');
  assert.equal(bad.status,400);
  const reversed=await json('GET','/api/exports/sales.csv?from=2027-01-01&to=2026-01-01');
  assert.equal(reversed.status,400);
});

test('devoluções integrais aparecem na exportação sem alterar venda original',async t=>{
  const {origin,json,cookie}=await fixture(t);
  const id=await closeSale(json,'Hambúrguer');
  const refund=await json('POST','/api/orders/'+id+'/refund',command('refund-export',{reason:'Cliente devolveu'}));
  assert.equal(refund.status,201,JSON.stringify(refund.body));
  const r=await fetch(origin+'/api/exports/sales.json',{headers:{cookie}});
  const sale=(await r.json()).sales[0];
  assert.equal(sale.grossCents,5000);
  assert.equal(sale.refundedCents,5000);
  assert.equal(sale.netCents,0);
  assert.equal(sale.refund.reason,'Cliente devolveu');
});

test('apenas gerente/host pode exportar dados operacionais na LAN',()=>{
  for(const endpoint of ['/api/exports/sales.csv','/api/exports/sales.json']){
    assert.equal(roleAllows('waiter','GET',endpoint),false);
    assert.equal(roleAllows('kitchen','GET',endpoint),false);
    assert.equal(roleAllows('manager','GET',endpoint),true);
    assert.equal(roleAllows('local','GET',endpoint),true);
  }
});

test('formulario de exportacao com datas em branco nao deve falhar',async t=>{
  const {origin,json,cookie}=await fixture(t);
  await closeSale(json,'Produto sem periodo');
  const r=await fetch(origin+'/api/exports/sales.csv?from=&to=',{headers:{cookie}});
  assert.equal(r.status,200);
  assert.match(r.headers.get('content-type')??'',/text\/csv/);
  const csv=await r.text();
  assert.match(csv,/Produto sem periodo/);
});
