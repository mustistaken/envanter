const GOOGLE_CLIENT_ID = '334267311865-5oqahpjifptf1j67httml63h0gvq0g38.apps.googleusercontent.com';
const INVENTORY_API_URL = 'https://script.google.com/macros/s/AKfycbxyCdJ0btfjuZgGF5X0Up7ugD2qEMr-jQHVKtPp-MI466roWtnDb0hPweI71iknVOXBvA/exec';
const AUTH_TOKEN_KEY = 'teknikelGoogleIdToken';
const ADMIN_EMAIL = 'mustafaozllu@gmail.com';
let googleIdToken = '';
let signedInEmail = '';
let authInitialized = false;

let products = [], currentProduct = null, iskontoOrani = 0;
let basket = readStore('teknikelCurrentBasket', []);
let favorites = readStore('teknikelFavorites', []);
let recentProducts = readStore('teknikelRecentProducts', []);
let savedBaskets = readStore('teknikelSavedBaskets', []);
let customerProfiles = readStore('teknikelCustomerProfiles', []);
let offerHistory = readStore('teknikelOfferHistory', []);
let favoriteGroups = readStore('teknikelFavoriteGroups', {});
let deferredInstallPrompt = null;
let toastTimer = null;
let currentOfferNumber = '';
let isLoadingData = false;
let barcodeLibraryPromise = null;
let lastModalTrigger = null;

const BARCODE_LIBRARY_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.18.6/umd/index.min.js';
const EXCHANGE_RATE_URLS = {
  eur: 'https://api.frankfurter.dev/v2/rate/EUR/TRY',
  usd: 'https://api.frankfurter.dev/v2/rate/USD/TRY'
};

function readSession(key) {
  try { return sessionStorage.getItem(key) || ''; } catch (e) { return ''; }
}

function writeSession(key, value) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch (e) {}
}

function decodeGoogleCredential(token) {
  try {
    var payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    payload += '='.repeat((4 - payload.length % 4) % 4);
    return JSON.parse(decodeURIComponent(Array.from(atob(payload)).map(function(char) {
      return '%' + ('00' + char.charCodeAt(0).toString(16)).slice(-2);
    }).join('')));
  } catch (e) {
    return null;
  }
}

function isUsableCredential(token) {
  var payload = decodeGoogleCredential(token);
  return !!(payload &&
    String(payload.aud || '') === GOOGLE_CLIENT_ID &&
    (payload.email_verified === true || payload.email_verified === 'true') &&
    Number(payload.exp || 0) * 1000 > Date.now() + 30000);
}

function setAuthStatus(message, isError) {
  var status = document.getElementById('authStatus');
  status.textContent = message;
  status.classList.toggle('error', !!isError);
}

function showAuthGate(message, isError) {
  googleIdToken = '';
  signedInEmail = '';
  writeSession(AUTH_TOKEN_KEY, '');
  products = [];
  try {
    localStorage.removeItem('teknikelCachedProducts');
    localStorage.removeItem('teknikelCacheTime');
  } catch (e) {}
  document.body.classList.add('auth-pending');
  document.getElementById('appShell').setAttribute('aria-hidden', 'true');
  document.getElementById('authGate').removeAttribute('aria-hidden');
  setAuthStatus(message || 'Yetkili Google hesabınızla giriş yapın.', isError);
}

function isAdminAccount() {
  return String(signedInEmail || '').toLowerCase() === String(ADMIN_EMAIL || '').toLowerCase();
}

function applyRoleVisibility(email) {
  signedInEmail = String(email || '').toLowerCase();
  var isAdmin = isAdminAccount();
  document.getElementById('addProductBtn').hidden = !isAdmin;
  document.getElementById('adminCenterBtn').hidden = !isAdmin;
}

function unlockApp(token) {
  var payload = decodeGoogleCredential(token);
  googleIdToken = token;
  writeSession(AUTH_TOKEN_KEY, token);
  document.body.classList.remove('auth-pending');
  document.getElementById('authGate').setAttribute('aria-hidden', 'true');
  document.getElementById('appShell').setAttribute('aria-hidden', 'false');
  document.getElementById('accountEmail').textContent = payload && payload.email ? payload.email : 'Google hesabı';
  applyRoleVisibility(payload && payload.email ? payload.email : '');
  loadData();
  loadExchangeRates();
}

function handleGoogleCredential(response) {
  var token = response && response.credential ? response.credential : '';
  if (!isUsableCredential(token)) {
    showAuthGate('Bu Google hesabının envantere erişim izni yok.', true);
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    return;
  }
  setAuthStatus('Hesabınız doğrulandı. Envanter açılıyor…', false);
  unlockApp(token);
}

function renderGoogleSignIn() {
  if (authInitialized || !window.google || !google.accounts || !google.accounts.id) return false;
  authInitialized = true;
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential,
    auto_select: false,
    cancel_on_tap_outside: false
  });
  google.accounts.id.renderButton(document.getElementById('googleSignInButton'), {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'rectangular',
    width: 300,
    locale: 'tr'
  });
  return true;
}

function initializeAuth() {
  var attempts = 0;
  var timer = setInterval(function() {
    attempts++;
    if (renderGoogleSignIn()) {
      clearInterval(timer);
      var storedToken = readSession(AUTH_TOKEN_KEY);
      if (isUsableCredential(storedToken)) unlockApp(storedToken);
      else showAuthGate('Yetkili Google hesabınızla giriş yapın.', false);
    } else if (attempts >= 80) {
      clearInterval(timer);
      showAuthGate('Google giriş sistemi yüklenemedi. İnternet bağlantınızı kontrol edip sayfayı yenileyin.', true);
    }
  }, 100);
}

function isLocalDesignPreview() {
  return (location.hostname === 'localhost' || location.hostname === '127.0.0.1') &&
    new URLSearchParams(location.search).get('design-preview') === '1';
}

function openLocalDesignPreview() {
  document.body.classList.remove('auth-pending');
  document.getElementById('authGate').setAttribute('aria-hidden', 'true');
  document.getElementById('appShell').setAttribute('aria-hidden', 'false');
  document.getElementById('accountEmail').textContent = 'Önizleme hesabı';
  applyRoleVisibility(ADMIN_EMAIL);
  document.getElementById('statProductCount').textContent = '3.334';
  document.getElementById('statCriticalCount').textContent = 'Canlı veride';
  document.getElementById('statLastSync').textContent = 'Şimdi';
  document.getElementById('lastSyncText').textContent = 'Yerel tasarım önizlemesi';
  document.getElementById('criticalStockCount').textContent = 'Canlı veride hesaplanır';
  document.getElementById('criticalStockList').innerHTML =
    '<span class="quick-empty">Gerçek stok bilgileri yalnızca güvenli canlı sitede gösterilir.</span>';
  document.getElementById('infoBox').textContent =
    'Tasarım önizlemesi · Google Sheets ve Apps Script bağlantısı canlı sitede aynen korunur.';
  loadExchangeRates();
}

function signOut() {
  if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  showAuthGate('Oturum kapatıldı. Yeniden giriş yapabilirsiniz.', false);
}

function readStore(key, fallback) {
  try {
    var value = JSON.parse(localStorage.getItem(key));
    return value == null ? fallback : value;
  } catch (e) { return fallback; }
}

function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

function formatExchangeRate(value) {
  var number = Number(value);
  if (!isFinite(number)) return '—';
  return number.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
}

function renderExchangeRates(record, cached) {
  document.getElementById('eurTryRate').textContent = formatExchangeRate(record && record.eurTry);
  document.getElementById('usdTryRate').textContent = formatExchangeRate(record && record.usdTry);
  var dateEl = document.getElementById('exchangeRateDate');
  if (!record || !record.date) {
    dateEl.textContent = 'Kur alınamadı';
    return;
  }
  var rateDate = new Date(record.date + 'T12:00:00').toLocaleDateString('tr-TR');
  dateEl.textContent = (cached ? 'Son kayıt · ' : 'Referans · ') + rateDate;
}

async function loadExchangeRates() {
  var cachedRates = readStore('teknikelExchangeRates', null);
  if (cachedRates) renderExchangeRates(cachedRates, true);
  try {
    var responses = await Promise.all([
      fetch(EXCHANGE_RATE_URLS.eur, { cache: 'no-store' }),
      fetch(EXCHANGE_RATE_URLS.usd, { cache: 'no-store' })
    ]);
    if (!responses[0].ok || !responses[1].ok) throw new Error('Kur servisi yanıt vermedi');
    var values = await Promise.all(responses.map(function(response){ return response.json(); }));
    var record = {
      eurTry: Number(values[0].rate),
      usdTry: Number(values[1].rate),
      date: values[0].date || values[1].date || new Date().toISOString().slice(0, 10),
      savedAt: Date.now()
    };
    if (!isFinite(record.eurTry) || !isFinite(record.usdTry)) throw new Error('Kur verisi geçersiz');
    writeStore('teknikelExchangeRates', record);
    renderExchangeRates(record, false);
  } catch (e) {
    if (!cachedRates) renderExchangeRates(null, false);
  }
}

function productKey(product) {
  return product ? (product.name + '|' + product.sheet) : '';
}

const MAGMAWELD_SHEETS = new Set([
  'MW Torç ve Sarfları',
  'MW Kaynak Makinaları',
  'Özlü Teller',
  'MIG-MAG ve TIG Telleri',
  'Örtülü Elektrodlar'
]);

function getBrand(product) {
  if (!product) return '';
  var text = normalizeText(product.name);
  if (product.sheet === 'Trafimet' || text.includes('trafimet')) return 'Trafimet';
  if (MAGMAWELD_SHEETS.has(product.sheet) || text.includes('magmaweld')) return 'Magmaweld';
  if (text.includes('inelco')) return 'Inelco';
  return '';
}

