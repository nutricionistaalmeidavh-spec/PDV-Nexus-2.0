import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createApp} from '../src/server.mjs';
const cmd=(id,x={})=>({commandId:'pii-'+id,...x});
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-privacy-'));
 const app=createApp({dataPath:path.join(dir,'db.sqlite'),publicMenuEnabled:true});
 const url=await app.listen({port:0}); let cookie='';
 async function api(method,route,body,guest=false){
  const headers=body?{'content-type':'application/json'}:{};if(cookie&&!guest)headers.cookie=cookie;
  const r=await fetch(url+route,{method,headers,body:body?JSON.stringify(body):undefined});
  const c=r.headers.get('set-cookie');if(c&&!guest)cookie=c.split(';')[0];
  return {status:r.status,body:await r.json()};
 }
 t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
 await api('POST','/api/auth/setup',{username:'admin',password:'senhaSupervisora-2026'});
 const prod=(await api('POST','/api/products',cmd('prod',{name:'Lanche',priceCents:1000}))).body.product;
 async function create(){return api('POST','/api/public/delivery/requests',{customerName:'Cliente Teste',phone:'16998765432',address:'Rua dos Exemplos 123',note:'Apartamento 12',items:[{productId:prod.id,quantity:1}]},true)}
 return {api,create,dbPath:path.join(dir,'db.sqlite'),productId:prod.id};
}
test('pedido pendente ou entrega não concluída não pode perder dados de contato',async t=>{
 const {api,create}=await fixture(t);
 const request=await create();assert.equal(request.status,202);
 const cleanup=await api('POST',`/api/delivery/requests/${request.body.requestId}/anonymize`,cmd('early'));
 assert.equal(cleanup.status,409);
 const accepted=await api('POST',`/api/delivery/requests/${request.body.requestId}/accept`,cmd('accept'));
 assert.equal(accepted.status,201);
 assert.equal((await api('POST',`/api/delivery/requests/${request.body.requestId}/anonymize`,cmd('early-again'))).status,409);
});
test('pedido rejeitado pode ter dados pessoais anonimizados sem perder totais, itens e auditoria',async t=>{
 const {api,create}=await fixture(t);
 const first=await create();
 const rejected=await api('POST',`/api/delivery/requests/${first.body.requestId}/reject`,cmd('reject',{reason:'Fora da região'}));
 assert.equal(rejected.status,200);
 const result=await api('POST',`/api/delivery/requests/${first.body.requestId}/anonymize`,cmd('clear'));
 assert.equal(result.status,200,JSON.stringify(result.body));
 const read=await api('GET',`/api/delivery/requests/${first.body.requestId}`);
 assert.equal(read.status,200);
 const serialized=JSON.stringify(read.body);
 assert.doesNotMatch(serialized,/16998765432|Rua dos Exemplos|Cliente Teste|Apartamento 12/);
 assert.equal(read.body.request.totalCents,1000);
 assert.equal(read.body.request.lines[0].productName,'Lanche');
 assert.equal((await api('POST',`/api/delivery/requests/${first.body.requestId}/anonymize`,cmd('again'))).status,200);
});
test('limpeza por prazo só remove dados de entregas concluídas/rejeitadas',async t=>{
 const {api,create}=await fixture(t);
 const r=await create();await api('POST',`/api/delivery/requests/${r.body.requestId}/reject`,cmd('reject-old',{reason:'Não atende'}));
 const newer=await create();assert.equal(newer.status,202);
 const result=await api('POST','/api/delivery/privacy/purge',cmd('purge',{olderThanDays:30}));
 assert.equal(result.status,200);
 assert.equal(result.body.anonymized,0);
 const report=await api('GET','/api/delivery/privacy/report');
 assert.equal(report.status,200);
 assert.equal(report.body.pending,1);
 assert.equal(report.body.rejected,1);
});

test('anonimização remove hash de dados pessoais e mantém chave UUID como tombstone antirreenvio',async t=>{
 const {api,dbPath,productId}=await fixture(t);
 const data={clientRequestId:'358e22e1-7534-44d1-953d-0593fbf91cc8',
  customerName:'Pessoa de Teste',phone:'16987654321',address:'Rua de Teste 123',note:'Apartamento 5',
  items:[{productId,quantity:1}]};
 const created=await api('POST','/api/public/delivery/requests',data,true);
 assert.equal(created.status,202,JSON.stringify(created.body));
 assert.equal((await api('POST','/api/delivery/requests/'+created.body.requestId+'/reject',cmd('reject-private',{reason:'Fora da área'}))).status,200);
 const {DatabaseSync}=await import('node:sqlite');
 const db=new DatabaseSync(dbPath);
 try{
  const before=db.prepare('SELECT request_fingerprint AS fingerprint FROM delivery_request WHERE id=?').get(created.body.requestId);
  assert.match(before.fingerprint,/^[a-f0-9]{64}$/);
  assert.equal((await api('POST','/api/delivery/requests/'+created.body.requestId+'/anonymize',cmd('anon-private'))).status,200);
  const after=db.prepare('SELECT client_request_id AS clientId,request_fingerprint AS fingerprint FROM delivery_request WHERE id=?').get(created.body.requestId);
  assert.equal(after.clientId,data.clientRequestId);
  assert.equal(after.fingerprint,null);
  assert.equal((await api('POST','/api/public/delivery/requests',data,true)).status,409);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM delivery_request').get().count,1);
 }finally{db.close();}
});
