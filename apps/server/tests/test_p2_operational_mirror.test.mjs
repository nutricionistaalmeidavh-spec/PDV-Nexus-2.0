import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createApp} from '../src/server.mjs';
const cmd=(id,x={})=>({commandId:'mirror-'+id,...x});
async function fixture(t,operationalSync=null){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-peer-'));
 const app=createApp({dataPath:path.join(dir,'local.sqlite'),operationalSync});
 const origin=await app.listen({port:0});
 let cookie='';
 async function request(method,route,body){
  const headers=body?{'content-type':'application/json'}:{};if(cookie)headers.cookie=cookie;
  const response=await fetch(origin+route,{method,headers,body:body?JSON.stringify(body):undefined});
  const sc=response.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];
  return {status:response.status,body:await response.json()};
 }
 t.after(async()=>{await app.close();fs.rmSync(dir,{force:true,recursive:true});});
 const setup=await request('POST','/api/auth/setup',{username:'admin',password:'senhaSupervisora-2026'});
 assert.equal(setup.status,201,JSON.stringify(setup.body));
 return {app,origin,request};
}
async function seed(t,unit,label,price=2400){
 const ingredient=(await unit.request('POST','/api/stock/ingredients',cmd('ing-'+label,{name:'Queijo '+label,unit:'g'}))).body.ingredient;
 assert.ok(ingredient);
 assert.equal((await unit.request('POST','/api/stock/ingredients/'+ingredient.id+'/receive',cmd('stock-'+label,{quantityMilli:500000,costCents:5000}))).status,201);
 const product=(await unit.request('POST','/api/products',cmd('p-'+label,{name:'Pizza '+label,priceCents:price}))).body.product;
 const order=(await unit.request('POST','/api/orders',cmd('o-'+label,{serviceMode:'counter'}))).body.order;
 await unit.request('POST','/api/cash/open',cmd('cash-'+label,{openingCents:0}));
 assert.equal((await unit.request('POST','/api/orders/'+order.id+'/lines',cmd('line-'+label,{productId:product.id,quantity:1,expectedRevision:0}))).status,200);
 assert.equal((await unit.request('POST','/api/orders/'+order.id+'/confirm',cmd('confirm-'+label,{expectedRevision:1}))).status,200);
 assert.equal((await unit.request('POST','/api/orders/'+order.id+'/close',cmd('close-'+label,{expectedRevision:2,payments:[{method:'pix',amountCents:price}]}))).status,200);
 return {order,ingredient,product};
}
test('espelho operacional importa pedidos/produtos/estoque em modo somente leitura sem mutar vendas locais',async t=>{
 const a=await fixture(t),b=await fixture(t);
 const {product}=await seed(t,a,'A');
 const source=await a.request('GET','/api/sync/operational/export');
 assert.equal(source.status,200,JSON.stringify(source.body));
 assert.equal(source.body.documentType,'PDV_NEXUS_READONLY_MIRROR');
 assert.ok(source.body.unitId.startsWith('unit-'));
 assert.equal(source.body.products[0].name,'Pizza A');
 assert.equal(source.body.stock[0].onHandMilli,500000);
 assert.equal(source.body.orders.length,1);
 assert.equal(source.body.orders[0].lines[0].productName,'Pizza A');
 assert.equal(source.body.orders[0].totalCents,2400);
 assert.doesNotMatch(JSON.stringify(source.body),/phone|customerName|address|token|password/i);
 const imported=await b.request('POST','/api/sync/operational/import',cmd('import-a',{snapshot:source.body}));
 assert.equal(imported.status,201,JSON.stringify(imported.body));
 assert.equal(imported.body.imported,true);
 assert.equal((await b.request('GET','/api/orders')).body.orders.length,0,'não cria pedido financeiro de outra loja');
 assert.equal((await b.request('GET','/api/stock/ingredients')).body.ingredients.length,0,'não mistura estoque entre unidades');
 const peers=await b.request('GET','/api/sync/operational/peers');
 assert.equal(peers.status,200,JSON.stringify(peers.body));
 assert.equal(peers.body.peers[0].orders.length,1);
 assert.equal(peers.body.peers[0].stock[0].onHandMilli,500000);
 assert.equal(peers.body.peers[0].products[0].id,product.id);
 const repeated=await b.request('POST','/api/sync/operational/import',cmd('import-repeat',{snapshot:source.body}));
 assert.equal(repeated.status,200);
 assert.equal(repeated.body.imported,false);
 assert.equal((await b.request('GET','/api/sync/operational/peers')).body.peers.length,1);
});
test('revisões antigas, mesmo número com alteração e payload adulterado não substituem espelho',async t=>{
 const a=await fixture(t),b=await fixture(t);
 const original=(await a.request('GET','/api/sync/operational/export')).body;
 assert.equal((await b.request('POST','/api/sync/operational/import',cmd('first',{snapshot:original}))).status,201);
 await seed(t,a,'B');
 const next=(await a.request('GET','/api/sync/operational/export')).body;
 assert.ok(next.revision>original.revision);
 assert.equal((await b.request('POST','/api/sync/operational/import',cmd('next',{snapshot:next}))).status,201);
 assert.equal((await b.request('POST','/api/sync/operational/import',cmd('old',{snapshot:original}))).status,409);
 assert.equal((await b.request('POST','/api/sync/operational/import',cmd('tamper',{snapshot:{...next,hash:'0'.repeat(64)}}))).status,400);
 const current=(await b.request('GET','/api/sync/operational/peers')).body.peers[0];
 assert.equal(current.orders.length,1);
 assert.equal(current.revision,next.revision);
});
test('sincronização automática opt-in faz pull HTTPS autenticado e não registra segredo na resposta',async t=>{
 const source=await fixture(t);
 await seed(t,source,'C');
 const snapshot=(await source.request('GET','/api/sync/operational/export')).body;
 const secret='local-manager-token-long-with-at-least-32-characters';
 let calls=0,headers;
 const receiver=await fixture(t,{peers:[{url:'https://192.168.1.30:3434',token:secret}],intervalMs:30000,
  transport:async (url,opts)=>{calls++;headers=opts.headers;assert.equal(url,'https://192.168.1.30:3434/api/sync/operational/export');return {ok:true,status:200,json:async()=>snapshot};}});
 const sync=await receiver.app.syncPeersOnce();
 assert.equal(sync.ok,1,JSON.stringify(sync));
 assert.ok(calls>=1);
 assert.equal(headers.authorization,'Bearer '+secret);
 const mirror=await receiver.request('GET','/api/sync/operational/peers');
 assert.equal(mirror.body.peers[0].orders.length,1);
 const status=await receiver.request('GET','/api/sync/operational/status');
 assert.equal(status.body.enabled,true);
 assert.equal(status.body.peers.length,1);
 assert.doesNotMatch(JSON.stringify(status.body),new RegExp(secret));
 await assert.rejects(()=>fixture(t,{peers:[{url:'http://192.168.1.30:3434',token:secret}]}),/HTTPS/i);
});
test('operador de caixa e usuário sem sessão não acessam espelhos de outras unidades',async t=>{
 const u=await fixture(t);
 const noSession=await fetch(u.origin+'/api/sync/operational/export');
 assert.equal(noSession.status,401);
 assert.equal((await u.request('POST','/api/auth/operators',{username:'caixa1',password:'outraSenhaForte-2026',role:'cashier'})).status,201);
 await u.request('POST','/api/auth/logout',{});
 await u.request('POST','/api/auth/login',{username:'caixa1',password:'outraSenhaForte-2026'});
 assert.equal((await u.request('GET','/api/sync/operational/peers')).status,403);
 assert.equal((await u.request('GET','/api/sync/operational/export')).status,403);
});
