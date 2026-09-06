// Trenerappen - service worker
//
// Only job: let the app open from the iPhone home screen (or a browser tab)
// with zero network connectivity, by keeping a cached copy of index.html
// (the whole app - see PROSJEKT-OPPSUMMERING.md) around after the first
// successful load.
//
// Deliberately NOT a cache-first "offline-first" worker: for navigations it
// always tries the network first and only falls back to the cached shell
// when that fails, so a device that DOES have connectivity always gets the
// live index.html, never a stale cached one. That's what keeps this
// compatible with the update-check in index.html (checkForUpdate), which
// fetches with {cache:'no-store'} - those requests are ignored below and
// go straight to the network, untouched, so they always see what's truly
// live on Netlify regardless of what this worker has cached.
//
// Bump CACHE_NAME (to match APP_VERSION in index.html) on every deploy that
// changes index.html, so the old cached shell gets purged on activate
// instead of lingering.
var CACHE_NAME = 'trenerapp-shell-v1.6.9';
var APP_SHELL = ['/', '/index.html', '/icon-180.png', '/icon-512.png'];

self.addEventListener('install', function(event){
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){ return cache.addAll(APP_SHELL); })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(names){
      return Promise.all(names.filter(function(n){ return n !== CACHE_NAME; }).map(function(n){ return caches.delete(n); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event){
  var req = event.request;
  if (req.method !== 'GET') return;
  if (req.cache === 'no-store') return; // let cache-busting fetches (our update check) hit the network untouched

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave cross-origin (Supabase CDN) requests alone

  var isNavigation = req.mode === 'navigate' || req.destination === 'document';

  if (isNavigation){
    event.respondWith(
      fetch(req).then(function(res){
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put('/index.html', copy); });
        return res;
      }).catch(function(){
        return caches.match('/index.html').then(function(cached){ return cached || Response.error(); });
      })
    );
    return;
  }

  event.respondWith(
    fetch(req).then(function(res){
      if (res && res.ok){
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put(req, copy); });
      }
      return res;
    }).catch(function(){ return caches.match(req); })
  );
});