function normalizeText(value) {
  return String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function similarity(a, b) {
  a = normalizeText(a); b = normalizeText(b);
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) return 1;
  function pairs(s) {
    var out = [];
    for (var i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  }
  var ap = pairs(a), bp = pairs(b), hits = 0, used = {};
  ap.forEach(function(pair) {
    for (var i = 0; i < bp.length; i++) {
      if (!used[i] && bp[i] === pair) { used[i] = true; hits++; break; }
    }
  });
  return (2 * hits) / Math.max(1, ap.length + bp.length);
}

function compactSearchText(value) {
  return normalizeText(value).replace(/\s+/g, '');
}

function scoreProductSearch(product, query) {
  var normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return { score: 1, fuzzy: false };

  var name = normalizeText(product.name);
  var barcode = normalizeText(product.barcode);
  var sheet = normalizeText(product.sheet);
  var haystack = [name, barcode, sheet].filter(Boolean).join(' ');
  var compactQuery = compactSearchText(normalizedQuery);
  var compactName = compactSearchText(name);
  var compactHaystack = compactSearchText(haystack);
  var queryTokens = normalizedQuery.split(' ').filter(Boolean);
  var nameWords = name.split(' ').filter(Boolean);
  var score = 0;

  if (barcode && compactSearchText(barcode) === compactQuery) score = 1200;
  if (name === normalizedQuery) score = Math.max(score, 1100);
  if (compactName === compactQuery) score = Math.max(score, 1080);
  if (name.startsWith(normalizedQuery)) score = Math.max(score, 950);
  if (nameWords.indexOf(normalizedQuery) !== -1) score = Math.max(score, 930);
  if (name.includes(normalizedQuery)) score = Math.max(score, 880);
  if (compactName.includes(compactQuery)) score = Math.max(score, 850);

  var everyTokenMatches = queryTokens.every(function(token) {
    return haystack.includes(token) || compactHaystack.includes(compactSearchText(token));
  });
  if (everyTokenMatches) {
    var nameTokenHits = queryTokens.filter(function(token) {
      return name.includes(token) || compactName.includes(compactSearchText(token));
    }).length;
    score = Math.max(score, 700 + (nameTokenHits * 25) - Math.min(80, name.length - normalizedQuery.length));
  }

  if (score > 0) return { score: score, fuzzy: false };
  if (normalizedQuery.length < 4) return { score: 0, fuzzy: false };

  var wholeScore = Math.max(similarity(normalizedQuery, name), similarity(compactQuery, compactName));
  var tokenScores = queryTokens.map(function(token) {
    return Math.max.apply(null, nameWords.map(function(word) {
      return Math.max(similarity(token, word), similarity(compactSearchText(token), compactSearchText(word)));
    }).concat([0]));
  });
  var tokenAverage = tokenScores.length
    ? tokenScores.reduce(function(total, value){ return total + value; }, 0) / tokenScores.length
    : 0;
  var weakestToken = tokenScores.length ? Math.min.apply(null, tokenScores) : 0;
  var fuzzyScore = Math.max(wholeScore, tokenAverage);

  if (fuzzyScore >= .56 && (queryTokens.length === 1 || weakestToken >= .42)) {
    return { score: 300 + Math.round(fuzzyScore * 100), fuzzy: true };
  }
  return { score: 0, fuzzy: false };
}

function showToast(message) {
  var toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ toast.classList.remove('show'); }, 2400);
}

function openModal(id) {
  var modal = document.getElementById(id);
  lastModalTrigger = document.activeElement;
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(function() {
    var firstControl = modal.querySelector('button, input, textarea, select, a[href]');
    if (firstControl) firstControl.focus();
  });
}

function closeModal(id) {
  var modal = document.getElementById(id);
  if (!modal.classList.contains('active')) return;
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
  if (lastModalTrigger && document.contains(lastModalTrigger)) lastModalTrigger.focus();
  lastModalTrigger = null;
}

function loadBarcodeLibrary() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (barcodeLibraryPromise) return barcodeLibraryPromise;
  barcodeLibraryPromise = new Promise(function(resolve, reject) {
    var script = document.createElement('script');
    script.src = BARCODE_LIBRARY_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = function() {
      if (window.ZXing) resolve(window.ZXing);
      else reject(new Error('Barkod okuyucu başlatılamadı'));
    };
    script.onerror = function() {
      barcodeLibraryPromise = null;
      reject(new Error('Barkod okuyucu indirilemedi'));
    };
    document.head.appendChild(script);
  });
  return barcodeLibraryPromise;
}

function setQty(value) {
  var qty = Math.max(1, Math.min(9999, parseInt(value, 10) || 1));
  document.getElementById('qtyInput').value = qty;
}

function changeQty(delta) {
  setQty((parseInt(document.getElementById('qtyInput').value, 10) || 1) + delta);
}

function setIskonto(val, btn) {
  iskontoOrani = val;
  document.getElementById('iskontoCustom').value = '';
  document.querySelectorAll('.isk-btn').forEach(function(b){ b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  renderBasket();
}

function setIskontoCustom(val) {
  var input = document.getElementById('iskontoCustom');
  var n = parseFloat(val);
  if (isNaN(n) || n < 0) n = 0;
  if (n > 100) n = 100;
  if (val !== '' && Number(val) !== n) input.value = n;
  iskontoOrani = n;
  document.querySelectorAll('.isk-btn').forEach(function(b){ b.classList.remove('active'); });
  renderBasket();
}

function applyDiscountValue(value) {
  var discount = Math.max(0, Math.min(100, Number(value) || 0));
  iskontoOrani = discount;
  var matched = false;
  document.querySelectorAll('.isk-btn').forEach(function(btn) {
    var active = btn.textContent.trim() === '%' + discount;
    btn.classList.toggle('active', active);
    if (active) matched = true;
  });
  document.getElementById('iskontoCustom').value = matched ? '' : discount;
  renderBasket();
}

const SHEETS = [
  { name: 'Envanter',                    b:0, n:1, p:2,    u:4,    s:3    },
  { name: 'MW Torç ve Sarfları',         b:0, n:1, p:4,    u:3,    s:null },
  { name: 'MW Kaynak Makinaları',        b:0, n:1, p:4,    u:3,    s:null },
  { name: 'Trafimet',                    b:0, n:1, p:3,    u:null, s:null },
  { name: 'Kaynak Tamamlayıcı Ürünler', b:0, n:1, p:4,    u:null, s:null },
  { name: 'Özlü Teller',                b:0, n:1, p:4,    u:null, s:null },
  { name: 'MIG-MAG ve TIG Telleri',     b:0, n:1, p:4,    u:null, s:null },
  { name: 'Örtülü Elektrodlar',         b:0, n:1, p:4,    u:null, s:null },
];

const RETIRED_DEMO_BARCODES = new Set([
  '869000100001', '869000100002', '869000100003', '869000100004',
  '869000100005', '869000100006', '869000100007', '869000100008'
]);

const RETIRED_DEMO_KEYS = new Set([
  'Magmaweld ID 250 TW Kaynak Makinesi|MW Kaynak Makinaları',
  'Magmaweld ESR 13 Örtülü Elektrod 3.25 mm|Örtülü Elektrodlar',
  'MIG-MAG Kaynak Teli 1.0 mm 15 kg|MIG-MAG ve TIG Telleri',
  'Trafimet Ergoplus 25 Kaynak Torcu|Trafimet',
  'Seramik Nozul No: 6|MW Torç ve Sarfları',
  'Kaynakçı Deri Eldiveni|Kaynak Tamamlayıcı Ürünler',
  'Özlü Kaynak Teli E71T-1 1.2 mm|Özlü Teller',
  'Otomatik Kararan Kaynak Maskesi|Envanter'
]);

function isRetiredDemoProduct(product) {
  return product && RETIRED_DEMO_BARCODES.has(String(product.barcode || ''));
}

function removeRetiredDemoData() {
  basket = basket.filter(function(item){ return !isRetiredDemoProduct(item); });
  favorites = favorites.filter(function(key){ return !RETIRED_DEMO_KEYS.has(key); });
  recentProducts = recentProducts.filter(function(key){ return !RETIRED_DEMO_KEYS.has(key); });
  savedBaskets = savedBaskets.map(function(record) {
    return Object.assign({}, record, {
      items: (record.items || []).filter(function(item){ return !isRetiredDemoProduct(item); })
    });
  }).filter(function(record){ return record.items.length; });
  offerHistory = offerHistory.map(function(record) {
    return Object.assign({}, record, {
      items: (record.items || []).filter(function(item){ return !isRetiredDemoProduct(item); })
    });
  }).filter(function(record){ return record.items.length; });
  Object.keys(favoriteGroups).forEach(function(key) {
    if (RETIRED_DEMO_KEYS.has(key)) delete favoriteGroups[key];
  });

  writeStore('teknikelCurrentBasket', basket);
  writeStore('teknikelFavorites', favorites);
  writeStore('teknikelRecentProducts', recentProducts);
  writeStore('teknikelSavedBaskets', savedBaskets);
  writeStore('teknikelOfferHistory', offerHistory);
  writeStore('teknikelFavoriteGroups', favoriteGroups);
}

removeRetiredDemoData();

function mapSecureSheet(cfg, rows) {
  if (!Array.isArray(rows)) return null;
  return rows.slice(2)
    .filter(function(row){ return row && row[cfg.n] !== undefined && String(row[cfg.n]).trim(); })
    .map(function(row) {
      var barcodeValue = row[cfg.b];
      var barcodeNumber = Number(barcodeValue);
      return {
        barcode: barcodeValue === null || barcodeValue === undefined ? '' :
          ((!isNaN(barcodeNumber) && isFinite(barcodeNumber)) ? String(Math.round(barcodeNumber)) : String(barcodeValue).trim()),
        name: String(row[cfg.n] || ''),
        price: row[cfg.p] === undefined || row[cfg.p] === '' ? null : row[cfg.p],
        updated: cfg.u !== null && row[cfg.u] !== undefined ? row[cfg.u] : null,
        stock: cfg.s !== null && row[cfg.s] !== undefined && row[cfg.s] !== '' ? Number(row[cfg.s]) : null,
        sheet: cfg.name
      };
    });
}

async function fetchSecureInventory() {
  if (!isUsableCredential(googleIdToken)) throw new Error('Oturum süresi doldu.');
  const response = await fetch(INVENTORY_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ idToken: googleIdToken }),
    cache: 'no-store',
    redirect: 'follow'
  });
  if (!response.ok) throw new Error('Güvenli veri servisi yanıt vermedi.');
  const payload = await response.json();
  if (!payload || !payload.ok || !payload.sheets) throw new Error(payload && payload.error ? payload.error : 'Yetkilendirme başarısız.');
  return SHEETS.map(function(cfg){ return mapSecureSheet(cfg, payload.sheets[cfg.name]); });
}

