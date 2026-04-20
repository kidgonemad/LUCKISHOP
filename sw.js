// LuckiVault 3D viewer — Service Worker
// Cache-on-demand for GLBs, WebP textures, three.js, fonts.
// First visit downloads normally; responses are cached as they arrive.
// Return visits serve cached assets without touching the network.

// Bump CACHE_NAME whenever you ship updated GLBs or three.js — forces clients to re-fetch.
const CACHE_NAME = 'luckivault-3d-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;
  // Only intercept cacheable static assets
  if(!/\.(glb|webp|js|woff2?|png|jpg|jpeg|ttf|otf|svg)$/i.test(url.pathname)) return;

  e.respondWith(
    caches.match(req).then(cached => {
      if(cached) return cached;
      return fetch(req).then(resp => {
        if(resp && resp.status === 200 && resp.type !== 'opaque'){
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone)).catch(()=>{});
        }
        return resp;
      }).catch(() => caches.match(req));
    })
  );
});
