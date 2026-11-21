import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../../web/public');
test('PWA points to React role endpoint and does not cache obsolete screens',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.start_url,'/ui/?device=waiter');
  assert.equal(manifest.scope,'/ui/');
  assert.ok(manifest.icons.some(icon=>icon.sizes==='192x192'));
  assert.ok(manifest.icons.some(icon=>icon.sizes==='512x512'));
  const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  assert.match(sw,/caches\.delete/);
  assert.doesNotMatch(sw,/caches\.open\(/);
  assert.doesNotMatch(sw,/api\/orders|api\/products/);
});
test('no legacy administrative pages or scripts remain packaged',()=>{
  const obsolete=['index.html','app.js','styles.css','auth.js','auth.css',
    'p2-admin.js','restaurant.html','restaurant.js','restaurant.css',
    'kitchen.html','kitchen.js','pwa-register.js'];
  for(const name of obsolete){
    assert.equal(fs.existsSync(path.join(root,name)),false,'Legacy asset unexpectedly packaged: '+name);
  }
  for(const name of ['menu.html','menu.js','menu.css','pwa-icon.svg','pwa-192.png','pwa-512.png','manifest.webmanifest','sw.js']){
    assert.ok(fs.existsSync(path.join(root,name)),'Missing public customer portal or PWA migration asset: '+name);
  }
});