function setLastSync(value, cached) {
  var el = document.getElementById('lastSyncText');
  var statEl = document.getElementById('statLastSync');
  if (!value) {
    el.textContent = 'Son veri kontrolü başarısız';
    if (statEl) statEl.textContent = 'Bağlantı yok';
    return;
  }
  var syncDate = new Date(value);
  el.textContent = (cached ? 'Önbellek: ' : 'Son yenileme: ') + syncDate.toLocaleString('tr-TR');
  if (statEl) statEl.textContent = syncDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function updateOverviewStats() {
  var productStat = document.getElementById('statProductCount');
  if (productStat) productStat.textContent = products.length ? products.length.toLocaleString('tr-TR') : '—';
}

async function loadData(manual) {
  if (isLoadingData) return;
  isLoadingData = true;
  var refreshBtn = document.getElementById('refreshDataBtn');
  refreshBtn.classList.add('loading');
  refreshBtn.textContent = '↻ Yenileniyor';
  document.getElementById('infoBox').innerHTML = '<span class="skeleton-line"></span>';
  try {
    const results = await fetchSecureInventory();
    const failedCount = results.filter(function(result){ return result === null; }).length;
    products = results.filter(Array.isArray).flat();
    if (!products.length) throw new Error('Hiçbir ürün sayfası yüklenemedi');
    applyPriceChanges();
    var syncedAt = new Date().toISOString();
    populateCategories();
    populateBrands();
    renderCriticalStocks();
    renderQuickLists();
    updateOverviewStats();
    setLastSync(syncedAt, false);
    document.getElementById('infoBox').textContent = products.length + ' ürün yüklendi.' +
      (failedCount ? ' ' + failedCount + ' sayfa yüklenemedi.' : '');
    if (manual) showToast('Ürün verileri yenilendi.');
  } catch(e) {
    products = [];
    populateCategories();
    populateBrands();
    renderCriticalStocks();
    renderQuickLists();
    updateOverviewStats();
    document.getElementById('infoBox').textContent = 'Ürün verisi alınamadı: ' + e.message;
    setLastSync('', false);
    showToast('Güvenli ürün verisi alınamadı.');
    if (/oturum|erişim izni|doğrulama|yetkilendirme/i.test(String(e.message || ''))) {
      showAuthGate(e.message + ' Lütfen yeniden giriş yapın.', true);
    }
  } finally {
    isLoadingData = false;
    refreshBtn.classList.remove('loading');
    refreshBtn.textContent = '↻ Veriyi yenile';
  }
}

function refreshData() {
  loadData(true);
}

function openAddProductModal() {
  if (!isUsableCredential(googleIdToken) && !isLocalDesignPreview()) {
    showToast('Ürün eklemek için Google hesabınızla yeniden giriş yapın.');
    return;
  }
  document.getElementById('addProductForm').reset();
  updateAddProductSheetFields();
  openModal('addProductModal');
  requestAnimationFrame(function() {
    document.getElementById('newProductCode').focus();
  });
}

function closeAddProductModal() {
  closeModal('addProductModal');
}

function updateAddProductSheetFields() {
  var sheetName = document.getElementById('newProductSheet').value;
  var stockInput = document.getElementById('newProductStock');
  var stockField = document.getElementById('newProductStockField');
  var hint = document.getElementById('newProductSheetHint');
  var currencySelect = document.getElementById('newProductCurrency');
  var supportsStock = sheetName === 'Envanter';
  var defaultCurrencies = {
    'Envanter': 'TRY',
    'Trafimet': 'EUR',
    'MW Torç ve Sarfları': 'USD',
    'MW Kaynak Makinaları': 'USD',
    'Kaynak Tamamlayıcı Ürünler': 'USD',
    'Özlü Teller': 'USD',
    'Örtülü Elektrodlar': 'TRY',
    'MIG-MAG ve TIG Telleri': 'TRY'
  };

  stockInput.disabled = !supportsStock;
  stockInput.required = supportsStock;
  stockField.classList.toggle('is-disabled', !supportsStock);
  currencySelect.value = defaultCurrencies[sheetName] || 'TRY';
  hint.textContent = supportsStock
    ? 'Stok bilgisi Envanter sayfasına kaydedilir.'
    : 'Bu sayfada stok sütunu yoktur; ürün kodu, adı ve TL fiyatı kaydedilir.';
  updateAddProductCurrencyHint();
}

function updateAddProductCurrencyHint() {
  var currency = document.getElementById('newProductCurrency').value;
  var hint = document.getElementById('newProductCurrencyHint');
  if (currency === 'EUR') {
    hint.textContent = 'Euro tutarı kaydedilir; sitedeki TL fiyatı güncel EUR/TRY kuruyla otomatik hesaplanır.';
  } else if (currency === 'USD') {
    hint.textContent = 'Dolar tutarı kaydedilir; sitedeki TL fiyatı güncel USD/TRY kuruyla otomatik hesaplanır.';
  } else {
    hint.textContent = 'TL fiyatı doğrudan kaydedilir.';
  }
}

async function submitAddProduct(event) {
  event.preventDefault();
  if (!isUsableCredential(googleIdToken)) {
    closeAddProductModal();
    showAuthGate('Oturum süresi doldu. Lütfen yeniden giriş yapın.', true);
    return;
  }

  var form = document.getElementById('addProductForm');
  if (!form.reportValidity()) return;

  var saveBtn = document.getElementById('saveProductBtn');
  var sheetName = document.getElementById('newProductSheet').value;
  var stockInput = document.getElementById('newProductStock');
  var currency = document.getElementById('newProductCurrency').value;
  var product = {
    code: document.getElementById('newProductCode').value.trim(),
    name: document.getElementById('newProductName').value.trim(),
    price: Number(document.getElementById('newProductPrice').value),
    stock: stockInput.disabled ? null : Number(stockInput.value),
    sheet: sheetName,
    currency: currency
  };

  saveBtn.disabled = true;
  saveBtn.textContent = 'Kaydediliyor…';
  try {
    var response = await fetch(INVENTORY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        action: 'addProduct',
        idToken: googleIdToken,
        product: product
      }),
      cache: 'no-store',
      redirect: 'follow'
    });
    if (!response.ok) throw new Error('Güvenli veri servisi yanıt vermedi.');
    var payload = await response.json();
    if (!payload || !payload.ok || payload.action !== 'addProduct') {
      throw new Error(payload && payload.error ? payload.error : 'Ürün kaydedilemedi.');
    }

    closeAddProductModal();
    form.reset();
    await loadData(false);
    var added = products.find(function(item) {
      return item.sheet === sheetName && String(item.barcode) === String(product.code);
    });
    if (added) {
      document.getElementById('searchInput').value = added.name;
      showResult(added);
      addRecentProduct(added);
      showToast('Ürün ' + sheetName + ' sayfasına ' + currency + ' fiyatıyla eklendi ve liste yenilendi.');
    } else {
      showToast('Ürün ' + sheetName + ' sayfasına ' + currency + ' fiyatıyla eklendi. Listeyi yeniden yenileyin.');
    }
  } catch (error) {
    showToast(String(error && error.message || error));
    if (/oturum|erişim izni|doğrulama|yetkilendirme/i.test(String(error && error.message || ''))) {
      closeAddProductModal();
      showAuthGate(String(error.message) + ' Lütfen yeniden giriş yapın.', true);
    }
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '＋ Ürünü kaydet';
  }
}

function populateCategories() {
  var select = document.getElementById('categoryFilter');
  var current = select.value;
  select.innerHTML = '<option value="">Tüm kategoriler</option>' + SHEETS.map(function(s) {
    return '<option value="' + escapeHtml(s.name) + '">' + escapeHtml(s.name) + '</option>';
  }).join('');
  select.value = current;
}

function populateBrands() {
  var select = document.getElementById('brandFilter');
  var current = select.value;
  var counts = {};
  products.forEach(function(product) {
    var brand = getBrand(product);
    if (brand) counts[brand] = (counts[brand] || 0) + 1;
  });
  var brands = Object.keys(counts).sort(function(a, b){ return a.localeCompare(b, 'tr'); });
  select.innerHTML = '<option value="">Tüm markalar</option>' + brands.map(function(brand) {
    return '<option value="' + escapeHtml(brand) + '">' + escapeHtml(brand) + '</option>';
  }).join('');
  select.value = brands.includes(current) ? current : '';
}

