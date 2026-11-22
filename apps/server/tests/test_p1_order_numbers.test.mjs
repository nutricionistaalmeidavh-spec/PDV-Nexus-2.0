import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createApp} from '../src/server.mjs';
import {receiptBytes} from '../src/non-fiscal-service.mjs';

test('P1: sequência de pedido única por instalação persiste após reinício do PDV',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p1-number-'));
 const db=path.join(dir,'db.sqlite');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let current=0;
 for(let restart=0;restart<2;restart++){
   const app=createApp({dataPath:db});
   const origin=await app.listen({port:0});
   let cookie='';
   const req=async(method,route,body)=>{
     const response=await fetch(origin+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
     const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
     return {status:response.status,body:await response.json()};
   };
   if(restart===0)assert.equal((await req('POST','/api/auth/setup',{username:'admin',password:'senhaForteNumero2026'})).status,201);
   else assert.equal((await req('POST','/api/auth/login',{username:'admin',password:'senhaForteNumero2026'})).status,200);
   for(let i=0;i<3;i++){
     const order=await req('POST','/api/orders',{commandId:'number-'+restart+'-'+i,serviceMode:'counter'});
     assert.equal(order.status,201);
     assert.equal(order.body.order.orderNumber,++current);
     const duplicate=await req('POST','/api/orders',{commandId:'number-'+restart+'-'+i,serviceMode:'counter'});
     assert.equal(duplicate.body.order.orderNumber,current);
   }
   await app.close();
 }
 assert.equal(current,6);
});

test('P1: comprovante não fiscal exibe número sequencial e não depende do UUID truncado',()=>{
 const bytes=receiptBytes({kind:'RECEIPT',id:'00000000-1234-5678-1234-567812345678',orderNumber:42,lines:[],totalCents:100});
 const text=bytes.toString('ascii');
 assert.match(text,/Pedido 000042/);
 assert.match(text,/NAO SUBSTITUI DOCUMENTO FISCAL/);
});
