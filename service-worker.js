// Version: cyclodash-v22-gmail-tcx (upgraded from cyclodash-v21-email-tcx, cyclodash-v20-analytics-v4 and cyclodash-v19-ux-v3)
const CACHE_NAME = 'cyclodash-v22-gmail-tcx';
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
  './css/ux-v3.css',
  './css/session-detail.css',
  './css/email.css',
  './js/vendor/chart.umd.js',
  './js/state.js',
  './js/supabase.js',
  './js/storage.js',
  './js/profiles.js',
  './js/bluetooth.js',
  './js/workout.js',
  './js/analytics.js',
  './js/history.js',
  './js/email.js',
  './js/session-detail.js',
  './js/session.js',
  './js/main.js',
  './manifest.json',
  './icons/cyclodash.svg',
  './icons/cyclodash-192.png',
  './icons/cyclodash-512.png'
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

// Navigation réseau avec secours hors ligne, ressources statiques cache-first.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const requestUrl = new URL(e.request.url);

  // Laisser passer sans interception les API et ressources tierces (notamment
  // une future intégration Supabase).
  if (requestUrl.origin !== self.location.origin) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
    return;
  }
  // Les ressources d'une version proviennent toutes du même cache préchargé,
  // ce qui évite de mélanger du JavaScript de versions incompatibles.
  e.respondWith(caches.match(e.request).then((cached) => cached || fetch(e.request)));
});
