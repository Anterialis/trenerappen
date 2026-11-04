// Trenerappen - service worker
//
// Samme modell som Anestesiappen: appen kjører alltid fra en komplett, lagret kopi, og en ny versjon
// tas først i bruk når brukeren trykker «Oppdater nå». Det gir tre ting på banen:
// - ingen overraskende omstart midt i en kamp,
// - rask oppstart også med dårlig dekning, og oppstart helt uten nett,
// - aldri en blanding av gamle og nye filer, siden hver versjon har sin egen hele kopi.
//
// Slik kommer en ny versjon inn: appen ber nettleseren sjekke denne filen ved oppstart og når den
// hentes frem (se initAppUpdates i app.js). Er filen endret, installeres den nye service workeren i
// bakgrunnen og blir stående og vente, og appen viser banneret. Derfor MÅ CACHE_NAME bumpes (til samme
// versjon som APP_VERSION i app.js) ved hver utgivelse: uten endring her oppdager ingen telefon noe.
//
// Lukkes appen helt uten at brukeren har svart, tar nettleseren selv den nye versjonen i bruk neste
// gang den åpnes. Det er slik service workere virker, og det samme skjer i Anestesiappen.
var APP_VERSION = '2.4.1';
var CACHE_NAME = 'trenerapp-app-v2.4.1';
var APP_SHELL = ['/', '/index.html', '/style.css', '/designs.css', '/design-init.js', '/app.js', '/vendor/supabase-2.118.0.min.js', '/vendor/qrcode-generator-2.0.4.js', '/manifest.json', '/icon-180.png', '/icon-512.png'];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      // cache:'reload': rett fra nettet, så en ny versjon aldri bygges av filer fra nettleserens mellomlager.
      return cache.addAll(APP_SHELL.map(function(url){ return new Request(url, { cache: 'reload' }); }));
    }).then(function(){
      return caches.keys();
    }).then(function(names){
      // Forrige generasjon (til og med 2.3.x) hentet alltid fra nettet, så siden kjører allerede de nye
      // filene når vi kommer hit. Da er det ingenting å spørre om: gå rett over til den nye modellen.
      var oldGeneration = names.some(function(n){ return n.indexOf('trenerapp-shell-') === 0; });
      if (oldGeneration) return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(names){
      return Promise.all(names.filter(function(n){ return n !== CACHE_NAME; }).map(function(n){ return caches.delete(n); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('message', function(event){
  var data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting(); // brukeren har trykket «Oppdater nå»
  if (data.type === 'GET_VERSION' && event.source) event.source.postMessage({ type: 'SW_VERSION', version: APP_VERSION });
});

self.addEventListener('fetch', function(event){
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase går rett på nettet

  var isNavigation = req.mode === 'navigate' || req.destination === 'document';
  var key = isNavigation ? '/index.html' : url.pathname; // søkestreng (?okt=, ?se=) gir samme side
  event.respondWith(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.match(key).then(function(hit){
        return hit || fetch(req); // ikke en del av appen, eller første besøk før installasjonen er ferdig
      });
    })
  );
});
