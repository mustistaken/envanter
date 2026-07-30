
const SHEET_ID = '1sjSuZf9MufnucsYQbDMnUyanamDdJCpKPmKc0_CvLSU';

let products = [], currentProduct = null, iskontoOrani = 0;
let basket = readStore('teknikelCurrentBasket', []);
let favorites = readStore('teknikelFavorites', []);
let recentProducts = readStore('teknikelRecentProducts', []);
let savedBaskets = readStore('teknikelSavedBaskets', []);
let deferredInstallPrompt = null;
let toastTimer = null;

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
  btn.classList.add('active');
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

const SHEETS = [
  { name: 'Envanter',                    b:0, n:1, p:2,    u:4    },
  { name: 'MW Torç ve Sarfları',         b:0, n:1, p:4,    u:3    },
  { name: 'MW Kaynak Makinaları',        b:0, n:1, p:4,    u:3    },
  { name: 'Trafimet',                    b:0, n:1, p:3,    u:null },
  { name: 'Kaynak Tamamlayıcı Ürünler', b:0, n:1, p:4,    u:null },
  { name: 'Özlü Teller',                b:0, n:1, p:4,    u:null },
  { name: 'MIG-MAG ve TIG Telleri',     b:0, n:1, p:4,    u:null },
  { name: 'Örtülü Elektrodlar',         b:0, n:1, p:4,    u:null },
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

  writeStore('teknikelCurrentBasket', basket);
  writeStore('teknikelFavorites', favorites);
  writeStore('teknikelRecentProducts', recentProducts);
  writeStore('teknikelSavedBaskets', savedBaskets);
}

removeRetiredDemoData();

async function fetchSheet(cfg) {
  const url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
              '/gviz/tq?tqx=out:json&sheet=' + encodeURIComponent(cfg.name);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const match = text.match(/setResponse\(([\s\S]*?)\);/);
    if (!match) throw new Error('Geçersiz Google Sheets yanıtı');
    const json = JSON.parse(match[1]);
    return json.table.rows
      .filter(r => r.c && r.c[cfg.n] && r.c[cfg.n].v)
      .map(r => ({
        barcode: r.c[cfg.b] ? (function(v){ var n=Number(v); return (!isNaN(n)&&isFinite(n)) ? String(Math.round(n)) : String(v).trim(); })(r.c[cfg.b].v) : '',
        name:    String(r.c[cfg.n].v || ''),
        price:   r.c[cfg.p] ? r.c[cfg.p].v : null,
        updated: cfg.u !== null && r.c[cfg.u] ? r.c[cfg.u].v : null,
        sheet:   cfg.name
      }));
  } catch(e) {
    console.warn(cfg.name + ' yüklenemedi:', e);
    return null;
  }
}

