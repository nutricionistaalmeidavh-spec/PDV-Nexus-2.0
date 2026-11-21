import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/db.mjs';
import {HttpError,requireCents,assertRevision,requireSupervisorForConfirmed} from '../src/request-validation.mjs';
import {transact} from '../src/command-service.mjs';
import {audit} from '../src/audit-service.mjs';

test('P1 validação compartilhada preserva erro HTTP e autorização por papel',()=>{
 assert.throws(()=>requireCents(1.2,'Preço'),error=>error instanceof HttpError&&error.status===400&&error.code==='INVALID_INPUT');
 assert.throws(()=>assertRevision({revision:3},2),error=>error instanceof HttpError&&error.status===409&&error.code==='REVISION_CONFLICT');
 assert.throws(()=>requireSupervisorForConfirmed({status:'OPEN'},'cashier','local'),error=>error instanceof HttpError&&error.status===403&&error.code==='SUPERVISOR_REQUIRED');
 assert.doesNotThrow(()=>requireSupervisorForConfirmed({status:'OPEN'},'admin','local'));
 assert.doesNotThrow(()=>requireSupervisorForConfirmed({status:'OPEN'},null,'manager'));
 assert.doesNotThrow(()=>requireSupervisorForConfirmed({status:'DRAFT'},'cashier','local'));
});

test('P1 command service executa uma vez, diferencia colisão e audita autoria persistida',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p1-modules-'));
 const db=openDatabase(path.join(dir,'local.db'));
 try{
  let calls=0;
  const body={commandId:'p1-atomic-001',value:37};
  const handle=()=>{
   calls++;
   audit(db,'entity-test','TEST_ACTION',{value:37},'operator-real-123');
   return {value:37};
  };
  const first=transact(db,'/api/test',body,handle,201);
  assert.deepEqual(first,{status:201,body:{value:37}});
  assert.deepEqual(transact(db,'/api/test',body,handle,201),first);
  assert.equal(calls,1);
  assert.throws(()=>transact(db,'/api/test',{...body,value:38},handle,201),e=>e.code==='IDEMPOTENCY_CONFLICT'&&e.status===409);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE aggregate_id='entity-test'").get().n,1);
  assert.equal(db.prepare("SELECT actor_id FROM audit_log WHERE aggregate_id='entity-test'").get().actor_id,'operator-real-123');
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('P1 arquitetura: handler HTTP não contém DML das linhas e delega ciclo ao serviço',()=>{
 const source=fs.readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.match(source,/orderWrite\(db,method,route,body,h\)/);
 assert.doesNotMatch(source,/INSERT INTO order_line\(/);
 assert.doesNotMatch(source,/const next=confirmOrder\(/);
 assert.doesNotMatch(source,/const next=cancelOrder\(/);
});
