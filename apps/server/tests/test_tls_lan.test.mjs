import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import {execFileSync} from 'node:child_process';
import {createApp} from '../src/server.mjs';
import {roleAllows} from '../src/lan-security.mjs';

const token='a'.repeat(64), kitchenToken='b'.repeat(64), mirrorToken='c'.repeat(64);
function lanIp(){
  return Object.values(os.networkInterfaces()).flat().find(x=>x?.family==='IPv4'&&!x.internal&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.address))?.address;
}
function request(ip,port,route,auth){
  return new Promise((resolve,reject)=>{
    const headers={host:`${ip}:${port}`};if(auth)headers.authorization=`Bearer ${auth}`;
    const req=https.request({hostname:ip,port,path:route,method:'GET',headers,rejectUnauthorized:false,timeout:3500},res=>{
      let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>{
        try{resolve({status:res.statusCode,body:JSON.parse(data)});}catch(e){reject(e);}
      });
    });
    req.once('error',reject);req.once('timeout',()=>req.destroy(new Error('TLS sem resposta')));req.end();
  });
}
test('HTTPS LAN exige credencial e restringe garçom/cozinha no host real',async t=>{
  if(process.platform==='win32')return t.skip('Validação TLS com OpenSSL executada no runner Linux');
  const ip=lanIp();if(!ip)return t.skip('Ambiente de teste sem endereço IPv4 privado');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-tls-'));
  const cert=path.join(folder,'test.crt'),key=path.join(folder,'test.key');
  let app;
  try{
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-subj','/CN=localhost','-days','1'],{stdio:'ignore'});
    app=createApp({dataPath:path.join(folder,'db.sqlite'),lan:{certPath:cert,keyPath:key,tokens:{waiter:token,kitchen:kitchenToken,mirror:mirrorToken}}});
    const origin=await app.listen({host:'0.0.0.0',port:0});
    const port=Number(new URL(origin).port);
    assert.equal((await request(ip,port,'/api/tables')).status,401);
    assert.equal((await request(ip,port,'/api/tables',kitchenToken)).status,403);
    assert.equal((await request(ip,port,'/api/tables',token)).status,200);
    assert.equal((await request(ip,port,'/api/kitchen/tickets',kitchenToken)).status,200);
    assert.equal((await request(ip,port,'/api/cash/current',token)).status,403);
    assert.equal((await request(ip,port,'/api/tables','x'.repeat(64))).status,401);
    assert.equal((await request(ip,port,'/api/sync/operational/export',mirrorToken)).status,200);
    assert.equal((await request(ip,port,'/api/orders',mirrorToken)).status,403);
    assert.equal((await request(ip,port,'/api/sync/operational/peers',mirrorToken)).status,403);
  } finally {
    if(app)await app.close();fs.rmSync(folder,{recursive:true,force:true});
  }
});

test('papel LAN mirror é estritamente somente leitura do export de sua unidade',()=>{
 assert.equal(roleAllows('mirror','GET','/api/sync/operational/export'),true);
 for(const [method,route] of [['GET','/api/orders'],['GET','/api/sync/operational/peers'],
   ['POST','/api/sync/operational/import'],['POST','/api/orders'],['GET','/api/exports/sales.json']]){
  assert.equal(roleAllows('mirror',method,route),false,method+' '+route);
 }
});
