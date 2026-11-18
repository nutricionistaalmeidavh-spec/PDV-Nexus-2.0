// Apenas assets estáticos; nenhuma resposta de API ou credencial é armazenada.
const CACHE='nexus-static-v3';
const STATIC=['/restaurant.html','/kitchen.html','/restaurant.js','/kitchen.js','/pwa-register.js','/auth.js','/auth.css','/styles.css','/restaurant.css','/pwa-icon.svg','/pwa-192.png','/pwa-512.png','/manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!STATIC.includes(url.pathname))return;
  event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
});