function applyPriceChanges() {
  var previous = readStore('teknikelPriceSnapshot', {});
  var next = {};
  products.forEach(function(product) {
    var key = productKey(product);
    var price = Number(product.price);
    if (!isNaN(price) && isFinite(price)) {
      next[key] = price;
      if (Object.prototype.hasOwnProperty.call(previous, key) && Number(previous[key]) !== price) {
        product.previousPrice = Number(previous[key]);
        product.priceChange = price - Number(previous[key]);
      }
    }
  });
  writeStore('teknikelPriceSnapshot', next);
}

function getPriceChangeText(product) {
  if (!product || !Number(product.priceChange)) return 'Değişiklik yok';
  var direction = product.priceChange > 0 ? 'Yükseldi' : 'Düştü';
  return direction + ' · ' + formatPrice(Math.abs(product.priceChange)) +
    ' (önceki ' + formatPrice(product.previousPrice) + ')';
}

function renderCriticalStocks() {
  var list = document.getElementById('criticalStockList');
  var critical = products.filter(function(product) {
    return product.stock !== null && product.stock !== undefined && Number(product.stock) <= 5;
  }).sort(function(a, b){ return Number(a.stock) - Number(b.stock); });
  document.getElementById('criticalStockCount').textContent = critical.length ? critical.length + ' kritik ürün' : 'Kritik stok yok';
  var statEl = document.getElementById('statCriticalCount');
  if (statEl) statEl.textContent = critical.length ? critical.length + ' ürün' : 'Yok';
  if (!critical.length) {
    list.innerHTML = '<span class="quick-empty">Kritik seviyede ürün bulunmuyor.</span>';
    return;
  }
  list.innerHTML = critical.slice(0, 20).map(function(product) {
    var key = encodeURIComponent(productKey(product));
    return '<div class="critical-stock-row"><button data-action="openProductByEncodedKey" data-args="' + encodeURIComponent(JSON.stringify([decodeURIComponent(key)])) + '">' +
      escapeHtml(product.name) + '</button><span>' + escapeHtml(product.sheet) + '</span><strong>' +
      (Number(product.stock) <= 0 ? 'Tükendi' : product.stock + ' adet') + '</strong></div>';
  }).join('');
}

function formatDate(val) {
  if (val === null || val === undefined || val === '') return '—';
  var s = String(val).trim();
  if (s.startsWith('Date(')) {
    var p = s.replace('Date(','').replace(')','').split(',');
    var d = new Date(parseInt(p[0]), parseInt(p[1]), parseInt(p[2]));
    return d.toLocaleDateString('tr-TR');
  }
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    var pts = s.substring(0,10).split('-');
    return pts[2]+'.'+pts[1]+'.'+pts[0];
  }
  return s;
}

function formatPrice(val) {
  if (val == null) return '—';
  var n = Number(val);
  if (isNaN(n)) return String(val);
  return n.toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' ₺';
}

function escapeHtml(val) {
  return String(val == null ? '' : val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getStockInfo(product) {
  if (!product || product.stock === null || product.stock === undefined || isNaN(Number(product.stock))) {
    return { text: 'Fiyat listesi', color: '#52708e' };
  }
  var stock = Number(product.stock);
  if (stock <= 0) return { text: 'Tükendi', color: '#c0392b' };
  if (stock <= 5) return { text: 'Az kaldı · ' + stock, color: '#b7780b' };
  return { text: 'Stokta · ' + stock, color: '#14764f' };
}

function showResult(found) {
  var nameEl   = document.getElementById('resName');
  var priceEl  = document.getElementById('resPrice');
  var statusEl = document.getElementById('resStatus');
  var dateEl   = document.getElementById('resDate');
  var addBtn   = document.getElementById('addBtn');
  var sourceEl = document.getElementById('resSource');
  var favoriteBtn = document.getElementById('favoriteBtn');
  var detailBtn = document.getElementById('detailBtn');
  var priceBadge = document.getElementById('priceChangeBadge');
  var brandChip = document.getElementById('resultBrandChip');
  var categoryChip = document.getElementById('resultCategoryChip');
  var stockChip = document.getElementById('resultStockChip');

  if (found) {
    var stockInfo = getStockInfo(found);
    nameEl.textContent   = found.name || '—';
    priceEl.textContent  = formatPrice(found.price);
    statusEl.textContent = stockInfo.text;
    statusEl.style.color = stockInfo.color;
    dateEl.textContent   = formatDate(found.updated);
    sourceEl.textContent = 'Kaynak: ' + found.sheet + (found.barcode ? ' · Barkod: ' + found.barcode : '');
    brandChip.textContent = getBrand(found) || 'Diğer marka';
    categoryChip.textContent = found.sheet || 'Kategori belirtilmedi';
    stockChip.textContent = stockInfo.text;
    stockChip.className = 'meta-chip ' + (
      found.stock === null || found.stock === undefined || isNaN(Number(found.stock)) ? 'meta-chip--neutral' :
      Number(found.stock) <= 0 ? 'meta-chip--danger' :
      Number(found.stock) <= 5 ? 'meta-chip--warning' : 'meta-chip--ok'
    );
    addBtn.disabled      = false;
    detailBtn.disabled   = false;
    currentProduct       = found;
    var changeText = getPriceChangeText(found);
    priceBadge.textContent = changeText === 'Değişiklik yok' ? 'GÜNCEL KAYIT' : changeText;
    priceBadge.className = found.priceChange > 0 ? 'up' : (found.priceChange < 0 ? 'down' : '');
    var isFavorite = favorites.includes(productKey(found));
    favoriteBtn.classList.toggle('active', isFavorite);
    favoriteBtn.textContent = isFavorite ? '★' : '☆';
    document.querySelector('.result-panel').classList.remove('pulse-result');
    requestAnimationFrame(function(){ document.querySelector('.result-panel').classList.add('pulse-result'); });
  } else {
    nameEl.textContent   = 'Bulunamadı';
    priceEl.textContent  = '—';
    statusEl.textContent = '✗ Bulunamadı';
    statusEl.style.color = '#c0392b';
    dateEl.textContent   = '—';
    sourceEl.textContent = 'Kaynak seçildiğinde burada görünür';
    brandChip.textContent = 'Marka bekleniyor';
    categoryChip.textContent = 'Kategori bekleniyor';
    stockChip.textContent = 'Durum bekleniyor';
    stockChip.className = 'meta-chip meta-chip--neutral';
    favoriteBtn.classList.remove('active');
    favoriteBtn.textContent = '☆';
    addBtn.disabled      = true;
    detailBtn.disabled   = true;
    priceBadge.textContent = 'GÜNCEL KAYIT';
    priceBadge.className = '';
    currentProduct       = null;
  }
}

function openProductDetail() {
  if (!currentProduct) return;
  var stockInfo = getStockInfo(currentProduct);
  document.getElementById('productDetailTitle').textContent = currentProduct.name || 'Ürün bilgileri';
  document.getElementById('detailCategory').textContent = currentProduct.sheet || 'Kategori belirtilmedi';
  document.getElementById('detailPrice').textContent = formatPrice(currentProduct.price);
  document.getElementById('detailBarcode').textContent = currentProduct.barcode || '—';
  document.getElementById('detailStock').textContent = stockInfo.text;
  document.getElementById('detailStock').style.color = stockInfo.color;
  document.getElementById('detailUpdated').textContent = formatDate(currentProduct.updated);
  document.getElementById('detailSource').textContent = currentProduct.sheet || '—';
  document.getElementById('detailPriceChange').textContent = getPriceChangeText(currentProduct);
  document.getElementById('favoriteGroupInput').value = favoriteGroups[productKey(currentProduct)] || '';
  openModal('productDetailModal');
}

function closeProductDetail() {
  closeModal('productDetailModal');
}

function selectProduct(idx) {
  var p = products[idx];
  if (p) {
    document.getElementById('searchInput').value = p.name;
    document.getElementById('suggestions').innerHTML = '';
    showResult(p);
    addRecentProduct(p);
  }
}

function addRecentProduct(product) {
  var key = productKey(product);
  recentProducts = [key].concat(recentProducts.filter(function(item){ return item !== key; })).slice(0, 6);
  writeStore('teknikelRecentProducts', recentProducts);
  renderQuickLists();
}

function toggleCurrentFavorite() {
  if (!currentProduct) { showToast('Önce bir ürün seçin.'); return; }
  var key = productKey(currentProduct);
  if (favorites.includes(key)) {
    favorites = favorites.filter(function(item){ return item !== key; });
    delete favoriteGroups[key];
    writeStore('teknikelFavoriteGroups', favoriteGroups);
    showToast('Favorilerden çıkarıldı.');
  } else {
    favorites.unshift(key);
    favorites = favorites.slice(0, 20);
    showToast('Favorilere eklendi.');
  }
  writeStore('teknikelFavorites', favorites);
  showResult(currentProduct);
  renderQuickLists();
}

function saveFavoriteGroup() {
  if (!currentProduct) return;
  var group = document.getElementById('favoriteGroupInput').value.trim();
  var key = productKey(currentProduct);
  if (!group) {
    delete favoriteGroups[key];
    writeStore('teknikelFavoriteGroups', favoriteGroups);
    showToast('Ürün favori grubundan çıkarıldı.');
    renderQuickLists();
    return;
  }
  favoriteGroups[key] = group;
  if (!favorites.includes(key)) favorites.unshift(key);
  writeStore('teknikelFavoriteGroups', favoriteGroups);
  writeStore('teknikelFavorites', favorites);
  showResult(currentProduct);
  renderQuickLists();
  showToast('Ürün "' + group + '" grubuna kaydedildi.');
}

function openProductByKey(key) {
  var product = products.find(function(item){ return productKey(item) === key; });
  if (!product) { showToast('Ürün güncel listede bulunamadı.'); return; }
  document.getElementById('searchInput').value = product.name;
  showResult(product);
  addRecentProduct(product);
  window.scrollTo({ top: document.querySelector('.search-card').offsetTop - 20, behavior: 'smooth' });
}

function openProductByEncodedKey(encodedKey) {
  openProductByKey(decodeURIComponent(encodedKey));
}

function renderQuickLists() {
  var el = document.getElementById('quickLists');
  var grouped = {};
  favorites.forEach(function(key) {
    var group = favoriteGroups[key] || 'Favoriler';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(key);
  });
  var favoriteItems = Object.keys(grouped).map(function(group) {
    var chips = grouped[group].slice(0, 6).map(function(key) {
      var product = products.find(function(item){ return productKey(item) === key; });
      return product ? '<button class="product-chip favorite" data-action="openProductByEncodedKey" data-args="' + encodeURIComponent(JSON.stringify([encodeURIComponent(key)])) + '">★ ' + escapeHtml(product.name) + '</button>' : '';
    }).join('');
    return chips ? '<span class="favorite-group-title">' + escapeHtml(group) + '</span>' + chips : '';
  }).join('');
  var recentItems = recentProducts.slice(0, 4).map(function(key) {
    var product = products.find(function(item){ return productKey(item) === key; });
    return product && !favorites.includes(key) ? '<button class="product-chip" data-action="openProductByEncodedKey" data-args="' + encodeURIComponent(JSON.stringify([encodeURIComponent(key)])) + '">' + escapeHtml(product.name) + '</button>' : '';
  }).join('');
  el.innerHTML = favoriteItems + recentItems || '<span class="quick-empty">Henüz favori veya son arama yok.</span>';
}

function search(q) {
  q = q.trim();
  var sugEl = document.getElementById('suggestions');
  var filtersActive = document.getElementById('categoryFilter').value ||
    document.getElementById('brandFilter').value ||
    document.getElementById('stockFilter').value ||
    document.getElementById('minPriceFilter').value ||
    document.getElementById('maxPriceFilter').value;

  if (!q && !filtersActive) {
    document.getElementById('resName').textContent   = '—';
    document.getElementById('resPrice').textContent  = '—';
    document.getElementById('resStatus').textContent = 'Bekliyor...';
    document.getElementById('resStatus').style.color = '#888';
    document.getElementById('resDate').textContent   = '—';
    document.getElementById('resSource').textContent = 'Kaynak seçildiğinde burada görünür';
    document.getElementById('favoriteBtn').classList.remove('active');
    document.getElementById('favoriteBtn').textContent = '☆';
    document.getElementById('addBtn').disabled       = true;
    document.getElementById('detailBtn').disabled    = true;
    document.getElementById('priceChangeBadge').textContent = 'GÜNCEL KAYIT';
    document.getElementById('priceChangeBadge').className = '';
    currentProduct = null;
    sugEl.innerHTML = '';
    return;
  }

  var category = document.getElementById('categoryFilter').value;
  var brand = document.getElementById('brandFilter').value;
  var stockMode = document.getElementById('stockFilter').value;
  var minPrice = Number(document.getElementById('minPriceFilter').value);
  var maxPrice = Number(document.getElementById('maxPriceFilter').value);
  var hasMin = document.getElementById('minPriceFilter').value !== '';
  var hasMax = document.getElementById('maxPriceFilter').value !== '';
  var pool = products.filter(function(p) {
    if (category && p.sheet !== category) return false;
    if (brand && getBrand(p) !== brand) return false;
    var stockKnown = p.stock !== null && p.stock !== undefined && !isNaN(Number(p.stock));
    if (stockMode === 'available' && (!stockKnown || Number(p.stock) <= 0)) return false;
    if (stockMode === 'critical' && (!stockKnown || Number(p.stock) < 0 || Number(p.stock) > 5)) return false;
    if (stockMode === 'out' && (!stockKnown || Number(p.stock) > 0)) return false;
    if (stockMode === 'priced' && stockKnown) return false;
    var price = Number(p.price);
    if (hasMin && (isNaN(price) || price < minPrice)) return false;
    if (hasMax && (isNaN(price) || price > maxPrice)) return false;
    return true;
  });
  var exact = q ? pool.find(function(p){ return p.barcode === q; }) : null;
  if (exact) { showResult(exact); addRecentProduct(exact); sugEl.innerHTML = ''; return; }

  var scoredMatches = pool.map(function(product) {
    var result = scoreProductSearch(product, q);
    return { product: product, score: result.score, fuzzy: result.fuzzy };
  }).filter(function(item) {
    return item.score > 0;
  }).sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.product.name).localeCompare(String(b.product.name), 'tr-TR');
  });

  var fuzzyUsed = scoredMatches.length > 0 && scoredMatches.every(function(item){ return item.fuzzy; });
  var matches = scoredMatches.map(function(item){ return item.product; });

  if (matches.length === 0) { showResult(null); sugEl.innerHTML = ''; return; }

  showResult(matches[0]);
  if (matches.length === 1) { sugEl.innerHTML = ''; return; }

  var html = '<div class="sug-count">' + (fuzzyUsed ? 'Benzer ' : '') + matches.length + ' eşleşme — seçin:</div>';
  html += matches.slice(0, 30).map(function(p) {
    var idx = products.indexOf(p);
    return '<button type="button" class="sug-item" data-action="selectProduct" data-args="' + encodeURIComponent(JSON.stringify([idx])) + '">' +
      '<span class="sug-name">' + escapeHtml(p.name) +
        '<br><span class="sug-barcode">' + escapeHtml(p.sheet) +
        (p.barcode ? ' · ' + escapeHtml(p.barcode) : '') + '</span>' +
      '</span>' +
      '<span class="sug-price">' + escapeHtml(formatPrice(p.price)) + '</span>' +
      '</button>';
  }).join('');
  sugEl.innerHTML = html;
}

