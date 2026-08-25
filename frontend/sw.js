/* LordTempsMart service worker — enables one-click "Install app" and an
 * offline shell. API calls are NEVER cached (always live data). */
const CACHE_NAME = 'lordtempsmart-v2';

const CORE_ASSETS = [
    '/',
    '/index.html',
    '/products.html',
    '/cart.html',
    '/checkout.html',
    '/finally.html',
    '/login.html',
    '/register.html',
    '/verify.html',
    '/dashboard.html',
    '/admin.html',
    '/worker.html',
    '/css/style.css',
    '/js/api.js',
    '/js/data.js',
    '/js/main.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(CORE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== location.origin) return;
    if (url.pathname.startsWith('/api/')) return; // live data only — never cache

    // Page navigations: network first, cached shell as offline fallback
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req).catch(() =>
                caches.match(url.pathname).then((r) => r || caches.match('/index.html'))
            )
        );
        return;
    }

    // Static assets: cache first, refresh in the background
    event.respondWith(
        caches.match(req).then((cached) => {
            const network = fetch(req).then((res) => {
                if (res && res.ok && res.type === 'basic') {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((c) => c.put(req, copy));
                }
                return res;
            }).catch(() => cached);
            return cached || network;
        })
    );
});