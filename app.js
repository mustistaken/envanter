const GOOGLE_CLIENT_ID = '334267311865-5oqahpjifptf1j67httml63h0gvq0g38.apps.googleusercontent.com';
const INVENTORY_API_URL = 'https://script.google.com/macros/s/AKfycbxyCdJ0btfjuZgGF5X0Up7ugD2qEMr-jQHVKtPp-MI466roWtnDb0hPweI71iknVOXBvA/exec';
const AUTH_TOKEN_KEY = 'teknikelGoogleIdToken';
let googleIdToken = '';
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

function unlockApp(token) {
  var payload = decodeGoogleCredential(token);
  googleIdToken = token;
  writeSession(AUTH_TOKEN_KEY, token);
  document.body.classList.remove('auth-pending');
  document.getElementById('authGate').setAttribute('aria-hidden', 'true');
  document.getElementById('appShell').setAttribute('aria-hidden', 'false');
  document.getElementById('accountEmail').textContent = payload && payload.email ? payload.email : 'Google hesabı';
  loadData();
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
  document.getElementById('statProductCount').textContent = '3.334';
  document.getElementById('statCriticalCount').textContent = 'Canlı veride';
  document.getElementById('statLastSync').textContent = 'Şimdi';
  document.getElementById('lastSyncText').textContent = 'Yerel tasarım önizlemesi';
  document.getElementById('criticalStockCount').textContent = 'Canlı veride hesaplanır';
  document.getElementById('criticalStockList').innerHTML =
    '<span class="quick-empty">Gerçek stok bilgileri yalnızca güvenli canlı sitede gösterilir.</span>';
  document.getElementById('infoBox').textContent =
    'Tasarım önizlemesi · Google Sheets ve Apps Script bağlantısı canlı sitede aynen korunur.';
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
  d…4599 tokens truncated…r class="kdv-dahil"><td colspan="3" style="text-align:right;padding-right:10px">KDV Dahil Toplam (%20)</td><td colspan="2">' + formatPrice(kdvDahil) + '</td></tr>' +
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
      '<button class="mini-btn" onclick="restoreSavedBasket(' + saved.id + ')">Aç</button>' +
      '<button class="mini-btn danger" onclick="deleteSavedBasket(' + saved.id + ')">Sil</button></div>';
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
      '</span></div><button class="mini-btn" onclick="copySavedOffer(\'' + encodeURIComponent(offer.id) +
      '\')">Kopyala</button><button class="mini-btn danger" onclick="deleteOfferHistory(\'' +
      encodeURIComponent(offer.id) + '\')">Sil</button></div>';
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
  var win = window.open('', '_blank');
  if (!win) { showToast('Yazdırma penceresi açılamadı.'); return; }
  win.document.write('<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Teknikel Teklif</title>' +
    '<style>body{font-family:Arial,sans-serif;color:#142033;padding:72px 24px 40px;line-height:1.6;background:#f4f7fb}.back-btn{position:fixed;top:14px;left:14px;z-index:10;display:inline-flex;align-items:center;gap:8px;padding:11px 15px;border:1px solid #cbd9e8;border-radius:999px;background:#fff;color:#12345a;box-shadow:0 8px 22px rgba(18,52,90,.14);font-weight:700;cursor:pointer}.box{border:1px solid #dce5f0;border-radius:16px;padding:24px;max-width:760px;margin:0 auto;background:#fff}h1{color:#12345a;margin:0 0 20px}small{color:#718099}@media print{body{padding:0;background:#fff}.back-btn{display:none}.box{border:0;padding:0;max-width:none}}</style></head>' +
    '<body><button class="back-btn" type="button" onclick="window.close()" aria-label="Envantere geri dön">← Geri</button><div class="box"><h1>Teknikel Fiyat Teklifi</h1><div>' + text + '</div><br><small>Bu belge Akıllı Envanter üzerinden hazırlanmıştır.</small></div>' +
    '</body></html>');
  win.document.close();
  setTimeout(function(){ win.print(); }, 200);
}

function openAdminModal() {
  openModal('adminModal');
}

function closeAdminModal() {
  closeModal('adminModal');
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
  window.addEventListener('load', function(){ navigator.serviceWorker.register('service-worker.js?v=14.0').catch(function(){}); });
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