async function loadData() {
  document.getElementById('infoBox').innerHTML = '<span class="skeleton-line"></span>';
  try {
    const results = await Promise.all(SHEETS.map(fetchSheet));
    const failedCount = results.filter(function(result){ return result === null; }).length;
    products = results.filter(Array.isArray).flat();
    if (!products.length) throw new Error('Hiçbir ürün sayfası yüklenemedi');
    writeStore('teknikelCachedProducts', products);
    writeStore('teknikelCacheTime', new Date().toISOString());
    populateCategories();
    renderQuickLists();
    document.getElementById('infoBox').textContent = products.length + ' ürün yüklendi.' +
      (failedCount ? ' ' + failedCount + ' sayfa yüklenemedi.' : '');
  } catch(e) {
    products = readStore('teknikelCachedProducts', []).filter(function(item){
      return !isRetiredDemoProduct(item);
    });
    if (products.length) {
      writeStore('teknikelCachedProducts', products);
      populateCategories();
      renderQuickLists();
      var cachedAt = readStore('teknikelCacheTime', '');
      document.getElementById('infoBox').textContent = products.length + ' ürün çevrimdışı önbellekten açıldı' +
        (cachedAt ? ' · ' + new Date(cachedAt).toLocaleString('tr-TR') : '');
      showToast('İnternet yok; son kaydedilen ürün listesi kullanılıyor.');
    } else {
      products = [];
      writeStore('teknikelCachedProducts', products);
      populateCategories();
      renderQuickLists();
      document.getElementById('infoBox').textContent = 'Ürün verisi alınamadı. Google Sheets erişimini kontrol edin.';
      showToast('Ürün verisi alınamadı; demo ürün gösterilmiyor.');
    }
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

function showResult(found) {
  var nameEl   = document.getElementById('resName');
  var priceEl  = document.getElementById('resPrice');
  var statusEl = document.getElementById('resStatus');
  var dateEl   = document.getElementById('resDate');
  var addBtn   = document.getElementById('addBtn');
  var sourceEl = document.getElementById('resSource');
  var favoriteBtn = document.getElementById('favoriteBtn');

  if (found) {
    nameEl.textContent   = found.name || '—';
    priceEl.textContent  = formatPrice(found.price);
    statusEl.textContent = '✓ Bulundu';
    statusEl.style.color = '#1a7a4a';
    dateEl.textContent   = formatDate(found.updated);
    sourceEl.textContent = 'Kaynak: ' + found.sheet + (found.barcode ? ' · Barkod: ' + found.barcode : '');
    addBtn.disabled      = false;
    currentProduct       = found;
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
    favoriteBtn.classList.remove('active');
    favoriteBtn.textContent = '☆';
    addBtn.disabled      = true;
    currentProduct       = null;
  }
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
  var favoriteItems = favorites.slice(0, 4).map(function(key) {
    var product = products.find(function(item){ return productKey(item) === key; });
    return product ? '<button class="product-chip favorite" onclick="openProductByEncodedKey(\'' + encodeURIComponent(key) + '\')">★ ' + escapeHtml(product.name) + '</button>' : '';
  }).join('');
  var recentItems = recentProducts.slice(0, 4).map(function(key) {
    var product = products.find(function(item){ return productKey(item) === key; });
    return product && !favorites.includes(key) ? '<button class="product-chip" onclick="openProductByEncodedKey(\'' + encodeURIComponent(key) + '\')">' + escapeHtml(product.name) + '</button>' : '';
  }).join('');
  el.innerHTML = favoriteItems + recentItems || '<span class="quick-empty">Henüz favori veya son arama yok.</span>';
}

function search(q) {
  q = q.trim();
  var sugEl = document.getElementById('suggestions');

  if (!q) {
    document.getElementById('resName').textContent   = '—';
    document.getElementById('resPrice').textContent  = '—';
    document.getElementById('resStatus').textContent = 'Bekliyor...';
    document.getElementById('resStatus').style.color = '#888';
    document.getElementById('resDate').textContent   = '—';
    document.getElementById('resSource').textContent = 'Kaynak seçildiğinde burada görünür';
    document.getElementById('favoriteBtn').classList.remove('active');
    document.getElementById('favoriteBtn').textContent = '☆';
    document.getElementById('addBtn').disabled       = true;
    currentProduct = null;
    sugEl.innerHTML = '';
    return;
  }

  var category = document.getElementById('categoryFilter').value;
  var pool = category ? products.filter(function(p){ return p.sheet === category; }) : products;
  var exact = pool.find(function(p){ return p.barcode === q; });
  if (exact) { showResult(exact); addRecentProduct(exact); sugEl.innerHTML = ''; return; }

  var ql = normalizeText(q);
  var tokens = ql.split(' ').filter(Boolean);
  var matches = pool.filter(function(p) {
    var haystack = normalizeText(p.name + ' ' + p.barcode + ' ' + p.sheet);
    return tokens.every(function(token){ return haystack.includes(token); });
  });

  var fuzzyUsed = false;
  if (matches.length === 0 && ql.length >= 4) {
    fuzzyUsed = true;
    matches = pool.map(function(p) {
      var nameScore = similarity(ql, p.name);
      var wordScore = Math.max.apply(null, normalizeText(p.name).split(' ').map(function(word){ return similarity(ql, word); }));
      return { product: p, score: Math.max(nameScore, wordScore) };
    }).filter(function(item){ return item.score >= .38; })
      .sort(function(a,b){ return b.score - a.score; })
      .slice(0, 30)
      .map(function(item){ return item.product; });
  }

  if (matches.length === 0) { showResult(null); sugEl.innerHTML = ''; return; }

  showResult(matches[0]);
  if (matches.length === 1) { sugEl.innerHTML = ''; return; }

  var html = '<div class="sug-count">' + (fuzzyUsed ? 'Benzer ' : '') + matches.length + ' eşleşme — seçin:</div>';
  html += matches.slice(0, 30).map(function(p) {
    var idx = products.indexOf(p);
    return '<div class="sug-item" onclick="selectProduct(' + idx + ')">' +
      '<span class="sug-name">' + escapeHtml(p.name) +
        '<br><span class="sug-barcode">' + escapeHtml(p.sheet) +
        (p.barcode ? ' · ' + escapeHtml(p.barcode) : '') + '</span>' +
      '</span>' +
      '<span class="sug-price">' + escapeHtml(formatPrice(p.price)) + '</span>' +
      '</div>';
  }).join('');
  sugEl.innerHTML = html;
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
  writeStore('teknikelCurrentBasket', basket);
  renderBasket(); updateBadge();
  showToast('Ürün sepetten çıkarıldı.');
}

function clearBasket() {
  if (!basket.length) return;
  if (confirm('Sepeti temizlemek istiyor musunuz?')) {
    basket = [];
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
    return;
  }
  var total = 0;
  var rows = basket.map(function(item, idx) {
    var sub = item.price != null ? Number(item.price) * item.qty : 0;
    total += sub;
    return '<tr class="item-row"><td>' + escapeHtml(item.name) + '</td>' +
      '<td>' + escapeHtml(formatPrice(item.price)) + '</td>' +
      '<td>' + item.qty + '</td>' +
      '<td>' + (item.price != null ? formatPrice(sub) : '—') + '</td>' +
      '<td><button class="del-btn" onclick="removeFromBasket(' + idx + ')">✕</button></td></tr>';
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
  iskontoOrani = Number(saved.discount || 0);
  writeStore('teknikelCurrentBasket', basket);
  renderBasket(); updateBadge();
  showToast('Kayıtlı sepet açıldı.');
}

function deleteSavedBasket(id) {
  savedBaskets = savedBaskets.filter(function(item){ return item.id !== id; });
  writeStore('teknikelSavedBaskets', savedBaskets);
  renderSavedBaskets();
  showToast('Kayıtlı sepet silindi.');
}

function buildOfferText() {
  var customer = document.getElementById('customerName').value.trim() || 'Değerli Müşterimiz';
  var validity = document.getElementById('offerValidity').value;
  var note = document.getElementById('offerNote').value.trim();
  var totals = getBasketTotals();
  var lines = [
    'TEKNİKEL KAYNAK EKİPMANLARI',
    'Fiyat Teklifi',
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

function openOfferModal() {
  if (!basket.length) { showToast('Teklif oluşturmak için sepete ürün ekleyin.'); return; }
  var validity = new Date();
  validity.setDate(validity.getDate() + 7);
  document.getElementById('offerValidity').value = validity.toISOString().slice(0, 10);
  updateOfferSummary();
  document.getElementById('offerModal').classList.add('active');
}

function closeOfferModal() {
  document.getElementById('offerModal').classList.remove('active');
}

function updateOfferSummary() {
  var totals = getBasketTotals();
  document.getElementById('offerSummary').innerHTML =
    '<strong>' + basket.length + ' kalem ürün</strong><br>' +
    'İskonto: %' + iskontoOrani + ' · KDV dahil toplam: <strong>' + escapeHtml(formatPrice(totals.vatIncluded)) + '</strong>';
}

function copyOffer() {
  var text = buildOfferText();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function(){ showToast('Teklif metni kopyalandı.'); });
  } else {
    var area = document.createElement('textarea');
    area.value = text; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
    showToast('Teklif metni kopyalandı.');
  }
}

function shareOffer() {
  window.open('https://wa.me/?text=' + encodeURIComponent(buildOfferText()), '_blank', 'noopener');
}

function printOffer() {
  var text = escapeHtml(buildOfferText()).replace(/\n/g, '<br>');
  var win = window.open('', '_blank');
  if (!win) { showToast('Yazdırma penceresi açılamadı.'); return; }
  win.document.write('<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Teknikel Teklif</title>' +
    '<style>body{font-family:Arial,sans-serif;color:#142033;padding:40px;line-height:1.6}h1{color:#12345a;margin:0 0 20px}.box{border:1px solid #dce5f0;border-radius:16px;padding:24px;max-width:760px}small{color:#718099}</style></head>' +
    '<body><div class="box"><h1>Teknikel Fiyat Teklifi</h1><div>' + text + '</div><br><small>Bu belge Akıllı Envanter üzerinden hazırlanmıştır.</small></div>' +
    '</body></html>');
  win.document.close();
  setTimeout(function(){ win.print(); }, 200);
}

function updateBadge() {
  var count = basket.reduce(function(s,i){ return s+i.qty; }, 0);
  document.getElementById('sepetTab').innerHTML = count > 0
    ? '🛒 Sepet <span class="badge">' + count + '</span>'
    : '🛒 Sepet';
}

function showTab(tab) {
  document.getElementById('tab-sorgu').style.display = tab === 'sorgu' ? 'block' : 'none';
  document.getElementById('tab-sepet').style.display = tab === 'sepet' ? 'block' : 'none';
  var tabs = document.querySelectorAll('.tab');
  tabs[0].className = 'tab ' + (tab === 'sorgu' ? 'active' : 'inactive');
  tabs[1].className = 'tab ' + (tab === 'sepet' ? 'active' : 'inactive');
}

var searchTimer = null;
document.getElementById('searchInput').addEventListener('input', function(e){
  clearTimeout(searchTimer);
  var value = e.target.value;
  searchTimer = setTimeout(function(){ search(value); }, 120);
});
document.getElementById('categoryFilter').addEventListener('change', function(){
  search(document.getElementById('searchInput').value);
});
['customerName', 'offerValidity', 'offerNote'].forEach(function(id) {
  document.getElementById(id).addEventListener('input', updateOfferSummary);
});
document.getElementById('offerModal').addEventListener('click', function(e) {
  if (e.target === this) closeOfferModal();
});

var reader = null;
document.getElementById('scanBtn').addEventListener('click', async function() {
  document.getElementById('overlay').classList.add('active');
  try {
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
  } catch(e) { alert('Kamera açılamadı: ' + e.message); stopCam(); }
});

function stopCam() {
  if (reader) { reader.reset(); reader = null; }
  document.getElementById('overlay').classList.remove('active');
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
  window.addEventListener('load', function(){ navigator.serviceWorker.register('service-worker.js?v=4').catch(function(){}); });
}

updateConnectionState();
renderBasket();
updateBadge();
renderSavedBaskets();
renderQuickLists();
loadData();
