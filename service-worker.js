const CACHE_NAME = 'teknikel-v14-26';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=14.24',
  './manifest.json',
  './magmaweld-logo.png',
  './icon.png'
];

const PRICE_NOTIFICATION_PATCH = `

/* Fiyat değişikliği bildirimi */
(function () {
  var originalApplyProductSnapshot = applyProductSnapshot;

  function priceChangeFingerprint(changes) {
    return changes.map(function (product) {
      return productKey(product) + '|' + Number(product.previousPrice) + '|' + Number(product.price);
    }).sort().join('||');
  }

  function notifyPriceChanges(changes) {
    if (!changes.length) return;

    var fingerprint = priceChangeFingerprint(changes);
    var storageKey = 'teknikelLastPriceChangeNotification::' + (signedInEmail || 'signed-out');
    try {
      if (localStorage.getItem(storageKey) === fingerprint) return;
      localStorage.setItem(storageKey, fingerprint);
    } catch (e) {}

    var message = changes.length === 1
      ? changes[0].name + ' fiyatı güncellendi: ' + formatPrice(changes[0].previousPrice) + ' → ' + formatPrice(changes[0].price)
      : changes.length + ' ürünün fiyatı güncellendi. Fiyat güncelleme geçmişini kontrol edin.';

    showToast('🔔 ' + message);

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Fiyat güncellemesi', {
          body: message,
          icon: 'icon.png',
          tag: 'teknikel-price-change',
          renotify: true
        });
      } catch (e) {}
    }
  }

  applyProductSnapshot = function (snapshot, cached) {
    originalApplyProductSnapshot(snapshot, cached);
    if (cached) return;
    var changedProducts = products.filter(function (product) {
      return Number(product.priceChange) !== 0 && isFinite(Number(product.priceChange));
    });
    notifyPriceChanges(changedProducts);
  };
})();
`;

function applyAuthPersistencePatch(source) {
  const oldReadSession = `function readSession(key) {
  try { return sessionStorage.getItem(key) || ''; } catch (e) { return ''; }
}`;
  const newReadSession = `function readSession(key) {
  try {
    var storage = key === AUTH_TOKEN_KEY ? localStorage : sessionStorage;
    return storage.getItem(key) || '';
  } catch (e) { return ''; }
}`;

  const oldWriteSession = `function writeSession(key, value) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch (e) {}
}`;
  const newWriteSession = `function writeSession(key, value) {
  try {
    var storage = key === AUTH_TOKEN_KEY ? localStorage : sessionStorage;
    if (value) storage.setItem(key, value);
    else storage.removeItem(key);
  } catch (e) {}
}`;

  return source.replace(oldReadSession, newReadSession).replace(oldWriteSession, newWriteSession);
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
        }
        return response;
      }).catch(() => caches.match('./index.html', { ignoreSearch: true }))
    );
    return;
  }

  if (url.pathname.endsWith('/app.js')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error('app.js alınamadı');
        return response.text();
      }).then(source => {
        const patchedSource = applyAuthPersistencePatch(source) + PRICE_NOTIFICATION_PATCH;
        const patchedResponse = new Response(patchedSource, {
          headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
        });
        const cacheCopy = patchedResponse.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, cacheCopy));
        return patchedResponse;
      }).catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
    return;
  }

  const isAppAsset = APP_SHELL.some(asset => {
    const assetUrl = new URL(asset, self.registration.scope);
    return assetUrl.pathname === url.pathname;
  });
  if (!isAppAsset) return;

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});
