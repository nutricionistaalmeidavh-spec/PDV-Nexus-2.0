import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createApp} from '../src/server.mjs';
async function start(dbPath){
 const app=createApp({dataPath:dbPath}),origin=await app.listen({port:0});
 let cookie='';
 const request=async(method,route,body)=>{
  const headers=body?{'content-type':'application/json'}:{};if(cookie)headers.cookie=cookie;
  const r=await fetch(origin+route,{method,headers,body:body?JSON.stringify(body):undefined});
  const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
  return {status:r.status,body:await r.json()};
 };return {app,origin,request};
}
test('cada instalação tem identidade própria persistente, sem sincronização automática',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-site-'));
 const aFile=path.join(folder,'a.db'),bFile=path.join(folder,'b.db');
 t.after(()=>fs.rmSync(folder,{force:true,recursive:true}));
 const a=await start(aFile),b=await start(bFile);
 try{
  assert.equal((await a.request('GET','/api/system/identity')).status,401);
  await a.request('POST','/api/auth/setup',{username:'admin',password:'senhaMuitoForte-2026'});
  await b.request('POST','/api/auth/setup',{username:'admin',password:'senhaMuitoForte-2026'});
  const first=await a.request('GET','/api/system/identity');
  const second=await b.request('GET','/api/system/identity');
  assert.equal(first.status,200);assert.equal(second.status,200);
  assert.ok(first.body.unitId.startsWith('unit-'));
  assert.notEqual(first.body.unitId,second.body.unitId);
  assert.equal(first.body.syncEnabled,false);
  await a.app.close();
  const again=await start(aFile);
  try{
   await again.request('POST','/api/auth/login',{username:'admin',password:'senhaMuitoForte-2026'});
   assert.equal((await again.request('GET','/api/system/identity')).body.unitId,first.body.unitId);
  }finally{await again.app.close();}
 }finally{await a.app.close();await b.app.close();}
});
