import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createApp} from '../src/server.mjs';
import {openDatabase} from '../src/db.mjs';
import {lookupPairedRole} from '../src/device-pairing.mjs';
test('PIN de 6 dígitos vincula dispositivo só uma vez, token persiste no SQLite e pode ser revogado',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-pair-')),file=path.join(directory,'db.sqlite');
 const app=createApp({dataPath:file}),origin=await app.listen({port:0});
 let cookie='';
 const request=async(method,url,body,asManager=true)=>{
   const headers=body?{'content-type':'application/json'}:{};
   if(asManager&&cookie)headers.cookie=cookie;
   const r=await fetch(origin+url,{method,headers,body:body?JSON.stringify(body):undefined});
   if(asManager){const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];}
   return {status:r.status,body:await r.json()};
 };
 t.after(async()=>{await app.close();fs.rmSync(directory,{recursive:true,force:true});});
 assert.equal((await request('POST','/api/auth/setup',{username:'admin',password:'senhaMuitoForte-2026'})).status,201);
 const started=await request('POST','/api/pairing/start',{role:'waiter',label:'Celular garçon'});
 assert.equal(started.status,201,JSON.stringify(started.body));
 assert.match(started.body.code,/^\d{6}$/);
 assert.equal((await request('POST','/api/pairing/redeem',{code:'000000'},false)).status,401);
 const redeem=await request('POST','/api/pairing/redeem',{code:started.body.code},false);
 assert.equal(redeem.status,200,JSON.stringify(redeem.body));
 assert.equal(redeem.body.role,'waiter');
 assert.ok(redeem.body.token.length>=43);
 assert.equal((await request('POST','/api/pairing/redeem',{code:started.body.code},false)).status,401);
 const db=openDatabase(file);
 assert.equal(lookupPairedRole(db,redeem.body.token),'waiter');
 db.close();
 const revoke=await request('POST','/api/pairing/revoke',{deviceId:redeem.body.deviceId});
 assert.equal(revoke.status,200,JSON.stringify(revoke.body));
 const after=openDatabase(file);assert.equal(lookupPairedRole(after,redeem.body.token),null);after.close();
});

test('sem supervisor não gera PIN e não permite token de gerente no pareamento',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-pair-sec-'));const app=createApp({dataPath:path.join(folder,'db.sqlite')});const origin=await app.listen({port:0});
 t.after(async()=>{await app.close();fs.rmSync(folder,{recursive:true,force:true});});
 const request=async (route,body)=>{const r=await fetch(origin+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return r.status;};
 assert.equal(await request('/api/pairing/start',{role:'waiter'}),401);
 assert.equal(await request('/api/pairing/redeem',{code:'123456'}),401);
});

test('QR offline do estabelecimento contém URL HTTPS privada, sem colocar PIN no QR',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-qr-'));const app=createApp({dataPath:path.join(folder,'qr.sqlite')});const origin=await app.listen({port:0});
 t.after(async()=>{await app.close();fs.rmSync(folder,{recursive:true,force:true});});
 const login=await fetch(origin+'/api/auth/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'senhaMuitoForte-2026'})});
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const url=encodeURIComponent('https://192.168.1.10:3434/restaurant.html');
 const qr=await fetch(origin+'/api/pairing/qr.svg?url='+url,{headers:{cookie}});
 assert.equal(qr.status,200);assert.match(qr.headers.get('content-type')??'',/image\/svg\+xml/);
 const text=await qr.text();assert.match(text,/<svg/);assert.ok(text.length>300);
 assert.equal((await fetch(origin+'/api/pairing/qr.svg?url='+encodeURIComponent('http://192.168.1.10:3434/restaurant.html'),{headers:{cookie}})).status,400);
 assert.equal((await fetch(origin+'/api/pairing/qr.svg?url='+encodeURIComponent('https://malicious.example/restaurant.html'),{headers:{cookie}})).status,400);
});
