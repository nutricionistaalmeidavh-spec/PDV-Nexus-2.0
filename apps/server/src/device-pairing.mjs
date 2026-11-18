/** One-time 6-digit codes and durable per-device bearer tokens. TLS required for remote usage. */
import {randomUUID,randomInt,randomBytes,createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
const now=()=>Date.now();
const thirtyDays=30*24*60*60*1000;
const maxPinTtl=2*60*1000;
const tokenPattern=/^[a-zA-Z0-9_-]{43}$/;
export function lookupPairedRole(db,token){
 if(typeof token!=='string'||!tokenPattern.test(token))return null;
 const row=db.prepare('SELECT role FROM paired_device WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').get(sha(token),new Date().toISOString());
 return row?.role??null;
}
export function createDevicePairing(db){
 const waiting=new Map(),tries=new Map();
 function start({role,label='Dispositivo'}={}){
   if(!['waiter','kitchen'].includes(role))throw new Error('Perfil de pareamento invalido');
   if(typeof label!=='string'||!label.trim()||label.length>80)throw new Error('Nome do dispositivo invalido');
   for(const [key,value] of waiting)if(value.until<now())waiting.delete(key);
   if(waiting.size>=10)throw new Error('Limite de pareamentos ativos. Tente novamente');
   let code;do{code=String(randomInt(0,1_000_000)).padStart(6,'0')}while(waiting.has(code));
   const expiresAt=new Date(now()+maxPinTtl).toISOString();
   waiting.set(code,{role,label:label.trim(),until:Date.parse(expiresAt)});
   return {code,expiresAt,role};
 }
 function redeem({code}={},ip='unknown'){
   const key=String(ip),t=now(),attempt=tries.get(key);
   if(attempt?.blockedUntil>t)return {status:429,body:{code:'PAIRING_RATE_LIMIT',message:'Muitas tentativas de PIN. Aguarde alguns minutos'}};
   if(typeof code!=='string'||!/^\d{6}$/.test(code)||!waiting.has(code)||waiting.get(code).until<t){
     const count=attempt?.resetAt>t?attempt.count+1:1;
     tries.set(key,{count,resetAt:t+3*60*1000,blockedUntil:count>=6?t+3*60*1000:0});
     return {status:401,body:{code:'PIN_INVALID',message:'Código inválido ou expirado'}};
   }
   const entry=waiting.get(code);waiting.delete(code);tries.delete(key);
   const token=randomBytes(32).toString('base64url'),id=randomUUID(),createdAt=new Date().toISOString(),expiresAt=new Date(t+thirtyDays).toISOString();
   db.prepare('INSERT INTO paired_device(id,label,role,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)')
     .run(id,entry.label,entry.role,sha(token),createdAt,expiresAt);
   return {status:200,body:{deviceId:id,token,role:entry.role,expiresAt}};
 }
 function revoke(deviceId){
   if(typeof deviceId!=='string'||!deviceId.trim())throw new Error('Dispositivo invalido');
   const r=db.prepare('UPDATE paired_device SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(new Date().toISOString(),deviceId);
   return r.changes>0;
 }
 function list(){
   return db.prepare("SELECT id,label,role,created_at AS createdAt,expires_at AS expiresAt,revoked_at AS revokedAt FROM paired_device ORDER BY created_at DESC LIMIT 100").all();
 }
 return {start,redeem,revoke,list};
}
