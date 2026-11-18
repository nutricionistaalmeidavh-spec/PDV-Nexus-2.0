import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../../web/public');
test('PWA só tem cache estático e aponta para assets que existem',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
  assert.equal(manifest.display,'standalone');
  assert.ok(manifest.icons.some(icon=>icon.sizes==='192x192'));
  assert.ok(manifest.icons.some(icon=>icon.sizes==='512x512'));
  const files=['restaurant.html','kitchen.html','restaurant.js','kitchen.js','pwa-register.js','restaurant.css','manifest.webmanifest','sw.js','pwa-icon.svg','pwa-192.png','pwa-512.png'];
  for(const file of files)assert.ok(fs.existsSync(path.join(root,file)),`Ausente: ${file}`);
  const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  assert.ok(sw.includes("url.pathname"));
  assert.ok(sw.includes("STATIC.includes(url.pathname)"));
  assert.ok(!sw.includes('caches.open(CACHE).then(cache=>cache.addAll(["/api/'));
});
test('telas de salão e cozinha não executam scripts embutidos',()=>{
  for(const file of ['restaurant.html','kitchen.html']) {
    const html=fs.readFileSync(path.join(root,file),'utf8');
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html),file);
    assert.ok(html.includes('viewport'));
    assert.ok(html.includes('/pwa-register.js'));
  }
});
