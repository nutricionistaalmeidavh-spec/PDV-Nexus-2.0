import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createApp} from '../src/server.mjs';
import {roleAllows} from '../src/lan-security.mjs';
const command=(name,data={})=>({commandId:'sse-'+name,...data});
test('KDS recebe notificacao imediata do host apos confirmar comanda sem polling',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-sse-'));
 const app=createApp({dataPath:path.join(dir,'db.sqlite')});
 const origin=await app.listen({port:0});
 t.after(async()=>{await app.close();fs.rmSync(dir,{force:true,recursive:true});});
 let cookie='';
 const request=async(method,route,body)=>{
   const headers=body?{'content-type':'application/json'}:{};
   if(cookie)headers.cookie=cookie;
   const r=await fetch(origin+route,{method,headers,body:body?JSON.stringify(body):undefined});
   const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];
   return {status:r.status,body:await r.json()};
 };
 assert.equal((await request('POST','/api/auth/setup',{username:'admin',password:'senhaMuitoForte-2026'})).status,201);
 const product=(await request('POST','/api/products',command('product',{name:'Pizza',priceCents:4900}))).body.product;
 const controller=new AbortController();t.after(()=>controller.abort());
 const r=await fetch(origin+'/api/kitchen/events',{headers:{cookie},signal:controller.signal});
 assert.equal(r.status,200);
 assert.match(r.headers.get('content-type')??'',/text\/event-stream/);
 const reader=r.body.getReader();
 const initial=await reader.read();assert.equal(initial.done,false);
 const order=(await request('POST','/api/orders',command('order',{serviceMode:'counter'}))).body.order;
 await request('POST','/api/orders/'+order.id+'/lines',command('line',{productId:product.id,quantity:1,expectedRevision:0}));
 await request('POST','/api/orders/'+order.id+'/confirm',command('confirm',{expectedRevision:1}));
 let found=false;
 for(let attempt=0;attempt<5;attempt++){
   const next=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('SSE sem evento')),5000))]);
   if(new TextDecoder().decode(next.value).includes('event: changed')){found=true;break;}
 }
 assert.equal(found,true);
 controller.abort();
});
test('perfil de cozinha autorizado a ler feed, nao caixa',()=>{
 assert.equal(roleAllows('kitchen','GET','/api/kitchen/events'),true);
 assert.equal(roleAllows('waiter','GET','/api/kitchen/events'),false);
});
