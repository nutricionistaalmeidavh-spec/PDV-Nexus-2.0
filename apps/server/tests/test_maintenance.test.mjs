import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../src/server.mjs';
import {inspectBackup,restoreBackup} from '../src/restore.mjs';
import {compareVersions,normalizeRelease} from '../src/system-maintenance.mjs';
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-maint-')),dataPath=path.join(dir,'nexus.db');
 const app=createApp({dataPath}),origin=await app.listen({port:0});
 let cookie='';
 async function api(method,route,body){
  const headers=body?{'content-type':'application/json'}:{};if(cookie)headers.cookie=cookie;
  const response=await fetch(origin+route,{method,headers,body:body?JSON.stringify(body):undefined});
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  return {status:response.status,body:await response.json()};
 }
 t.after(async()=>{await app.close();fs.rmSync(dir,{force:true,recursive:true});});
 assert.equal((await api('POST','/api/auth/setup',{username:'supervisor',password:'Senha-Caixa-Segura-2026'})).status,201);
 return {api,app,dir,dataPath};
}
test('configuração inicial é persistente e idempotente',async t=>{
 const {api,app,dataPath}=await fixture(t);
 const body={commandId:'config-initial-1',displayName:'Lanchonete Avenida',terminalLabel:'Caixa Dois'};
 assert.equal((await api('POST','/api/system/config',body)).status,200);
 assert.equal((await api('POST','/api/system/config',body)).status,200);
 const config=(await api('GET','/api/system/config')).body;
 assert.equal(config.restaurant.displayName,'Lanchonete Avenida');
 assert.equal(config.terminal.label,'Caixa Dois');
 assert.equal((await api('POST','/api/system/config',{...body,displayName:'Outro'})).status,409);
 assert.equal((await api('GET','/api/system/version')).body.offline,true);
});
test('backup sob demanda é validado e restauração offline mantém os dados',async t=>{
 const {api,dir}=await fixture(t);
 const body={commandId:'manual-safeguard-123'};
 await api('POST','/api/system/config',{commandId:'name-setup-123',displayName:'Nexus Exemplo',terminalLabel:'Principal'});
 const created=await api('POST','/api/system/backup',body);
 assert.equal(created.status,201,JSON.stringify(created.body));
 assert.ok(fs.existsSync(created.body.path));
 assert.equal((await api('POST','/api/system/backup',body)).body.created,false);
 const same={commandId:'concurrent-backup-safe'};
 const parallel=await Promise.all([api('POST','/api/system/backup',same),api('POST','/api/system/backup',same)]);
 assert.deepEqual(parallel.map(r=>r.status).sort(),[200,201]);
 assert.equal(parallel.filter(r=>r.body.created).length,1);
 assert.equal(parallel[0].body.filename,parallel[1].body.filename);
 const report=inspectBackup(created.body.path);
 assert.equal(report.compatible,true);
 assert.equal(report.schemaVersion,22);
 assert.ok((await api('GET','/api/system/backups')).body.backups.some(x=>x.name===created.body.filename));
 const destination=path.join(dir,'restored.db');
 restoreBackup(created.body.path,destination);
 const reopened=createApp({dataPath:destination});
 try{
   assert.ok(fs.existsSync(destination));
   const snapshot=await reopened.listen({port:0});
   const auth=await fetch(snapshot+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'supervisor',password:'Senha-Caixa-Segura-2026'})});
   assert.equal(auth.status,200);
   const cookie=auth.headers.get('set-cookie').split(';')[0];
   const result=await fetch(snapshot+'/api/system/config',{headers:{cookie}});
   assert.equal((await result.json()).restaurant.displayName,'Nexus Exemplo');
 }finally{await reopened.close();}
});
test('schema antigo gera snapshot validado antes da migração para v19',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-old-')),dbPath=path.join(dir,'old.db');
 t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
 const db=new DatabaseSync(dbPath);
 try{
  db.exec('PRAGMA foreign_keys=ON');
  const migDir=new URL('../migrations/',import.meta.url);
  const files=fs.readdirSync(migDir).filter(n=>/^\d{3}_.*\.sql$/.test(n)).sort().slice(0,17);
  assert.equal(files.length,17);
  for(const file of files)db.exec(fs.readFileSync(new URL(file,migDir),'utf8'));
  db.prepare("INSERT INTO restaurant(id,display_name,created_at) VALUES('r-local','Antiga Loja','2026-01-01')").run();
  db.prepare("INSERT INTO terminal(id,restaurant_id,label) VALUES('t-local','r-local','Caixa 1')").run();
  db.prepare("INSERT INTO menu_category(id,restaurant_id,name) VALUES('c-default','r-local','Cardápio')").run();
 }finally{db.close();}
 const app=createApp({dataPath:dbPath});
 try{
  const dirBackup=path.join(dir,'backups');
  const files=fs.readdirSync(dirBackup).filter(n=>n.startsWith('before-v22-from-v17-'));
  assert.equal(files.length,1);
  assert.equal(inspectBackup(path.join(dirBackup,files[0])).schemaVersion,17);
 }finally{await app.close();}
});
test('versões oficiais são comparadas sem instalação ou redirecionamento automático',()=>{
 assert.equal(compareVersions('1.2.3','1.2.2'),1);
 assert.equal(compareVersions('1.2.3','1.2.3'),0);
 assert.equal(compareVersions('1.1.3','1.2.0'),-1);
 const valid=normalizeRelease({tag_name:'v9.0.0',html_url:'https://github.com/nutricionistaalmeidavh-spec/PDV-Nexus-2.0/releases/tag/v9.0.0'});
 assert.equal(valid.updateAvailable,true);
 assert.throws(()=>normalizeRelease({tag_name:'v9.0.0',html_url:'https://example.com/bad'}),/oficial/);
});
