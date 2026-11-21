/** Legacy PWA cache retirement. All operational screens now use the React UI. */
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const cachesFound=await caches.keys();
  await Promise.all(cachesFound.filter(name=>name.startsWith('nexus-static-')).map(name=>caches.delete(name)));
  await self.clients.claim();
})()));
// No offline cache of orders, tokens, personal data or obsolete POS HTML.
// The React UI communicates only with the local host.
