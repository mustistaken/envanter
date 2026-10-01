const CACHE_NAME = 'teknikel-v14-40';
const APP_SHELL = [
  './', './index.html', './styles.css?v=14.40', './app.js?v=14.40',
  './manifest.json', './magmaweld-logo.png', './icon.png'
];
const NAVIGATION_TIMEOUT_MS = 8000;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('teknikel-') && key !== CACHE_NAME).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

async function fetchNavigation(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);
  try {
    const response = await fetch(request, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    // Keep the timeout active until the body has arrived, too.
    await response.clone().arrayBuffer();
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function unavailableResponse() {
  return new Response('Uygulama açılamadı. İnternet bağlantısını kontrol edip yeniden deneyin.', {
    status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetchNavigation(event.request);
        try { await cache.put('./index.html', response.clone()); } catch (error) {}
        return response;
      } catch (error) {
        return await cache.match('./index.html') || unavailableResponse();
      }
    })());
    return;
  }

  const isAppAsset = APP_SHELL.some(asset => new URL(asset, self.registration.scope).pathname === url.pathname);
  if (!isAppAsset) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Exact version matching avoids mixing JS/CSS releases when offline.
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        try { await cache.put(event.request, response.clone()); } catch (error) {}
      }
      return response;
    } catch (error) {
      return unavailableResponse();
    }
  })());
});
