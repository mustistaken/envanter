const CACHE_NAME = 'teknikel-v14-27';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=14.24',
  './manifest.json',
  './magmaweld-logo.png',
  './icon.png'
];

const APP_RUNTIME_PATCH = `

/* Kalıcı Google oturumu ve iOS sessiz yenileme */
(function () {
  var SILENT_AUTH_ATTEMPT_KEY = 'teknikelSilentAuthAttempt';

  readSession = function (key) {
    try {
      var storage = key === AUTH_TOKEN_KEY ? localStorage : sessionStorage;
      return storage.getItem(key) || '';
    } catch (e) { return ''; }
  };

  writeSession = function (key, value) {
    try {
      var storage = key === AUTH_TOKEN_KEY ? localStorage : sessionStorage;
      if (value) storage.setItem(key, value);
      else storage.removeItem(key);
    } catch (e) {}
  };

  function clearSilentAttempt() {
    try { localStorage.removeItem(SILENT_AUTH_ATTEMPT_KEY); } catch (e) {}
  }

  function canTrySilentRedirect() {
    try {
      var lastAttempt = Number(localStorage.getItem(SILENT_AUTH_ATTEMPT_KEY) || 0);
      return !lastAttempt || Date.now() - lastAttempt > 5 * 60 * 1000;
    } catch (e) { return true; }
  }

  function startSilentRedirectSignIn() {
    if (!readPersistentFlag(AUTO_SIGN_IN_KEY) || !canTrySilentRedirect()) return false;
    try {
      var state = randomUrlSafeToken();
      var nonce = randomUrlSafeToken();
      writeSession(REDIRECT_SIGN_IN_STATE_KEY, state);
      writeSession(REDIRECT_SIGN_IN_NONCE_KEY, nonce);
      try { localStorage.setItem(SILENT_AUTH_ATTEMPT_KEY, String(Date.now())); } catch (e) {}

      var authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', REDIRECT_SIGN_IN_URI);
      authUrl.searchParams.set('response_type', 'id_token');
      authUrl.searchParams.set('response_mode', 'fragment');
      authUrl.searchParams.set('scope', 'openid email');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('nonce', nonce);
      authUrl.searchParams.set('prompt', 'none');
      window.location.replace(authUrl.toString());
      return true;
    } catch (e) {
      return false;
    }
  }

  var originalHandleGoogleCredential = handleGoogleCredential;
  handleGoogleCredential = function (response) {
    clearSilentAttempt();
    return originalHandleGoogleCredential(response);
  };

  requestAutomaticSignIn = function () {
    if (!readPersistentFlag(AUTO_SIGN_IN_KEY)) return false;

    if (!window.google || !google.accounts || !google.accounts.id) {
      return startSilentRedirectSignIn();
    }

    setAuthStatus('Google oturumunuz geri yükleniyor…', false);
    var completed = false;
    google.accounts.id.prompt(function (notification) {
      if (completed) return;
      var unavailable = notification &&
        ((notification.isNotDisplayed && notification.isNotDisplayed()) ||
         (notification.isSkippedMoment && notification.isSkippedMoment()) ||
         (notification.isDismissedMoment && notification.isDismissedMoment()));
      if (unavailable) {
        completed = true;
        if (!startSilentRedirectSignIn()) {
          setAuthStatus('Google oturumu otomatik yenilenemedi. Google ile giriş düğmesine basın.', false);
        }
      }
    });

    setTimeout(function () {
      if (!googleIdToken && !completed) {
        completed = true;
        startSilentRedirectSignIn();
      }
    }, 1800);
    return true;
  };

  var originalSignOut = signOut;
  signOut = function () {
    clearSilentAttempt();
    try { localStorage.removeItem(AUTH_TOKEN_KEY); } catch (e) {}
    return originalSignOut();
  };
})();
`;

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
      fetch(event.request, { cache: 'no-store' }).then(response => {
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
        const patchedResponse = new Response(source + APP_RUNTIME_PATCH + PRICE_NOTIFICATION_PATCH, {
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-store, max-age=0'
          }
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
