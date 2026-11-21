import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCommercialLicense,verifyEntitlement} from '../src/commercial-license.mjs';

const identity='unit-license-test-01';
const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const publicJwk=pair.publicKey.export({format:'jwk'});
function issue({email='client@example.org',expiresAt=new Date(Date.now()+72*60*60*1000).toISOString(),kind='TRIAL'}={}){
  const payload={licenseId:'license-1',email,installationId:identity,product:'PDV_NEXUS_2',kind,issuedAt:new Date().toISOString(),expiresAt};
  return {payload,signature:sign('sha256',Buffer.from(JSON.stringify(payload)),{key:pair.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')};
}
function fixture(t,{now}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-license-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const db={prepare:()=>({get:()=>({unit_id:identity})})};
  const calls=[];
  const fakeFetch=async (url,opts)=>{
    const body=JSON.parse(opts.body);calls.push({url,body});
    if(url.endsWith('/v1/nexus/trial/request'))return Response.json({accepted:true},{status:202});
    if(url.endsWith('/v1/nexus/trial/confirm'))return Response.json({entitlement:issue(),delivery:{status:'sent'}},{status:201});
    if(url.endsWith('/v1/activation/verify'))return Response.json({entitlement:issue({kind:'COMMERCIAL',expiresAt:null})});
    if(url.endsWith('/v1/nexus/entitlement/refresh'))return Response.json({active:false});
    throw Error('Unexpected endpoint '+url);
  };
  const options={required:true,endpoint:'https://license.example',publicJwk,storagePath:path.join(dir,'receipt.json'),fetchImpl:fakeFetch,...(now?{now}:{})};
  return {db,options,calls};
}
test('MIT/self-hosted mode is free and does not require cloud keys',async()=>{
  const svc=createCommercialLicense({prepare:()=>({get:()=>({unit_id:identity})})});
  assert.deepEqual(await svc.status(),{required:false,active:true,kind:'OPEN_SOURCE'});
});
test('signed 72h trial is persisted; replay or different installation cannot forge it',async t=>{
  const {db,options,calls}=fixture(t);
  const svc=createCommercialLicense(db,options);
  assert.equal((await svc.status()).active,false);
  await svc.request('client@example.org');
  const confirmation=await svc.confirm('client@example.org','123456');
  assert.equal(confirmation.active,true);
  assert.equal(confirmation.kind,'TRIAL');
  assert.equal(calls[0].body.email,'client@example.org');
  assert.equal(calls[0].body.installationId,identity);
  const installed=JSON.parse(fs.readFileSync(options.storagePath,'utf8'));
  assert.equal(verifyEntitlement(installed.entitlement,identity,publicJwk),true);
  assert.equal(verifyEntitlement(installed.entitlement,'unit-other-987654',publicJwk),false);
  const forged=structuredClone(installed.entitlement);forged.payload.expiresAt=null;
  assert.equal(verifyEntitlement(forged,identity,publicJwk),false);
  const reopened=createCommercialLicense(db,options);
  assert.equal((await reopened.status(false)).active,true);
});
test('revoked online stays revoked offline; expiry never extends due to network failure',async t=>{
  let clock=Date.now();const {db,options}=fixture(t,{now:()=>clock});
  const svc=createCommercialLicense(db,options);
  await svc.confirm('client@example.org','123456');
  clock+=16*60*1000;
  assert.equal((await svc.status(true)).active,false);
  clock+=2*60*1000;
  assert.equal((await svc.status(false)).active,false);
});
test('local clock rollback refuses an otherwise signed trial',async t=>{
  let clock=Date.now();const {db,options}=fixture(t,{now:()=>clock});
  const svc=createCommercialLicense(db,options);
  await svc.confirm('client@example.org','123456');
  clock-=10*60*1000;
  assert.equal((await svc.status(false)).reason,'CLOCK_ROLLBACK');
});
test('commercial activation works without reinstall, but requires signed central response',async t=>{
  const {db,options}=fixture(t);
  const svc=createCommercialLicense(db,options);
  const r=await svc.activate('client@example.org','654321');
  assert.equal(r.active,true);
  assert.equal(r.expiresAt,null);
  assert.equal(r.kind,'COMMERCIAL');
});
