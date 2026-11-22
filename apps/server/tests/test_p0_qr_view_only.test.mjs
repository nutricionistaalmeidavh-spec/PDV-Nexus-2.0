import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.mjs';

test('P0: cardápio QR é de consulta, não abre canal público de pedidos vinculados a mesas',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-qr-view-only-'));
 const app=createApp({dataPath:path.join(dir,'nexus.db'),publicMenuEnabled:true});
 const local=await app.listen({port:0}),portal=await app.startPublicPortal({port:0});
 t.after(async()=>{await app.close();fs.rmSync(dir,{force:true,recursive:true});});
 const setup=await fetch(local+'/api/auth/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'senhaForteQrSomenteConsulta2026'})});
 assert.equal(setup.status,201);
 const cookie=setup.headers.get('set-cookie').split(';')[0];
 const pub=await fetch(portal+'/api/public/menu');
 assert.equal(pub.status,200,'cardápio público deve continuar acessível para consulta');
 const headers={'content-type':'application/json',cookie};
 const issue=await fetch(local+'/api/tables/table-id/qr',{method:'POST',headers,body:JSON.stringify({commandId:'no-guest-ordering',publicBaseUrl:portal})});
 assert.equal(issue.status,404,'QR vinculado à comanda não deve ser emitido');
 const reading=await fetch(portal+'/api/public/table/'+'a'.repeat(64));
 assert.equal(reading.status,404);
 const submitted=await fetch(portal+'/api/public/table/'+'a'.repeat(64)+'/requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({clientRequestId:'test',items:[]})});
 assert.equal(submitted.status,404,'não permitir pedidos públicos, mesmo com token antigo');
 const localSubmit=await fetch(local+'/api/public/table/'+'a'.repeat(64)+'/requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({})});
 assert.equal(localSubmit.status,404);
});
