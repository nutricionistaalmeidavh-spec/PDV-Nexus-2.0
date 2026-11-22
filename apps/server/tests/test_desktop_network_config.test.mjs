import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {loadDesktopNetworkConfig}=require('../../desktop/network-config.cjs');
test('P0: instalador sem configuração continua só no loopback e sem QR público',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p0-desktop-lan-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 assert.deepEqual(loadDesktopNetworkConfig(dir),{lan:null,host:'127.0.0.1',port:0,publicMenuEnabled:false,operationalSync:null});
});
test('P0: configuração local explícita habilita LAN TLS e peers sem cloud',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p0-desktop-lan-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const cert=path.join(dir,'lan-cert.pem'),key=path.join(dir,'lan-key.pem');
 fs.writeFileSync(cert,'certificado de teste');fs.writeFileSync(key,'chave de teste');
 fs.writeFileSync(path.join(dir,'network-config.json'),JSON.stringify({
  lan:{enabled:true,certPath:cert,keyPath:key,tokens:{waiter:'w'.repeat(32),kitchen:'k'.repeat(32)}},
  port:3555,operationalSync:{peers:[],intervalMs:60000}
 }));
 const result=loadDesktopNetworkConfig(dir);
 assert.equal(result.host,'0.0.0.0');
 assert.equal(result.port,3555);
 assert.equal(result.lan.certPath,cert);
 assert.equal(result.lan.tokens.waiter.length,32);
 assert.deepEqual(result.operationalSync,{peers:[],intervalMs:60000});
 assert.equal(result.publicMenuEnabled,false);
});
test('P0: rejeitar configuração LAN sem TLS/chaves antes de iniciar o host',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p0-desktop-lan-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'network-config.json'),JSON.stringify({lan:{enabled:true},port:3434}));
 assert.throws(()=>loadDesktopNetworkConfig(dir),/TLS|certificado|chave/);
});
