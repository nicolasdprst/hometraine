const CACHE_NAME = 'cyclodash-v18-supabase-stability';
const ASSETS = [
  './index.html',
  './style.css',
  './css/variables.css',
  './css/base.css',
  './css/layout.css',
  './css/components.css',
  './css/dashboard.css',
  './css/compteur.css',
  './css/responsive.css',
  './js/vendor/chart.umd.js',
  './js/state.js',
  './js/supabase.js',
  './js/storage.js',
  './js/profiles.js',
  './js/bluetooth.js',
  './js/workout.js',
  './js/session.js',
  './js/history.js',
  './js/main.js',
  './manifest.json'
];

// Installation et mise en cache initiale
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Activation à la demande via message pour ne pas interrompre une séance en cours
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});

// Nettoyage des anciens caches lors de l'activation
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Cache strictement réservé aux ressources publiques de l'application.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const requestUrl = new URL(e.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
