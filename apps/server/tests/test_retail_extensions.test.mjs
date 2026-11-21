import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';
import { decodeEan13, encodeEan13, decodeScaleLabel, parseScaleSerial } from '../src/retail-hardware.mjs';

let seq=0;
const command=(body={})=>({commandId:'retail-test-'+(++seq),...body});
async function fixture(t){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-retail-'));
  const app=createApp({dataPath:path.join(folder,'db.sqlite')});
  const origin=await app.listen({port:0});
  let cookie='';
  t.after(async()=>{await app.close();fs.rmSync(folder,{recursive:true,force:true});});
  async function api(method,route,body){
    const headers=body?{'content-type':'application/json'}:{};
    if(cookie)headers.cookie=cookie;
    const response=await fetch(origin+route,{method,headers,body:body?JSON.stringify(body):undefined});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    return {status:response.status,data:await response.json()};
  }
  assert.equal((await api('POST','/api/auth/setup',{username:'gestor',password:'Super-Senha-2026!'})).status,201);
  return api;
}
test('EAN-13: checksum e PLU de balança não aceitam etiquetas adulteradas',()=>{
  const code=encodeEan13('789123456789');
  assert.equal(decodeEan13(code).valid,true);
  assert.equal(decodeEan13(code.slice(0,-1)+(code.endsWith('0')?'1':'0')).valid,false);
  const weighted=encodeEan13('200012300750');
  assert.deepEqual(decodeScaleLabel(weighted,{mode:'weight'}),{plu:'00123',weightGrams:750});
  assert.deepEqual(decodeScaleLabel(weighted,{mode:'price'}),{plu:'00123',priceCents:750});
});
test('Leitura serial: protocolos retornam peso estável ou erro verificável',()=>{
  assert.equal(parseScaleSerial('ST,GS,+0001.250kg',{brand:'generic'}).weightGrams,1250);
  assert.equal(parseScaleSerial('US,GS,+0001.250kg',{brand:'generic'}).stable,false);
  assert.equal(parseScaleSerial('\u0002+001.250kg\u0003',{brand:'filizola'}).weightMilli,1250);
  assert.throws(()=>parseScaleSerial('lixo',{brand:'generic'}),/Peso|quadro/);
});
test('Fornecedor, recebimento por lote e baixa FEFO são transacionais e idempotentes',async t=>{
  const api=await fixture(t);
  const vendor=await api('POST','/api/suppliers',command({name:'Distribuidora Alfa',document:'12345678900'}));
  assert.equal(vendor.status,201,JSON.stringify(vendor.data));
  const supplierId=vendor.data.supplier.id;
  assert.equal((await api('GET','/api/suppliers')).data.suppliers.length,1);
  const ingredient=(await api('POST','/api/stock/ingredients',command({name:'Queijo',unit:'g'}))).data.ingredient;
  const receive=async (lotCode,expiryDate,quantityMilli)=>api('POST','/api/stock/ingredients/'+ingredient.id+'/receive',
    command({quantityMilli,costCents:quantityMilli/1000*100,lotCode,expiryDate,supplierId}));
  assert.equal((await receive('LOTE-B','2027-06-01',400000)).status,201);
  assert.equal((await receive('LOTE-A','2027-03-01',400000)).status,201);
  const batches=(await api('GET','/api/stock/batches?ingredientId='+ingredient.id)).data.batches;
  assert.deepEqual(batches.map(b=>b.lotCode),['LOTE-A','LOTE-B']);
  const product=(await api('POST','/api/products',command({name:'Misto',priceCents:2200}))).data.product;
  assert.equal((await api('POST','/api/stock/recipes/'+product.id,command({items:[{ingredientId:ingredient.id,quantityMilli:500000}]}))).status,200);
  assert.equal((await api('POST','/api/cash/open',command({openingCents:0}))).status,201);
  const order=(await api('POST','/api/orders',command({serviceMode:'counter'}))).data.order;
  assert.equal((await api('POST','/api/orders/'+order.id+'/lines',command({expectedRevision:0,productId:product.id,quantity:1}))).status,200);
  assert.equal((await api('POST','/api/orders/'+order.id+'/confirm',command({expectedRevision:1}))).status,200);
  const close=command({expectedRevision:2,payments:[{method:'pix',amountCents:2200}]});
  assert.equal((await api('POST','/api/orders/'+order.id+'/close',close)).status,200);
  assert.equal((await api('POST','/api/orders/'+order.id+'/close',close)).status,200);
  const remaining=(await api('GET','/api/stock/batches?ingredientId='+ingredient.id)).data.batches;
  assert.deepEqual(remaining.map(b=>b.remainingMilli),[0,300000]);
  const report=await api('GET','/api/reports/financial?from=2026-01-01&to=2027-12-31');
  assert.equal(report.status,200,JSON.stringify(report.data));
  assert.equal(report.data.grossSalesCents,2200);
  assert.equal(report.data.methods.pix,2200);
  assert.equal(report.data.cogsCents,50000);
});
test('Lote vencido não é consumido; falha de venda não registra pagamento',async t=>{
  const api=await fixture(t);
  const ing=(await api('POST','/api/stock/ingredients',command({name:'Leite',unit:'ml'}))).data.ingredient;
  await api('POST','/api/stock/ingredients/'+ing.id+'/receive',command({quantityMilli:100000,costCents:100,lotCode:'VENCIDO',expiryDate:'2020-01-01'}));
  const p=(await api('POST','/api/products',command({name:'Café',priceCents:500}))).data.product;
  await api('POST','/api/stock/recipes/'+p.id,command({items:[{ingredientId:ing.id,quantityMilli:50000}]}));
  await api('POST','/api/cash/open',command({openingCents:0}));
  const o=(await api('POST','/api/orders',command({serviceMode:'counter'}))).data.order;
  await api('POST','/api/orders/'+o.id+'/lines',command({expectedRevision:0,productId:p.id,quantity:1}));
  await api('POST','/api/orders/'+o.id+'/confirm',command({expectedRevision:1}));
  const close=await api('POST','/api/orders/'+o.id+'/close',command({expectedRevision:2,payments:[{method:'cash',amountCents:500}]}));
  assert.equal(close.status,409,JSON.stringify(close.data));
  assert.equal((await api('GET','/api/stock/ingredients')).data.ingredients[0].onHandMilli,100000);
  assert.equal((await api('GET','/api/stock/batches?ingredientId='+ing.id)).data.batches[0].remainingMilli,100000);
});
test('Impressora serial opt-in aceita caminho local restrito sem exigir dependência nativa na instalação',async t=>{
  const api=await fixture(t);
  const saved=await api('POST','/api/printer',command({transport:'serial',devicePath:process.platform==='win32'?'COM3':'/dev/ttyUSB0',baudRate:9600}));
  assert.equal(saved.status,200,JSON.stringify(saved.data));
  assert.equal((await api('GET','/api/printer')).data.profile.transport,'serial');
  const blocked=await api('POST','/api/printer',command({transport:'serial',devicePath:'../../etc/passwd',baudRate:9600}));
  assert.equal(blocked.status,400);
});
