import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/db.mjs';
import {operationalRead,createOperationalPoller} from '../src/operational-mirror.mjs';
import {liveSummaryRead,verifyLiveSummary} from '../src/summary-live.mjs';
import {businessIntelligenceRead} from '../src/management-intelligence.mjs';
import {roleAllows} from '../src/lan-security.mjs';

test('P2: espelho financeiro opcional usa HTTPS read-only sem replicar vendas',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p2-live-'));
 const remote=openDatabase(path.join(dir,'a.db')),central=openDatabase(path.join(dir,'b.db'));
 t.after(()=>{remote.close();central.close();fs.rmSync(dir,{force:true,recursive:true})});
 assert.equal(roleAllows('mirror','GET','/api/sync/summary/daily'),true);
 assert.equal(roleAllows('mirror','POST','/api/sync/import'),false);
 const operational=operationalRead(remote,'GET','/api/sync/operational/export',{});
 const financial=liveSummaryRead(remote,'GET','/api/sync/summary/daily');
 assert.equal(financial.status,200);
 assert.equal(verifyLiveSummary(financial.body).unitId,financial.body.unitId);
 assert.equal(central.prepare('SELECT COUNT(*) AS n FROM multiunit_peer_snapshot').get().n,0);
 const remoteId=financial.body.unitId;
 const seen=[];
 const transport=async url=>{
  seen.push(url);
  return {ok:true,status:200,json:async()=>url.endsWith('/api/sync/summary/daily')?financial.body:operational.body};
 };
 const poller=createOperationalPoller(central,{peers:[{url:'https://10.0.0.2',token:'a'.repeat(40)}],
  intervalMs:60000,summarySync:true,transport});
 const result=await poller.syncOnce();
 assert.equal(result.ok,1);
 assert.equal(result.failed,0);
 assert.equal(seen.length,2);
 assert.equal(poller.status().summarySyncEnabled,true);
 assert.equal(poller.liveSummaries()[0].unitId,remoteId);
 const consolidated=businessIntelligenceRead(central,'GET','/api/bi/consolidated',new URLSearchParams(),poller);
 assert.equal(consolidated.status,200);
 assert.equal(consolidated.body.units.length,2);
 assert.ok(consolidated.body.units.some(x=>x.unitId===remoteId&&x.source==='https-lan-read-only'));
 assert.equal(consolidated.body.operationalReplication,false);
 assert.equal(central.prepare('SELECT COUNT(*) AS n FROM sales_order').get().n,0);
 await poller.stop();
});

test('P2: hash ou forma de resumo manipulados são rejeitados e não entram no painel',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p2-digest-'));
 const db=openDatabase(path.join(dir,'a.db'));
 try{
  const payload=liveSummaryRead(db,'GET','/api/sync/summary/daily').body;
  assert.throws(()=>verifyLiveSummary({...payload,hash:'0'.repeat(64)}),/hash|Hash|alterad|inválid/);
  assert.throws(()=>verifyLiveSummary({...payload,daily:[{day:'2026-11-22',orderCount:-1}]}),/inválid|Inválid|forma/);
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('P2: sincronização de resumo financeiro é opt-in e desligada por padrão',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p2-optin-'));
 const a=openDatabase(path.join(dir,'a.db')),b=openDatabase(path.join(dir,'b.db'));
 t.after(()=>{a.close();b.close();fs.rmSync(dir,{recursive:true,force:true})});
 const packet=operationalRead(a,'GET','/api/sync/operational/export',{}).body;
 let calls=0;
 const poller=createOperationalPoller(b,{peers:[{url:'https://10.0.0.9',token:'x'.repeat(40)}],
  transport:async()=>{calls++;return {ok:true,status:200,json:async()=>packet}}});
 assert.equal((await poller.syncOnce()).ok,1);
 assert.equal(calls,1);
 assert.deepEqual(poller.liveSummaries(),[]);
 assert.equal(poller.status().summarySyncEnabled,false);
 await poller.stop();
});

test('P2: peer antigo sem resumo BI continua sincronizando o espelho operacional',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p2-fallback-'));
 const a=openDatabase(path.join(dir,'a.db')),b=openDatabase(path.join(dir,'b.db'));
 t.after(()=>{a.close();b.close();fs.rmSync(dir,{recursive:true,force:true})});
 const packet=operationalRead(a,'GET','/api/sync/operational/export',{}).body;
 const poller=createOperationalPoller(b,{peers:[{url:'https://10.0.0.9',token:'x'.repeat(40)}],
  summarySync:true,transport:async url=>url.endsWith('/api/sync/summary/daily')
   ?{ok:false,status:404}: {ok:true,status:200,json:async()=>packet}});
 const sync=await poller.syncOnce();
 assert.equal(sync.ok,1,'espelho não fica refém do BI opcional');
 assert.equal(sync.summaryFailed,1);
 assert.equal(b.prepare('SELECT COUNT(*) AS n FROM operational_mirror_peer').get().n,1);
 assert.deepEqual(poller.liveSummaries(),[]);
 assert.ok(poller.status().peers[0].lastSummaryError);
 await poller.stop();
});
