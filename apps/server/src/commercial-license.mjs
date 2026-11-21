/** Commercial distribution only. MIT/core self-hosted remains unrestricted. */
import fs from 'node:fs';
import { createPublicKey, verify as verifySignature } from 'node:crypto';

const PRODUCT='PDV_NEXUS_2',CHECK_MS=15*60*1000,ROLLBACK_MS=5*60*1000;
const validEmail=s=>typeof s==='string'&&s.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const validCode=s=>typeof s==='string'&&/^\d{6}$/.test(s);
const instant=()=>Date.now();
const issued=x=>Number.isFinite(Date.parse(x))?Date.parse(x):NaN;
export function verifyEntitlement(entitlement,installationId,publicJwk){
  if(!entitlement||!entitlement.payload||!publicJwk)return false;
  const p=entitlement.payload;
  if(p.product!==PRODUCT||p.installationId!==installationId||!validEmail(p.email)||
     typeof p.licenseId!=='string'||p.licenseId.length>128||
     !Number.isFinite(issued(p.issuedAt))||
     !(p.expiresAt===null||Number.isFinite(issued(p.expiresAt)))||
     typeof entitlement.signature!=='string')return false;
  try{
    return verifySignature('sha256',Buffer.from(JSON.stringify(p)),{key:createPublicKey({key:publicJwk,format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(entitlement.signature,'base64url'));
  }catch{return false}
}
export function createCommercialLicense(db,{required=false,endpoint='https://pdv-artisys.sistema-artisys.workers.dev',publicJwk=null,
  storagePath,fetchImpl=fetch,now=instant}={}){
  const installationId=db.prepare("SELECT unit_id FROM installation_identity WHERE id='local'").get()?.unit_id;
  if(!installationId)throw Error('Identidade persistente nao encontrada');
  if(!required)return {required:false,installationId,status:async()=>({required:false,active:true,kind:'OPEN_SOURCE'}),request:async()=>{throw Error('Edicao livre')},confirm:async()=>{throw Error('Edicao livre')},activate:async()=>{throw Error('Edicao livre')}};
  if(!storagePath||!publicJwk)throw Error('Edicao comercial exige publicJwk e storagePath explicitos');
  const base=new URL(endpoint);
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error('Central requer URL HTTPS explicita');
  const key=typeof publicJwk==='string'?JSON.parse(publicJwk):publicJwk;
  let state={entitlement:null,revoked:false,lastSeen:0,checkedAt:0};
  try{
    const raw=JSON.parse(fs.readFileSync(storagePath,'utf8'));
    if(raw?.entitlement&&verifyEntitlement(raw.entitlement,installationId,key))
      state={entitlement:raw.entitlement,revoked:raw.revoked===true,lastSeen:Number(raw.lastSeen)||0,checkedAt:0};
  }catch{}
  function persist(){
    const tmp=storagePath+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(state),{mode:0o600});
    fs.renameSync(tmp,storagePath);
  }
  async function post(route,body){
    const url=new URL(route,base);
    const rsp=await fetchImpl(url.toString(),{method:'POST',redirect:'error',headers:{'content-type':'application/json'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(9000)});
    const data=await rsp.json().catch(()=>({error:'Resposta invalida da Central'}));
    if(!rsp.ok)throw Object.assign(new Error(data.error||'Central de licencas indisponivel'),{status:rsp.status});
    return data;
  }
  async function install(entitlement){
    if(!verifyEntitlement(entitlement,installationId,key))throw Error('Assinatura ou instalacao de licenca invalida');
    const t=now();
    if(issued(entitlement.payload.issuedAt)>t+ROLLBACK_MS||
       (entitlement.payload.expiresAt&&issued(entitlement.payload.expiresAt)<=t))
       throw Error('Licenca recebida fora da validade');
    state={entitlement,revoked:false,lastSeen:t,checkedAt:t};persist();
    return await status(false);
  }
  let inFlight=null;
  async function refresh(){
    if(!state.entitlement)return;
    if(inFlight)return inFlight;
    inFlight=(async()=>{
      try{
        const result=await post('/v1/nexus/entitlement/refresh',{entitlement:state.entitlement});
        if(result.active===false){state.revoked=true;state.checkedAt=now();persist();return}
        if(result.active===true&&verifyEntitlement(result.entitlement,installationId,key)){
          state.entitlement=result.entitlement;state.revoked=false;state.checkedAt=now();state.lastSeen=Math.max(state.lastSeen,now());persist();
        }
      }catch{
        state.checkedAt=now(); // no indefinite fallback: offline ends at signed expiry
      }
    })();
    try{await inFlight}finally{inFlight=null}
  }
  async function status(checkOnline=true){
    const t=now();
    if(state.lastSeen&&t+ROLLBACK_MS<state.lastSeen)return {required:true,active:false,reason:'CLOCK_ROLLBACK'};
    const p=state.entitlement?.payload;
    const refreshInterval=p?.expiresAt&&issued(p.expiresAt)<=t?60_000:CHECK_MS;
    if(checkOnline&&p&&t-state.checkedAt>refreshInterval)await refresh();
    const current=state.entitlement?.payload;
    const active=!!current&&!state.revoked&&(!current.expiresAt||issued(current.expiresAt)>now())&&verifyEntitlement(state.entitlement,installationId,key);
    if(t>state.lastSeen+60000){state.lastSeen=t;persist()}
    return {required:true,active,product:PRODUCT,kind:current?.kind||'COMMERCIAL',email:current?.email||null,
      expiresAt:current?.expiresAt||null,reason:active?'ACTIVE':state.revoked?'SUSPENDED':current?.expiresAt&&issued(current.expiresAt)<=t?'EXPIRED':'NOT_LICENSED'};
  }
  return {
    required,installationId,status,
    async request(email){
      if(!validEmail(email))throw Error('E-mail invalido');
      return post('/v1/nexus/trial/request',{email:email.trim().toLowerCase(),installationId});
    },
    async confirm(email,code){
      if(!validEmail(email)||!validCode(code))throw Error('E-mail ou codigo invalido');
      const result=await post('/v1/nexus/trial/confirm',{email:email.trim().toLowerCase(),installationId,code});
      return {...await install(result.entitlement),delivery:result.delivery};
    },
    async activate(email,code){
      if(!validEmail(email)||!validCode(code))throw Error('E-mail ou codigo invalido');
      const result=await post('/v1/activation/verify',{email:email.trim().toLowerCase(),installationId,code,product:PRODUCT});
      return install(result.entitlement);
    }
  };
}
