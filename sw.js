/* Servis worker: čuva osnovne fajlove portala da se otvori i kad je veza loša. */
const CACHE = 'tandem-ns-v4';
const SHELL = ['magacin.html', 'css/styles.css', 'css/fontawesome.min.css', 'css/solid.min.css', 'js/core.js', 'js/portal.js',
  'js/vendor/jsQR.js', 'js/vendor/qrcode.js', 'webfonts/fa-solid-900.woff2', 'fonts/inter-latin-wght-normal.woff2',
  'fonts/inter-latin-ext-wght-normal.woff2', 'fonts/space-grotesk-latin-wght-normal.woff2', 'fonts/space-grotesk-latin-ext-wght-normal.woff2',
  'manifest.webmanifest', 'icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req)));
});