function clearAdvancedFilters() {
  document.getElementById('categoryFilter').value = '';
  document.getElementById('brandFilter').value = '';
  document.getElementById('stockFilter').value = '';
  document.getElementById('minPriceFilter').value = '';
  document.getElementById('maxPriceFilter').value = '';
  search(document.getElementById('searchInput').value);
  showToast('Filtreler temizlendi.');
}

function addToBasket() {
  if (!currentProduct) return;
  var qtyEl = document.getElementById('qtyInput');
  var qty = parseInt(qtyEl.value, 10);
  if (!Number.isInteger(qty) || qty < 1) qty = 1;
  if (qty > 9999) qty = 9999;
  qtyEl.value = qty;
  var key = currentProduct.name + '|' + currentProduct.sheet;
  var existing = basket.find(i => (i.name + '|' + i.sheet) === key);
  if (existing) {
    existing.qty = Math.min(9999, existing.qty + qty);
  } else {
    basket.push(Object.assign({}, currentProduct, {qty: qty}));
  }
  currentOfferNumber = '';
  addRecentProduct(currentProduct);
  writeStore('teknikelCurrentBasket', basket);
  renderBasket(); updateBadge();
  document.getElementById('searchInput').value = '';
  document.getElementById('qtyInput').value = 1;
  document.getElementById('suggestions').innerHTML = '';
  search('');
  showToast('Ürün sepete eklendi.');
  showTab('sepet');
}

function removeFromBasket(idx) {
  basket.splice(idx, 1);
  currentOfferNumber = '';
  writeStore('teknikelCurrentBasket', basket);
  renderBasket(); updateBadge();
  showToast('Ürün sepetten çıkarıldı.');
}

function changeBasketQty(idx, delta) {
  var item = basket[idx];
  if (!item) return;
  item.qty = Math.max(1, Math.min(9999, Number(item.qty || 1) + delta));
  currentOfferNumber = '';
  writeStore('teknikelCurrentBasket', basket);
  renderBasket();
  updateBadge();
}

function clearBasket() {
  if (!basket.length) return;
  if (confirm('Sepeti temizlemek istiyor musunuz?')) {
    basket = [];
    currentOfferNumber = '';
    writeStore('teknikelCurrentBasket', basket);
    renderBasket(); updateBadge();
    showToast('Sepet temizlendi.');
  }
}

function renderBasket() {
  var el = document.getElementById('basketWrap');
  if (!basket.length) {
    el.innerHTML = '<div class="empty-basket">Sepet boş<br><span style="font-size:11px">Sorgulama sayfasından ürün ekleyin</span></div>';
    if (document.getElementById('offerModal').classList.contains('active')) closeOfferModal();
    updateMobileBasketSummary();
    return;
  }
  var total = 0;
  var rows = basket.map(function(item, idx) {
    var sub = item.price != null ? Number(item.price) * item.qty : 0;
    total += sub;
    return '<tr class="item-row"><td>' + escapeHtml(item.name) + '</td>' +
      '<td>' + escapeHtml(formatPrice(item.price)) + '</td>' +
      '<td><span class="basket-qty"><button data-action="changeBasketQty" data-args="' + encodeURIComponent(JSON.stringify([idx, -1])) + '" aria-label="Adedi azalt">−</button>' +
            '<strong>' + item.qty + '</strong><button data-action="changeBasketQty" data-args="' + encodeURIComponent(JSON.stringify([idx, 1])) + '" aria-label="Adedi artır">+</button></span></td>' +
      '<td>' + (item.price != null ? formatPrice(sub) : '—') + '</td>' +
      '<td><button class="del-btn" data-action="removeFromBasket" data-args="' + encodeURIComponent(JSON.stringify([idx])) + '">✕</button></td></tr>';
  }).join('');

  var iskonto       = total * (iskontoOrani / 100);
  var iskontoluToplam = total - iskonto;
  var kdvDahil      = iskontoluToplam * 1.20;

  el.innerHTML = '<table class="basket-tbl">' +
    '<thead><tr><th>Ürün</th><th>Fiyat</th><th>Adet</th><th>Toplam</th><th></th></tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '<tfoot>' +
    (iskontoOrani > 0 ? '<tr class="iskonto"><td colspan="3" style="text-align:right;padding-right:10px">%' + iskontoOrani + ' İskonto</td><td colspan="2">-' + formatPrice(iskonto) + '</td></tr>' +
    '<tr class="iskonto-sonrasi"><td colspan="3" style="text-align:right;padding-right:10px">İskonto Sonrası Toplam</td><td colspan="2">' + formatPrice(iskontoluToplam) + '</td></tr>' : '') +
    '<tr class="kdv-dahil"><td colspan="3" style="text-align:right;padding-right:10px">KDV Dahil Toplam (%20)</td><td colspan="2">' + formatPrice(kdvDahil) + '</td></tr>' +
    '</tfoot></table>';
  updateMobileBasketSummary();
  if (document.getElementById('offerModal').classList.contains('active')) updateOfferSummary();
}

