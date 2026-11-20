import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createApp} from '../src/server.mjs';

const cmd=(id,data={})=>({commandId:'hw-'+id,...data});
async function fixture(t){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-escpos-'));
 const file=path.join(folder,'nexus.sqlite'),app=createApp({dataPath:file});
 const origin=await app.listen({port:0});
 let cookie='';
 async function api(method,route,body){
  const headers=body?{'content-type':'application/json'}:{};if(cookie)headers.cookie=cookie;
  const res=await fetch(origin+route,{method,headers,body:body?JSON.stringify(body):undefined});
  const setCookie=res.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
  return {status:res.status,body:await res.json()};
 }
 t.after(async()=>{await app.close();fs.rmSync(folder,{force:true,recursive:true});});
 const auth=await api('POST','/api/auth/setup',{username:'admin',password:'senhaSupervisora-2026'});
 assert.equal(auth.status,201);
 return {app,api,folder,file};
}
async function closeSale(api,name){
 const key=name.replace(/[^a-zA-Z0-9_-]+/g,'-');
 const prod=(await api('POST','/api/products',cmd('product-'+key,{name,priceCents:1450}))).body.product;
 assert.equal((await api('POST','/api/cash/open',cmd('cash',{openingCents:5000}))).status,201);
 const order=(await api('POST','/api/orders',cmd('order-'+key,{serviceMode:'counter'}))).body.order;
 assert.equal((await api('POST','/api/orders/'+order.id+'/lines',cmd('line-'+key,{productId:prod.id,quantity:2,expectedRevision:0}))).status,200);
 assert.equal((await api('POST','/api/orders/'+order.id+'/confirm',cmd('confirm-'+key,{expectedRevision:1}))).status,200);
 assert.equal((await api('POST','/api/orders/'+order.id+'/close',cmd('close-'+key,{expectedRevision:2,payments:[{method:'cash',amountCents:2900,tenderedCents:3000}]}))).status,200);
 return order.id;
}
async function tcpPrinter(t){
 const chunks=[],sockets=new Set();
 const printer=net.createServer(socket=>{
  sockets.add(socket);
  socket.once('close',()=>sockets.delete(socket));
  socket.on('data',part=>chunks.push(part));
  socket.on('end',()=>socket.destroy());
 });
 await new Promise(resolve=>printer.listen(0,'127.0.0.1',resolve));
 t.after(()=>{
  for(const socket of sockets)socket.destroy();
  printer.close();
 });
 return {port:printer.address().port,received:()=>Buffer.concat(chunks)};
}
test('simulador TCP recebe bytes ESC/POS não fiscais e reenvio não duplica trabalho impresso',async t=>{
 const {api}=await fixture(t);
 const orderId=await closeSale(api,'Hamburguer QA');
 const printer=await tcpPrinter(t);
 assert.equal((await api('POST','/api/printer',cmd('printer',{host:'127.0.0.1',port:printer.port}))).status,200);
 const jobs=(await api('GET','/api/print/jobs')).body.jobs;
 assert.equal(jobs.length,1);
 assert.equal(jobs[0].status,'PENDING');
 const send=await api('POST','/api/print/jobs/'+jobs[0].id+'/send',cmd('send'));
 assert.equal(send.status,200,JSON.stringify(send.body));
 assert.equal(send.body.status,'DONE');
 const bytes=printer.received();
 assert.deepEqual([...bytes.subarray(0,2)],[0x1b,0x40]);
 assert.deepEqual([...bytes.subarray(-3)],[0x1d,0x56,0x01]);
 assert.match(bytes.toString('ascii'),/NAO FISCAL/);
 assert.match(bytes.toString('ascii'),/TOTAL R\$ 29\.00/);
 assert.match(bytes.toString('ascii'),new RegExp(orderId.slice(0,8)));
 assert.equal((await api('POST','/api/print/jobs/'+jobs[0].id+'/send',cmd('send-again'))).status,409);
 assert.equal((await api('GET','/api/print/jobs')).body.jobs[0].status,'DONE');
});
test('backup consistente restaura pedidos, histórico de pagamento e fila da impressão',async t=>{
 const {api,app,folder}=await fixture(t);
 const orderId=await closeSale(api,'Backup QA');
 const target=path.join(folder,'restored.sqlite');
 await app.backup(target);
 assert.ok(fs.statSync(target).size>0);
 let restored;
 try{
   restored=createApp({dataPath:target});
   const restoredOrigin=await restored.listen({port:0});
   const noSession=await fetch(restoredOrigin+'/api/orders');
   assert.equal(noSession.status,401);
   const login=await fetch(restoredOrigin+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'senhaSupervisora-2026'})});
   assert.equal(login.status,200);
   const cookie=login.headers.get('set-cookie').split(';')[0];
   const req=async route=>{const r=await fetch(restoredOrigin+route,{headers:{cookie}});return {status:r.status,body:await r.json()};};
   const orders=await req('/api/orders');
   assert.equal(orders.status,200);
   assert.ok(orders.body.orders.some(o=>o.id===orderId&&o.status==='CLOSED'));
   assert.equal((await req('/api/print/jobs')).body.jobs.length,1);
   const saved=await req('/api/orders/'+orderId);
   assert.equal(saved.body.order.payments[0].state,'CONFIRMED');
   assert.equal(saved.body.order.totalCents,2900);
 }finally{
   // Windows keeps an open SQLite file locked. Close the restored host BEFORE
   // the primary fixture's t.after hook removes the test directory.
   if(restored)await restored.close();
 }
});
