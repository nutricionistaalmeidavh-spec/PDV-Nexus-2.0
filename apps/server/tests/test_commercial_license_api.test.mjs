import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createApp} from '../src/server.mjs';
test('commercial edition: only verified license unlocks writes and expiry preserves reads',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-license-api-'));
  let app;
  t.after(async()=>{try{if(app)await app.close()}finally{fs.rmSync(dir,{recursive:true,force:true})}});
  const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const publicJwk=keys.publicKey.export({format:'jwk'});
  const baseline=Date.now();let clock=baseline;
  let trialIdentity=null;
  const fetchImpl=async (url,init)=>{
    const body=JSON.parse(init.body);
    if(url.endsWith('/v1/nexus/trial/request')){trialIdentity=body.installationId;return Response.json({accepted:true},{status:202})}
    if(url.endsWith('/v1/nexus/trial/confirm')){
      const payload={licenseId:'license-201',email:body.email,installationId:body.installationId,product:'PDV_NEXUS_2',kind:'TRIAL',
        issuedAt:new Date(baseline).toISOString(),expiresAt:new Date(baseline+60_000).toISOString()};
      const signature=sign('sha256',Buffer.from(JSON.stringify(payload)),{key:keys.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
      return Response.json({entitlement:{payload,signature},delivery:{status:'sent'}},{status:201});
    }
    if(url.endsWith('/v1/nexus/entitlement/refresh'))return Response.json({active:false});
    throw Error('Unexpected central route');
  };
  app=createApp({dataPath:path.join(dir,'nexus.db'),publicMenuEnabled:true,commercialLicense:{
    required:true,publicJwk,storagePath:path.join(dir,'licence.json'),fetchImpl,now:()=>clock,endpoint:'https://license.example'
  }});
  await app.listen({port:0});
  const publicOrigin=await app.startPublicPortal({port:0});
  let cookie='';
  const req=async (method,route,body)=>{
    const r=await fetch(app.origin+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},
      body:body?JSON.stringify(body):undefined});
    if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
    return {status:r.status,data:await r.json().catch(()=>({}))};
  };
  assert.equal((await req('GET','/api/license/status')).data.active,false);
  assert.equal((await req('POST','/api/products',{name:'Test'})).status,402);
  assert.equal((await req('POST','/api/license/trial/request',{email:'admin@example.org'})).status,202);
  assert.ok(trialIdentity?.startsWith('unit-'));
  assert.equal((await req('POST','/api/license/trial/confirm',{email:'admin@example.org',code:'123456'})).status,200);
  assert.equal((await req('GET','/api/license/status')).data.kind,'TRIAL');
  assert.equal((await req('POST','/api/auth/setup',{username:'admin',password:'senhaSegura-2026'})).status,201);
  assert.equal((await req('GET','/api/system/identity')).status,200);
  clock=baseline+120_000;
  assert.equal((await req('GET','/api/license/status')).data.reason,'SUSPENDED');
  assert.equal((await req('POST','/api/orders',{commandId:'trial-expired-01',serviceMode:'counter'})).status,402);
  const publicDelivery=await fetch(publicOrigin+'/api/public/delivery/requests',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({name:'Cliente sem autorização comercial'})
  });
  assert.equal(publicDelivery.status,402,'public portal must also block writes when the commercial entitlement expires');
  assert.equal((await req('GET','/api/system/identity')).status,200);
});