function getBasketTotals() {
  var total = basket.reduce(function(sum, item) {
    return sum + ((Number(item.price) || 0) * (Number(item.qty) || 0));
  }, 0);
  var discount = total * (iskontoOrani / 100);
  var discounted = total - discount;
  return { total: total, discount: discount, discounted: discounted, vatIncluded: discounted * 1.20 };
}

function updateMobileBasketSummary() {
  var summary = document.getElementById('mobileBasketSummary');
  if (!summary) return;
  var count = basket.reduce(function(sum, item){ return sum + (Number(item.qty) || 0); }, 0);
  var totals = getBasketTotals();
  document.getElementById('mobileBasketItems').textContent = count + ' ürün';
  document.getElementById('mobileBasketTotal').textContent = formatPrice(totals.vatIncluded);
  summary.classList.toggle('visible', count > 0);
}

function saveCurrentBasket() {
  if (!basket.length) { showToast('Kaydetmek için sepete ürün ekleyin.'); return; }
  var input = document.getElementById('basketSaveName');
  var name = input.value.trim() || ('Teklif ' + new Date().toLocaleDateString('tr-TR'));
  var record = {
    id: Date.now(),
    name: name.trim(),
    date: new Date().toISOString(),
    discount: iskontoOrani,
    items: basket.map(function(item){ return Object.assign({}, item); })
  };
  savedBaskets.unshift(record);
  savedBaskets = savedBaskets.slice(0, 20);
  writeStore('teknikelSavedBaskets', savedBaskets);
  input.value = '';
  renderSavedBaskets();
  showToast('Sepet kaydedildi.');
}

function renderSavedBaskets() {
  var el = document.getElementById('savedBasketList');
  if (!savedBaskets.length) {
    el.innerHTML = '<span class="quick-empty">Kayıtlı sepet bulunmuyor.</span>';
    return;
  }
  el.innerHTML = savedBaskets.map(function(saved) {
    var count = saved.items.reduce(function(sum, item){ return sum + Number(item.qty || 0); }, 0);
    return '<div class="saved-row">' +
      '<div class="saved-copy"><strong>' + escapeHtml(saved.name) + '</strong><span>' +
      new Date(saved.date).toLocaleString('tr-TR') + ' · ' + count + ' ürün</span></div>' +
      '<button class="mini-btn" data-action="restoreSavedBasket" data-args="' + encodeURIComponent(JSON.stringify([saved.id])) + '">Aç</button>' +
            '<button class="mini-btn danger" data-action="deleteSavedBasket" data-args="' + encodeURIComponent(JSON.stringify([saved.id])) + '">Sil</button></div>';
  }).join('');
}

function restoreSavedBasket(id) {
  var saved = savedBaskets.find(function(item){ return item.id === id; });
  if (!saved) return;
  basket = saved.items.map(function(item){ return Object.assign({}, item); });
  currentOfferNumber = '';
  writeStore('teknikelCurrentBasket', basket);
  applyDiscountValue(saved.discount);
  updateBadge();
  showToast('Kayıtlı sepet açıldı.');
}

function deleteSavedBasket(id) {
  savedBaskets = savedBaskets.filter(function(item){ return item.id !== id; });
  writeStore('teknikelSavedBaskets', savedBaskets);
  renderSavedBaskets();
  showToast('Kayıtlı sepet silindi.');
}

function csvCell(value) {
  return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
}

function downloadCsv(filename, rows) {
  var content = '\uFEFF' + rows.map(function(row){ return row.map(csvCell).join(';'); }).join('\r\n');
  var blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  var link = document.createElement('a');
  var objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function(){ URL.revokeObjectURL(objectUrl); }, 1000);
}

function exportProductsCsv() {
  if (!products.length) { showToast('Aktarılacak ürün bulunamadı.'); return; }
  var rows = [['Barkod', 'Ürün', 'Kategori', 'Marka', 'Fiyat', 'Stok', 'Son güncelleme']];
  products.forEach(function(product) {
    rows.push([
      product.barcode, product.name, product.sheet, getBrand(product), product.price,
      product.stock == null ? '' : product.stock, formatDate(product.updated)
    ]);
  });
  downloadCsv('teknikel-urunler-' + new Date().toISOString().slice(0, 10) + '.csv', rows);
  showToast('Ürün listesi Excel uyumlu olarak indirildi.');
}

function exportBasketCsv() {
  if (!basket.length) { showToast('Aktarmak için sepete ürün ekleyin.'); return; }
  var totals = getBasketTotals();
  var rows = [['Ürün', 'Kategori', 'Birim fiyat', 'Adet', 'Toplam']];
  basket.forEach(function(item) {
    rows.push([item.name, item.sheet, item.price, item.qty, (Number(item.price) || 0) * item.qty]);
  });
  rows.push([], ['İskonto oranı', iskontoOrani + '%'], ['KDV dahil toplam', totals.vatIncluded]);
  downloadCsv('teknikel-sepet-' + new Date().toISOString().slice(0, 10) + '.csv', rows);
  showToast('Sepet Excel uyumlu olarak indirildi.');
}

function ensureOfferNumber() {
  if (currentOfferNumber) return currentOfferNumber;
  var year = new Date().getFullYear();
  var key = 'teknikelOfferSequence_' + year;
  var sequence = Number(readStore(key, 0)) + 1;
  writeStore(key, sequence);
  currentOfferNumber = 'TKL-' + year + '-' + String(sequence).padStart(3, '0');
  return currentOfferNumber;
}

function renderCustomerProfiles() {
  var list = document.getElementById('customerProfiles');
  list.innerHTML = customerProfiles.map(function(profile) {
    return '<option value="' + escapeHtml(profile.name) + '">İskonto %' + Number(profile.discount || 0) + '</option>';
  }).join('');
}

function saveCustomerProfile() {
  var name = document.getElementById('customerName').value.trim();
  if (!name) { showToast('Önce müşteri adını yazın.'); return; }
  customerProfiles = customerProfiles.filter(function(profile) {
    return normalizeText(profile.name) !== normalizeText(name);
  });
  customerProfiles.unshift({ name: name, discount: iskontoOrani });
  customerProfiles = customerProfiles.slice(0, 30);
  writeStore('teknikelCustomerProfiles', customerProfiles);
  renderCustomerProfiles();
  showToast('Müşteri ve iskonto kaydedildi.');
}

function applyCustomerProfile() {
  var name = document.getElementById('customerName').value.trim();
  var profile = customerProfiles.find(function(item) {
    return normalizeText(item.name) === normalizeText(name);
  });
  if (!profile) return;
  applyDiscountValue(profile.discount);
  updateOfferSummary();
  showToast(profile.name + ' için %' + Number(profile.discount || 0) + ' iskonto uygulandı.');
}

function buildOfferText() {
  ensureOfferNumber();
  var customer = document.getElementById('customerName').value.trim() || 'Değerli Müşterimiz';
  var validity = document.getElementById('offerValidity').value;
  var note = document.getElementById('offerNote').value.trim();
  var totals = getBasketTotals();
  var lines = [
    'TEKNİKEL KAYNAK EKİPMANLARI',
    'Fiyat Teklifi',
    'Teklif No: ' + currentOfferNumber,
    'Müşteri: ' + customer,
    validity ? 'Geçerlilik: ' + new Date(validity + 'T12:00:00').toLocaleDateString('tr-TR') : '',
    ''
  ];
  basket.forEach(function(item, index) {
    lines.push((index + 1) + '. ' + item.name + ' — ' + item.qty + ' adet × ' + formatPrice(item.price) +
      ' = ' + formatPrice((Number(item.price) || 0) * item.qty));
  });
  lines.push('', 'Ara toplam: ' + formatPrice(totals.total));
  if (iskontoOrani > 0) lines.push('İskonto (%' + iskontoOrani + '): -' + formatPrice(totals.discount));
  lines.push('KDV dahil toplam: ' + formatPrice(totals.vatIncluded));
  if (note) lines.push('', 'Not: ' + note);
  return lines.filter(function(line, index, arr){ return line !== '' || arr[index - 1] !== ''; }).join('\n');
}

