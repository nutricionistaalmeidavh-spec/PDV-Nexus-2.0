import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createApp} from '../src/server.mjs';
const cmd=(id,data={})=>({commandId:'del-'+id,...data});
async function fixture(t,{enabled=false}={}){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-delivery-'));
 const app=createApp({dataPath:path.join(folder,'local.db'),publicMenuEnabled:enabled});
 const origin=await app.listen({port:0});
 let cookie='';
 async function request(method,route,body,guest=false){
   const headers=body?{'content-type':'application/json'}:{};
   if(cookie&&!guest)headers.cookie=cookie;
   const r=await fetch(origin+route,{method,headers,body:body?JSON.stringify(body):undefined});
   const sc=r.headers.get('set-cookie');if(sc&&!guest)cookie=sc.split(';')[0];
   return {status:r.status,body:await r.json()};
 }
 t.after(async()=>{await app.close();fs.rmSync(folder,{recursive:true,force:true});});
 assert.equal((await request('POST','/api/auth/setup',{username:'admin',password:'senhaMuitoForte-2026'})).status,201);
 return {request,origin};
}
test('cardapio publico fica fechado por padrao, sem vazamento de endereco ou pedidos',async t=>{
 const {request}=await fixture(t);
 assert.equal((await request('GET','/api/public/menu',null,true)).status,404);
 assert.equal((await request('POST','/api/public/delivery/requests',{customerName:'João',phone:'11999999999',address:'Rua qualquer, 123',items:[]},true)).status,404);
 assert.equal((await request('GET','/api/delivery/requests',null,true)).status,401);
});
test('cardapio LAN opcional é somente leitura e pedido externo necessita aceite de operador',async t=>{
 const {request}=await fixture(t,{enabled:true});
 const product=(await request('POST','/api/products',cmd('prod',{name:'Pizza margherita',priceCents:3800}))).body.product;
 const publicMenu=await request('GET','/api/public/menu',null,true);
 assert.equal(publicMenu.status,200,JSON.stringify(publicMenu.body));
 assert.equal(publicMenu.body.products[0].priceCents,3800);
 assert.equal(publicMenu.body.products[0].name,'Pizza margherita');
 assert.equal(publicMenu.body.products[0].categoryName,'Cardápio');
 assert.equal(JSON.stringify(publicMenu.body).includes('password'),false);
 const payload={customerName:'João Silva',phone:'11999999999',address:'Rua das Oliveiras, 123',note:'Sem campainha',
   items:[{productId:product.id,quantity:2}]};
 const created=await request('POST','/api/public/delivery/requests',payload,true);
 assert.equal(created.status,202,JSON.stringify(created.body));
 assert.equal(created.body.status,'PENDING');
 assert.equal(created.body.totalCents,7600);
 assert.ok(!JSON.stringify(created.body).includes('11999999999'));
 const mine=await request('GET','/api/delivery/requests');
 assert.equal(mine.status,200);
 assert.equal(mine.body.requests[0].phone,'11999999999');
 assert.equal(mine.body.requests[0].status,'PENDING');
 const accepted=await request('POST','/api/delivery/requests/'+created.body.requestId+'/accept',cmd('accept'));
 assert.equal(accepted.status,201,JSON.stringify(accepted.body));
 assert.equal(accepted.body.order.status,'DRAFT');
 assert.equal(accepted.body.order.serviceMode,'delivery');
 assert.equal(accepted.body.order.totalCents,7600);
 const duplicate=await request('POST','/api/delivery/requests/'+created.body.requestId+'/accept',cmd('accept'));
 assert.deepEqual(duplicate.body,accepted.body);
 assert.equal((await request('POST','/api/delivery/requests/'+created.body.requestId+'/accept',cmd('accept-again'))).status,409);
 assert.equal((await request('GET','/api/delivery/requests')).body.requests[0].status,'ACCEPTED');
 const kitchen=await request('GET','/api/kitchen/tickets');
 assert.equal(kitchen.body.tickets.length,0,'pedido não deve ser enviado à cozinha sem confirmação');
 const confirm=await request('POST','/api/orders/'+accepted.body.order.id+'/confirm',cmd('confirm',{expectedRevision:2}));
 assert.equal(confirm.status,200,JSON.stringify(confirm.body));
 assert.equal((await request('GET','/api/kitchen/tickets')).body.tickets.length,1);
});
test('rejeição e proteção contra pedidos adulterados não criam venda',async t=>{
 const {request}=await fixture(t,{enabled:true});
 const product=(await request('POST','/api/products',cmd('prod-2',{name:'Coxinha',priceCents:650}))).body.product;
 const base={customerName:'Maria',phone:'16999999999',address:'Avenida Teste numero 102',items:[{productId:product.id,quantity:1}]};
 assert.equal((await request('POST','/api/public/delivery/requests',{...base,items:[{productId:product.id,quantity:0}]},true)).status,400);
 assert.equal((await request('POST','/api/public/delivery/requests',{...base,items:[{productId:'unknown',quantity:1}]},true)).status,400);
 const created=await request('POST','/api/public/delivery/requests',base,true);
 assert.equal(created.status,202);
 const reject=await request('POST','/api/delivery/requests/'+created.body.requestId+'/reject',cmd('reject',{reason:'Fora da área'}));
 assert.equal(reject.status,200);
 assert.equal((await request('POST','/api/delivery/requests/'+created.body.requestId+'/accept',cmd('accepted-after-reject'))).status,409);
 const pending=(await request('GET','/api/delivery/requests')).body.requests.find(x=>x.id===created.body.requestId);
 assert.equal(pending.status,'REJECTED');
});
