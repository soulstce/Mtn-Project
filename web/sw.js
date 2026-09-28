// Offline support.
//  - App shell: precached, served stale-while-revalidate.
//  - Library JSON (api/*.json): network first, falling back to anything saved
//    with "Save offline" (crag-data cache).
//  - Downloaded photos: cache first.
//  - Live Mountain Project / download endpoints: network only.

const SHELL_CACHE = 'crag-shell-v1';
const DATA_CACHE = 'crag-data-v1';
const SHELL = [
  './',
  'index.html',
  'app.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/app.js',
  'js/api.js',
  'js/prefs.js',
  'js/ui.js',
  'js/views/library.js',
  'js/views/area.js',
  'js/views/routelist.js',
  'js/views/route.js',
  'js/views/search.js',
  'js/views/discover.js',
  'js/views/downloads.js',
  'js/views/ticks.js',
  'js/views/settings.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('crag-shell-') && key !== SHELL_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

const scopePath = new URL(self.registration.scope).pathname;
const rel = (url) => url.pathname.slice(scopePath.length);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = rel(url);

  if (path.startsWith('api/remote') || path.startsWith('api/downloads') || path.startsWith('api/offline')) {
    return; // live only
  }
  if (path === 'api/status.json') {
    event.respondWith(fetch(request).catch(() => new Response(
      JSON.stringify({ mode: 'offline' }), { headers: { 'Content-Type': 'application/json' } },
    )));
    return;
  }
  if (path.startsWith('api/')) {
    event.respondWith(networkFirst(request, path));
    return;
  }
  if (path.startsWith('photos/')) {
    event.respondWith(cacheFirst(request, path));
    return;
  }
  event.respondWith(shell(request, path));
});

async function networkFirst(request, path) {
  const data = await caches.open(DATA_CACHE);
  try {
    const res = await fetch(request);
    // Keep saved-offline copies fresh whenever we are online.
    if (res.ok && (await data.match(path))) data.put(path, res.clone());
    return res;
  } catch (err) {
    const hit = await data.match(path);
    if (hit) return hit;
    return new Response(JSON.stringify({ detail: 'Not saved for offline use' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function cacheFirst(request, path) {
  const data = await caches.open(DATA_CACHE);
  const hit = await data.match(path);
  if (hit) return hit;
  return fetch(request);
}

async function shell(request, path) {
  const cache = await caches.open(SHELL_CACHE);
  const key = request.mode === 'navigate' ? 'index.html' : path || './';
  const hit = await cache.match(key);
  const network = fetch(request).then((res) => {
    if (res.ok && SHELL.includes(key)) cache.put(key, res.clone());
    return res;
  }).catch(() => null);
  return hit || (await network) || new Response('Offline', { status: 503 });
}