function saveOfferHistory() {
  if (!basket.length) { showToast('Kaydetmek için sepete ürün ekleyin.'); return; }
  ensureOfferNumber();
  var customer = document.getElementById('customerName').value.trim() || 'Müşteri belirtilmedi';
  var record = {
    id: currentOfferNumber,
    customer: customer,
    date: new Date().toISOString(),
    total: getBasketTotals().vatIncluded,
    text: buildOfferText(),
    discount: iskontoOrani,
    items: basket.map(function(item){ return Object.assign({}, item); })
  };
  offerHistory = offerHistory.filter(function(item){ return item.id !== record.id; });
  offerHistory.unshift(record);
  offerHistory = offerHistory.slice(0, 50);
  writeStore('teknikelOfferHistory', offerHistory);
  renderOfferHistory();
  showToast('Teklif geçmişe kaydedildi.');
}

function renderOfferHistory() {
  var el = document.getElementById('offerHistoryList');
  if (!offerHistory.length) {
    el.innerHTML = '<span class="quick-empty">Henüz kaydedilmiş teklif yok.</span>';
    return;
  }
  el.innerHTML = offerHistory.map(function(offer) {
    return '<div class="saved-row"><div class="saved-copy"><strong>' + escapeHtml(offer.id + ' · ' + offer.customer) +
      '</strong><span>' + new Date(offer.date).toLocaleString('tr-TR') + ' · ' + escapeHtml(formatPrice(offer.total)) +
      '</span></div><button class="mini-btn" data-action="copySavedOffer" data-args="' + encodeURIComponent(JSON.stringify([encodeURIComponent(offer.id)])) + '">Kopyala</button><button class="mini-btn danger" data-action="deleteOfferHistory" data-args="' + encodeURIComponent(JSON.stringify([encodeURIComponent(offer.id)])) + '">Sil</button></div>';
  }).join('');
}

function copySavedOffer(encodedId) {
  var id = decodeURIComponent(encodedId);
  var offer = offerHistory.find(function(item){ return item.id === id; });
  if (!offer) return;
  copyText(offer.text, 'Teklif metni kopyalandı.');
}

function deleteOfferHistory(encodedId) {
  var id = decodeURIComponent(encodedId);
  offerHistory = offerHistory.filter(function(item){ return item.id !== id; });
  writeStore('teknikelOfferHistory', offerHistory);
  renderOfferHistory();
  showToast('Teklif geçmişten silindi.');
}

function openOfferModal() {
  if (!basket.length) { showToast('Teklif oluşturmak için sepete ürün ekleyin.'); return; }
  ensureOfferNumber();
  var validity = new Date();
  validity.setDate(validity.getDate() + 7);
  document.getElementById('offerValidity').value = validity.toISOString().slice(0, 10);
  document.getElementById('offerNumber').textContent = currentOfferNumber;
  renderCustomerProfiles();
  updateOfferSummary();
  openModal('offerModal');
}

function closeOfferModal() {
  closeModal('offerModal');
}

function updateOfferSummary() {
  var totals = getBasketTotals();
  document.getElementById('offerSummary').innerHTML =
    '<strong>' + escapeHtml(ensureOfferNumber()) + ' · ' + basket.length + ' kalem ürün</strong><br>' +
    'İskonto: %' + iskontoOrani + ' · KDV dahil toplam: <strong>' + escapeHtml(formatPrice(totals.vatIncluded)) + '</strong>';
}

function copyOffer() {
  copyText(buildOfferText(), 'Teklif metni kopyalandı.');
}

function copyText(text, successMessage) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(function(){ showToast(successMessage); })
      .catch(function(){ copyTextFallback(text, successMessage); });
  } else {
    copyTextFallback(text, successMessage);
  }
}

function copyTextFallback(text, successMessage) {
  var area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand('copy');
    showToast(successMessage);
  } catch (e) {
    showToast('Metin kopyalanamadı.');
  }
  area.remove();
}

function shareOffer() {
  window.open('https://wa.me/?text=' + encodeURIComponent(buildOfferText()), '_blank', 'noopener');
}

function printOffer() {
  if (!basket.length) { showToast('PDF için sepete ürün ekleyin.'); return; }
  var text = escapeHtml(buildOfferText()).replace(/\n/g, '<br>');
  var win = null;
  var objectUrl = null;
  try {
    var html = '<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Teknikel Teklif</title>' +
      '<style>body{font-family:Arial,sans-serif;color:#142033;padding:72px 24px 40px;line-height:1.6;background:#f4f7fb}.back-btn{position:fixed;top:14px;left:14px;z-index:10;display:inline-flex;align-items:center;gap:8px;padding:11px 15px;border:1px solid #cbd9e8;border-radius:999px;background:#fff;color:#12345a;box-shadow:0 8px 22px rgba(18,52,90,.14);font-weight:700;cursor:pointer}.box{border:1px solid #dce5f0;border-radius:16px;padding:24px;max-width:760px;margin:0 auto;background:#fff}h1{color:#12345a;margin:0 0 20px}small{color:#718099}@media print{body{padding:0;background:#fff}.back-btn{display:none}.box{border:0;padding:0;max-width:none}}</style></head>' +
      '<body><button class="back-btn" type="button" id="printBackBtn" aria-label="Envantere geri dön">← Geri</button><div class="box"><h1>Teknikel Fiyat Teklifi</h1><div>' + text + '</div><br><small>Bu belge Akıllı Envanter üzerinden hazırlanmıştır.</small></div>' +
      '<script>(function(){try{var b=document.getElementById("printBackBtn"); if(b) b.addEventListener("click", function(){ window.close(); });}catch(e){}})();</script>' +
      '</body></html>';

    var blob = new Blob([html], { type: 'text/html' });
    objectUrl = URL.createObjectURL(blob);
    win = window.open(objectUrl, '_blank', 'noopener');
    if (!win) { showToast('Yazdırma penceresi açılamadı.'); URL.revokeObjectURL(objectUrl); return; }

    // Try to print when the new window loads, with fallbacks
    try {
      if (win.addEventListener) {
        win.addEventListener('load', function() { setTimeout(function(){ try{ win.print(); } catch(e){} }, 200); }, { once: true });
      }
    } catch (e) {}

    // Fallback attempt after a short delay
    setTimeout(function(){ try{ win.print(); } catch(e){}; setTimeout(function(){ if (objectUrl) URL.revokeObjectURL(objectUrl); }, 1000); }, 500);
  } catch (err) {
    if (win && win.close) try { win.close(); } catch (e) {}
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    showToast('Yazdırma sırasında hata: ' + (err && err.message || err));
  }
}

function openAdminModal() {
  if (!isAdminAccount()) {
    showToast('Yönetim merkezi yalnızca yönetici hesabına açıktır.');
    return;
  }
  openModal('adminModal');
}

function closeAdminModal() {
  closeModal('adminModal');
}

function openAccessModal() {
  if (!isAdminAccount()) {
    showToast('Erişim izni yalnızca yönetici hesabı verebilir.');
    return;
  }
  closeAdminModal();
  document.getElementById('accessForm').reset();
  openModal('accessModal');
  requestAnimationFrame(function() {
    document.getElementById('accessEmail').focus();
  });
}

function closeAccessModal() {
  closeModal('accessModal');
}

async function submitAccessGrant(event) {
  event.preventDefault();
  if (!isAdminAccount() || !isUsableCredential(googleIdToken)) {
    closeAccessModal();
    showAuthGate('Yönetici oturumu gerekli. Lütfen yeniden giriş yapın.', true);
    return;
  }

  var form = document.getElementById('accessForm');
  if (!form.reportValidity()) return;
  var email = document.getElementById('accessEmail').value.trim().toLowerCase();
  var saveBtn = document.getElementById('saveAccessBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'İzin veriliyor…';

  try {
    var response = await fetch(INVENTORY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        action: 'grantAccess',
        idToken: googleIdToken,
        email: email
      }),
      cache: 'no-store',
      redirect: 'follow'
    });
    if (!response.ok) throw new Error('Güvenli veri servisi yanıt vermedi.');
    var payload = await response.json();
    if (!payload || !payload.ok || payload.action !== 'grantAccess') {
      throw new Error(payload && payload.error ? payload.error : 'Erişim izni verilemedi.');
    }

    form.reset();
    closeAccessModal();
    showToast(payload.access && payload.access.alreadyAllowed
      ? email + ' zaten erişim listesinde.'
      : email + ' için erişim izni verildi.');
  } catch (error) {
    showToast(String(error && error.message || error));
    if (/oturum|yönetici|doğrulama|yetkilendirme/i.test(String(error && error.message || ''))) {
      closeAccessModal();
    }
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Erişim izni ver';
  }
}

function applyTheme(theme) {
  var dark = theme === 'dark';
  document.body.classList.toggle('dark', dark);
  document.getElementById('themeBtn').textContent = dark ? 'Açık temaya geç' : 'Koyu temaya geç';
  document.getElementById('themeBtn').setAttribute('aria-label', dark ? 'Açık temayı aç' : 'Koyu temayı aç');
}

function toggleTheme() {
  var next = document.body.classList.contains('dark') ? 'light' : 'dark';
  writeStore('teknikelTheme', next);
  applyTheme(next);
}

function updateBadge() {
  var count = basket.reduce(function(s,i){ return s + (Number(i.qty) || 0); }, 0);
  document.getElementById('sepetTab').innerHTML = count > 0
    ? '🛒 Sepet <span class="badge">' + count + '</span>'
    : '🛒 Sepet';
  updateMobileBasketSummary();
}

function showTab(tab) {
  document.getElementById('tab-sorgu').style.display = tab === 'sorgu' ? 'block' : 'none';
  document.getElementById('tab-sepet').style.display = tab === 'sepet' ? 'block' : 'none';
  var tabs = document.querySelectorAll('.tab');
  tabs[0].className = 'tab ' + (tab === 'sorgu' ? 'active' : 'inactive');
  tabs[1].className = 'tab ' + (tab === 'sepet' ? 'active' : 'inactive');
  tabs[0].setAttribute('aria-selected', tab === 'sorgu' ? 'true' : 'false');
  tabs[1].setAttribute('aria-selected', tab === 'sepet' ? 'true' : 'false');
}

