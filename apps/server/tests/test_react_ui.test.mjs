import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.mjs';

test('P0: build React servido em /ui/ sem substituir PWA e caixa legado', async t => {
  const root=path.resolve(import.meta.dirname,'../../react-ui/dist');
  assert.ok(fs.existsSync(path.join(root,'index.html')), 'Compilar React com npm run ui:build antes dos testes');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-react-route-'));
  const app=createApp({dataPath:path.join(dir,'test.db')});
  const origin=await app.listen({port:0});
  t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
  const ui=await fetch(origin+'/ui/');
  assert.equal(ui.status,200);
  assert.match(ui.headers.get('content-type')||'',/text\/html/);
  const html=await ui.text();
  assert.match(html,/PDV Nexus/);
  assert.match(html,/\/ui\/assets\/index-[^"']+\.js/);
  assert.match(ui.headers.get('content-security-policy')||'',/object-src 'none'/);
  const script=new URL(html.match(/src="(\/ui\/assets\/index-[^"]+\.js)"/)[1],origin);
  const js=await fetch(script);
  assert.equal(js.status,200);
  assert.match(js.headers.get('content-type')||'',/javascript/);
  assert.ok((await js.text()).length>5000);
  const legacy=await fetch(origin+'/');
  assert.equal(legacy.status,200);
  assert.match(await legacy.text(),/view-pos/);
  const pwa=await fetch(origin+'/restaurant.html');
  assert.equal(pwa.status,200);
  assert.match(await pwa.text(),/comanda|mesa/i);
});

test('P0: ativos React não dão acesso a arquivos ou rotas arbitrárias',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-react-safe-'));
  const app=createApp({dataPath:path.join(dir,'test.db')});const origin=await app.listen({port:0});
  t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
  for(const route of ['/ui/.env','/ui/src/App.jsx','/ui/secret.txt','/ui/assets/../src/App.jsx']){
    const res=await fetch(origin+route,{redirect:'manual'});
    assert.equal(res.status,404,route);
  }
  const wrong=await fetch(origin+'/ui/',{method:'POST'});
  assert.equal(wrong.status,405);
});
