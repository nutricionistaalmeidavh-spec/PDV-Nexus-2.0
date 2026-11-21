import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createApp} from '../src/server.mjs';
let id=0;const cmd=(data={})=>({commandId:'po-'+(++id),...data});
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'purchase-'));
 const app=createApp({dataPath:path.join(dir,'nexus.db')});
 const origin=await app.listen({port:0});let cookie='';
 t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
 async function api(method,route,body){
   const headers=body?{'content-type':'application/json'}:{};
   if(cookie)headers.cookie=cookie;
   const r=await fetch(origin+route,{method,headers,body:body?JSON.stringify(body):undefined});
   if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
   return {status:r.status,body:await r.json()};
 }
 assert.equal((await api('POST','/api/auth/setup',{username:'supervisor',password:'Longa-Senha-Compra-2026'})).status,201);
 return api;
}
test('pedidos de compras recebem estoque por transação única e idempotência',async t=>{
 const api=await fixture(t);
 const supplier=(await api('POST','/api/suppliers',cmd({name:'Fornecedor Local'}))).body.supplier;
 const a=(await api('POST','/api/stock/ingredients',cmd({name:'Pão',unit:'unit'}))).body.ingredient;
 const b=(await api('POST','/api/stock/ingredients',cmd({name:'Queijo',unit:'g'}))).body.ingredient;
 const purchase=await api('POST','/api/purchases',cmd({supplierId:supplier.id,items:[
   {ingredientId:a.id,quantityMilli:10000,costCents:500},
   {ingredientId:b.id,quantityMilli:200000,costCents:1200,lotCode:'QUEIJO-A',expiryDate:'2027-01-15'}
 ]}));
 assert.equal(purchase.status,201,JSON.stringify(purchase.body));
 const pid=purchase.body.purchase.id;
 assert.equal((await api('GET','/api/stock/ingredients')).body.ingredients.find(x=>x.id===a.id).onHandMilli,0);
 const body=cmd(),received=await api('POST','/api/purchases/'+pid+'/receive',body);
 assert.equal(received.status,201,JSON.stringify(received.body));
 assert.equal((await api('POST','/api/purchases/'+pid+'/receive',body)).status,201);
 assert.equal((await api('POST','/api/purchases/'+pid+'/receive',cmd())).status,409);
 const ingredients=(await api('GET','/api/stock/ingredients')).body.ingredients;
 assert.equal(ingredients.find(x=>x.id===a.id).onHandMilli,10000);
 assert.equal(ingredients.find(x=>x.id===b.id).bookValueCents,1200);
 const batches=(await api('GET','/api/stock/batches?ingredientId='+b.id)).body.batches;
 assert.equal(batches[0].remainingMilli,200000);
 assert.equal((await api('GET','/api/purchases/'+pid)).body.purchase.status,'RECEIVED');
});
test('compra cancelada não altera o estoque; lote inválido é rejeitado antes de criar a compra',async t=>{
 const api=await fixture(t);
 const supplier=(await api('POST','/api/suppliers',cmd({name:'Fornecedor Beta'}))).body.supplier;
 const ing=(await api('POST','/api/stock/ingredients',cmd({name:'Tomate',unit:'g'}))).body.ingredient;
 const invalid=await api('POST','/api/purchases',cmd({supplierId:supplier.id,items:[{ingredientId:ing.id,quantityMilli:10000,costCents:300,lotCode:'A',expiryDate:'2027-02-30'}]}));
 assert.equal(invalid.status,400);
 assert.equal((await api('GET','/api/purchases')).body.purchases.length,0);
 const valid=await api('POST','/api/purchases',cmd({supplierId:supplier.id,items:[{ingredientId:ing.id,quantityMilli:10000,costCents:300}]}));
 assert.equal(valid.status,201);
 const purchaseId=valid.body.purchase.id;
 assert.equal((await api('POST','/api/purchases/'+purchaseId+'/cancel',cmd({reason:'pedido duplicado'}))).status,201);
 assert.equal((await api('POST','/api/purchases/'+purchaseId+'/receive',cmd())).status,409);
 assert.equal((await api('GET','/api/stock/ingredients')).body.ingredients[0].onHandMilli,0);
});