var searchTimer = null;
document.getElementById('searchInput').addEventListener('input', function(e){
  clearTimeout(searchTimer);
  var value = e.target.value;
  searchTimer = setTimeout(function(){ search(value); }, 120);
});
['categoryFilter', 'brandFilter', 'stockFilter', 'minPriceFilter', 'maxPriceFilter'].forEach(function(id) {
  var eventName = id.includes('Price') ? 'input' : 'change';
  document.getElementById(id).addEventListener(eventName, function(){
    search(document.getElementById('searchInput').value);
  });
});
['customerName', 'offerValidity', 'offerNote'].forEach(function(id) {
  document.getElementById(id).addEventListener('input', updateOfferSummary);
});
document.getElementById('customerName').addEventListener('change', applyCustomerProfile);
document.getElementById('offerModal').addEventListener('click', function(e) {
  if (e.target === this) closeOfferModal();
});
document.getElementById('productDetailModal').addEventListener('click', function(e) {
  if (e.target === this) closeProductDetail();
});
document.getElementById('adminModal').addEventListener('click', function(e) {
  if (e.target === this) closeAdminModal();
});
document.getElementById('addProductModal').addEventListener('click', function(e) {
  if (e.target === this) closeAddProductModal();
});
document.getElementById('accessModal').addEventListener('click', function(e) {
  if (e.target === this) closeAccessModal();
});
document.addEventListener('keydown', function(e) {
  var activeModal = document.querySelector('.modal.active');
  if (e.key === 'Tab' && activeModal) {
    var controls = Array.from(activeModal.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]'))
      .filter(function(el){ return el.offsetParent !== null; });
    if (controls.length) {
      var first = controls[0];
      var last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  if (e.key !== 'Escape') return;
  closeOfferModal();
  closeProductDetail();
  closeAdminModal();
  closeAddProductModal();
  closeAccessModal();
  if (document.getElementById('overlay').classList.contains('active')) stopCam();
});

var reader = null;
document.getElementById('scanBtn').addEventListener('click', async function() {
  var scanButton = this;
  scanButton.disabled = true;
  try {
    if (!window.ZXing) showToast('Barkod okuyucu hazırlanıyor...');
    await loadBarcodeLibrary();
    var overlay = document.getElementById('overlay');
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    var hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.QR_CODE, ZXing.BarcodeFormat.CODE_128,
      ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.EAN_13,
      ZXing.BarcodeFormat.EAN_8,  ZXing.BarcodeFormat.UPC_A,
      ZXing.BarcodeFormat.UPC_E,  ZXing.BarcodeFormat.ITF,
      ZXing.BarcodeFormat.CODABAR,ZXing.BarcodeFormat.DATA_MATRIX
    ]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    reader = new ZXing.BrowserMultiFormatReader(hints);
    await reader.decodeFromConstraints(
      { audio: false, video: { facingMode: 'environment', width:{ideal:1920}, height:{ideal:1080} } },
      'video',
      function(result) {
        if (result) {
          var val = result.getText().trim();
          document.getElementById('searchInput').value = val;
          search(val);
          if (navigator.vibrate) navigator.vibrate(90);
          showToast('Barkod okundu.');
          stopCam();
        }
      }
    );
  } catch(e) {
    showToast('Kamera açılamadı: ' + e.message);
    stopCam();
  } finally {
    scanButton.disabled = false;
  }
});

// Bind elements with inline onclick to addEventListener where possible.
// Supports simple calls like fn(), fn(123), fn('str'), fn(this), fn(123, 'a', this),
// multiple statements separated by semicolons, and simple DOM method calls like document.getElementById('id').focus().
(function bindInlineOnclicks(){
  try {
    var elements = Array.from(document.querySelectorAll('[onclick]'));
    elements.forEach(function(el){
      var attr = el.getAttribute('onclick') || '';
      // Split into semicolon-separated statements and parse each
      var statements = attr.split(';').map(function(s){ return s.trim(); }).filter(Boolean);
      if (!statements.length) return;

      var handlers = [];
      var unsafe = false;

      for (var si = 0; si < statements.length; si++) {
        var stmt = statements[si];
        // functionName(args)
        var fnCall = stmt.match(/^\s*([A-Za-z0-9_$]+)\s*\((.*)\)\s*$/);
        if (fnCall) {
          var fnName = fnCall[1];
          var argsText = fnCall[2].trim();
          var fn = window[fnName];
          if (typeof fn !== 'function') { unsafe = true; break; }

          var parsedArgs = [];
          if (argsText.length > 0) {
            var parts = argsText.match(/('(?:\\'|[^'])*'|\"(?:\\\"|[^\"])*\"|[^,]+)/g);
            if (!parts) { unsafe = true; break; }
            for (var pi = 0; pi < parts.length; pi++) {
              var p = parts[pi].trim();
              if (/^this$/i.test(p)) { parsedArgs.push(function(el){ return function(){ return el; }; }(el)); continue; }
              if (/^[-+]?[0-9]*\.?[0-9]+$/.test(p)) { parsedArgs.push(Number(p)); continue; }
              var mstr = p.match(/^['\"]([\s\S]*)['\"]$/);
              if (mstr) { parsedArgs.push(mstr[1].replace(/\\(['\"]) /g,'$1')); continue; }
              unsafe = true; break;
            }
            if (unsafe) break;
          }

          (function(fn, parsedArgs){
            handlers.push(function(e){
              var resolved = parsedArgs.map(function(a){ return (typeof a === 'function' && a.length === 0) ? a() : a; });
              try { fn.apply(el, resolved.length ? resolved : [e]); } catch (err) { console.error('delegated fn error', err); }
            });
          })(fn, parsedArgs);
          continue;
        }

        // document.getElementById('id').method()
        var domMethod = stmt.match(/^\s*document\.getElementById\(['\"]([^'\"]+)['\"]\)\.([A-Za-z0-9_$]+)\s*\(\s*\)\s*$/);
        if (domMethod) {
          (function(id, method){ handlers.push(function(){ try { var t = document.getElementById(id); if (t && typeof t[method] === 'function') t[method](); } catch(e){ console.error('dom method error', e); } }); })(domMethod[1], domMethod[2]);
          continue;
        }

        // Unsupported statement
        unsafe = true; break;
      }

      if (unsafe || !handlers.length) return; // skip complex onclicks for safety

      var marker = 'data-bound-inline';
      if (el.hasAttribute(marker)) return;
      el.addEventListener('click', function(e){
        for (var h = 0; h < handlers.length; h++) {
          try { handlers[h](e); } catch(err) { console.error('handler error', err); }
        }
      });
      el.setAttribute(marker, '1');
      el.removeAttribute('onclick');
    });
  } catch (e) { console.warn('bindInlineOnclicks failed', e); }
})();

  }
});

// Delegated handler for data-action/data-args attributes
(function addDataActionDelegation(){
  function resolveArg(arg, hostEl){
    try {
      if (arg === '__THIS__') return hostEl;
      if (typeof arg === 'string' && arg.indexOf('__QUERY__:') === 0) return document.querySelector(arg.slice(10));
    } catch(e) { /* ignore */ }
    return arg;
  }
  document.addEventListener('click', function(e){
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.getAttribute('data-action');
    if (!action) return;
    e.preventDefault();
    var args = [];
    var argsAttr = el.getAttribute('data-args');
    if (argsAttr) {
      try { args = JSON.parse(argsAttr); } catch(err){ args = [argsAttr]; }
    }
    args = args.map(function(a){ return resolveArg(a, el); });
    var fn = window[action];
    try {
      if (typeof fn === 'function') fn.apply(el, args);
    } catch(err) { console.error('data-action handler error', err); }
    var postFocus = el.getAttribute('data-post-focus');
    if (postFocus) {
      var t = document.querySelector(postFocus);
      if (t && typeof t.focus === 'function') t.focus();
    }
    var postAction = el.getAttribute('data-post-action');
    if (postAction && typeof window[postAction] === 'function') {
      try { window[postAction].call(el); } catch(err){ console.error('post action error', err); }
    }
  }, false);
})();

function stopCam() {
  if (reader) { reader.reset(); reader = null; }
  var overlay = document.getElementById('overlay');
  overlay.classList.remove('active');
  overlay.setAttribute('aria-hidden', 'true');
}
document.getElementById('closeBtn').addEventListener('click', stopCam);

function updateConnectionState() {
  var pill = document.querySelector('.sync-pill');
  pill.lastChild.textContent = navigator.onLine ? ' Çevrimiçi' : ' Çevrimdışı';
  pill.querySelector('span').style.background = navigator.onLine ? '#53dda2' : '#f6b94b';
}
window.addEventListener('online', function(){ updateConnectionState(); showToast('İnternet bağlantısı geri geldi.'); });
window.addEventListener('offline', function(){ updateConnectionState(); showToast('Çevrimdışı moda geçildi.'); });

window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById('installBtn').style.display = 'inline-flex';
});
document.getElementById('installBtn').addEventListener('click', async function() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  this.style.display = 'none';
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function(){ navigator.serviceWorker.register('service-worker.js?v=14.14').catch(function(){}); });
}

updateConnectionState();
applyTheme(readStore('teknikelTheme', 'light'));
renderBasket();
updateBadge();
renderSavedBaskets();
renderOfferHistory();
renderQuickLists();
renderCustomerProfiles();
if (isLocalDesignPreview()) openLocalDesignPreview();
else initializeAuth();
