/** One atomic/idempotent command per commandId across the self-hosted SQLite. */
import {createHash} from 'node:crypto';
import {requireString,bad,conflict} from './request-validation.mjs';
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const digest=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
export function transact(db,route,body,handler,status=200){
 const commandId=requireString(body.commandId,'Identificador do comando',128);
 if(!/^[a-zA-Z0-9_-]{3,128}$/.test(commandId))bad('Identificador do comando inválido');
 const hash=digest({route,body});
 db.exec('BEGIN IMMEDIATE');
 try{
  const previous=db.prepare('SELECT request_hash,response_json FROM command_receipt WHERE command_id=?').get(commandId);
  if(previous){
   if(previous.request_hash!==hash)conflict('Identificador reutilizado com dados diferentes','IDEMPOTENCY_CONFLICT');
   const result=JSON.parse(previous.response_json);db.exec('COMMIT');return result;
  }
  const data=handler(),response={status,body:data};
  db.prepare('INSERT INTO command_receipt(command_id,request_hash,response_json,created_at) VALUES(?,?,?,?)')
   .run(commandId,hash,JSON.stringify(response),new Date().toISOString());
  db.exec('COMMIT');return response;
 }catch(e){db.exec('ROLLBACK');throw e;}
}
