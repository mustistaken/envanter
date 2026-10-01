const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Exercise the production functions without starting the browser UI.
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const functions = source.slice(0, source.indexOf('var systemThemeQuery ='));

function harness() {
  const storage = new Map();
  const elements = new Map();
  const documentEvents = new Map();
  const windowEvents = new Map();
  const intervals = [];
  let now = 1_000_000;
  const makeElement = () => ({
    value: '', textContent: '', children: [],
    classList: { add() {}, remove() {} },
    get firstChild() { return this.children[0]; },
    appendChild(child) { this.children.push(child); },
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
  });
  const document = {
    hidden: false,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
    createElement: makeElement,
    addEventListener(name, handler) { documentEvents.set(name, handler); }
  };
  const context = vm.createContext({
    console: { warn() {} },
    document,
    window: { addEventListener(name, handler) { windowEvents.set(name, handler); } },
    navigator: { onLine: true },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); },
      removeItem(key) { storage.delete(key); }
    },
    Date: class extends Date { static now() { return now; } },
    AbortController, URL, URLSearchParams, setTimeout, clearTimeout,
    setInterval(handler, delay) { intervals.push({ handler, delay }); return intervals.length; }
  });
  vm.runInContext(functions, context);
  return { context, document, storage, elements, documentEvents, windowEvents, intervals,
    advance(ms) { now += ms; } };
}

const product = (overrides = {}) => ({
  barcode: 'MA4200-030', name: 'Gerçek ürün', price: 100, stock: null,
  sheet: 'Trafimet', ...overrides
});
const gviz = (rows, status = 'ok') => ({
  ok: true,
  text: async () => 'google.visualization.Query.setResponse(' + JSON.stringify({
    status, table: { rows: rows.map(c => ({ c: c.map(v => v == null ? null : { v }) })) }
  }) + ');'
});

test('Google Sheets headers and catalogue sections are excluded without losing valid products', async () => {
  const { context } = harness();
  context.fetch = async () => gviz([
    ['ÜRÜN KODU', 'ÜRÜN ADI', null, null],
    ['711', 'TIG TORÇLARI', null, null],
    ['702', 'MIG/MAG TORÇ SARFLARI VE AKSESUARLARI', null, null],
    ['701', 'TIG TORÇ SARFLARI VE AKSESUARLARI', null, null],
    ['MA4200-030', 'Gerçek ürün', 10, 100],
    ['SKU-0', 'Ücretsiz ürün', 0, 0],
    ['SKU-WAIT', 'Fiyatı beklenen gerçek ürün', null, null],
    [null, 'Barkodsuz fiyatlı ürün', 5, 50]
  ]);
  const result = await context.fetchSheet({ name: 'Trafimet', b: 0, n: 1, p: 3, u: null, s: null });
  assert.deepEqual(Array.from(result, p => p.name), [
    'Gerçek ürün', 'Ücretsiz ürün', 'Fiyatı beklenen gerçek ürün', 'Barkodsuz fiyatlı ürün'
  ]);
  assert.equal(result[1].price, 0);
  assert.equal(context.isProductRecord(product({ sheet: 'Envanter', barcode: '123', price: null, stock: 5 })), true);
  assert.equal(context.isProductRecord(product({ barcode: '  Ürün Kodu  ' })), false);
});

test('cached headers are removed and a cache containing only headings is not used', () => {
  const { context, storage } = harness();
  const heading = product({ sheet: 'Envanter', barcode: 'ÜRÜN KODU', name: 'ÜRÜN ADI', price: null });
  const write = products => storage.set('teknikelProductSnapshot', JSON.stringify({ products, syncedAt: '2026-09-30T21:00:00Z' }));
  write([heading, product()]);
  assert.equal(context.readProductSnapshot().products.length, 1);
  write([heading]);
  assert.equal(context.readProductSnapshot(), null);
});

test('a heading cannot be added to the basket even if it was previously selected', () => {
  const { context } = harness();
  vm.runInContext('currentProduct = ' + JSON.stringify(product({
    barcode: 'ÜRÜN KODU', name: 'ÜRÜN ADI', sheet: 'Envanter', price: null
  })), context);
  context.addToBasket();
  assert.equal(vm.runInContext('basket.length', context), 0);
});

test('manual and automatic refresh share one in-flight request and refresh again after completion', async () => {
  const { context } = harness();
  const calls = [];
  let release;
  context.loadData = manual => { calls.push(['products', manual]); return new Promise(resolve => { release = resolve; }); };
  context.loadExchangeRates = async () => { calls.push(['rates']); };
  const first = context.refreshData();
  assert.equal(context.refreshLiveData(false), first);
  assert.deepEqual(calls, [['products', true], ['rates']]);
  release();
  await first;
  const next = context.refreshLiveData(false);
  assert.deepEqual(calls, [['products', true], ['rates'], ['products', false], ['rates']]);
  release();
  await next;
});

test('five-minute refresh pauses offline or hidden and resumes after returning to the app', async () => {
  const h = harness();
  let calls = 0;
  h.context.loadData = async () => { calls++; };
  h.context.loadExchangeRates = async () => {};
  await h.context.refreshLiveData(false);
  h.context.startAutoRefresh();
  h.context.startAutoRefresh();
  assert.equal(h.intervals.length, 1);
  assert.equal(h.intervals[0].delay, 300_000);
  h.advance(299_999);
  h.intervals[0].handler();
  assert.equal(calls, 1);
  h.advance(1);
  h.document.hidden = true;
  h.intervals[0].handler();
  assert.equal(calls, 1);
  h.document.hidden = false;
  h.context.navigator.onLine = false;
  h.documentEvents.get('visibilitychange')();
  assert.equal(calls, 1);
  h.context.navigator.onLine = true;
  await h.documentEvents.get('visibilitychange')();
  assert.equal(calls, 2);
  await h.windowEvents.get('online')();
  await Promise.resolve();
  assert.equal(calls, 3);
});

test('invalid or failed rate responses show placeholders and preserve the last successful values', async () => {
  const { context, elements } = harness();
  context.fetch = async () => { throw new Error('offline'); };
  await context.loadExchangeRates();
  assert.equal(elements.get('eurTryRate').textContent, '—');
  assert.equal(elements.get('usdTryRate').textContent, '—');
  context.fetch = async url => {
    assert.match(url, /sheet=Kurlar/);
    return gviz([['EUR', 55.63], ['USD', 49]]);
  };
  await context.loadExchangeRates();
  assert.equal(elements.get('eurTryRate').textContent, '55,63 ₺');
  context.fetch = async () => gviz([['EUR', null], ['USD', 49]]);
  await context.loadExchangeRates();
  assert.equal(elements.get('eurTryRate').textContent, '55,63 ₺');
  assert.match(elements.get('exchangeRateDate').textContent, /^Son kayıt/);
});

test('Google Sheets error responses are reported as failed reads rather than empty catalogues', async () => {
  const { context } = harness();
  context.fetch = async () => gviz([], 'error');
  assert.equal(await context.fetchSheet({ name: 'Trafimet', b: 0, n: 1, p: 3, u: null, s: null }), null);
});

test('a partial background refresh preserves newer in-memory data and the full cache', async () => {
  const { context, storage } = harness();
  const cached = { products: [product({ price: 90 })], syncedAt: '2026-09-30T21:00:00Z' };
  const cacheText = JSON.stringify(cached);
  storage.set('teknikelProductSnapshot', cacheText);
  vm.runInContext('products = ' + JSON.stringify([product({ price: 100 })]), context);
  context.fetchSheet = async cfg => cfg.name === 'Trafimet' ? null : [];
  context.applyProductSnapshot = snapshot => {
    vm.runInContext('products = ' + JSON.stringify(snapshot.products), context);
  };
  context.showToast = () => {};
  await context.loadData(false);
  assert.equal(vm.runInContext('products[0].price', context), 100);
  assert.equal(storage.get('teknikelProductSnapshot'), cacheText);
});


test('old external-provider rate cache is never used as a Sheet rate', async () => {
  const { context, storage, elements } = harness();
  storage.set('teknikelExchangeRates', JSON.stringify({eurTry: 60, usdTry: 50, date: '2026-10-01'}));
  context.fetch = async () => { throw new Error('offline'); };
  await context.loadExchangeRates();
  assert.equal(elements.get('eurTryRate').textContent, '—');
});

test('absent or invalid stock is unknown; actual zero remains a critical stock', async () => {
  const { context, elements } = harness();
  context.fetch = async () => gviz([
    ['A', 'Boş stok', 100, null], ['B', 'Hatalı stok', 100, 'hata'], ['C', 'Sıfır stok', 100, 0]
  ]);
  const result = await context.fetchSheet({ name: 'Envanter', b:0, n:1, p:2, s:3, u:null });
  assert.deepEqual(Array.from(result, p => p.stock), [null, null, 0]);
  vm.runInContext('products = ' + JSON.stringify(result.slice(0,2)), context);
  context.renderCriticalStocks();
  assert.equal(elements.get('statCriticalCount').textContent, 'Stok bilgisi yok');
  vm.runInContext('products = ' + JSON.stringify([product({stock: 20})]), context);
  context.renderCriticalStocks();
  assert.equal(elements.get('statCriticalCount').textContent, 'Yok');
});

test('basket prices remain fixed until explicit update and missing products are preserved', () => {
  const { context, storage, elements } = harness();
  const items = [product({price: 90, qty: 3}), product({barcode: 'MISSING', price: 40, qty: 2})];
  vm.runInContext('basket = ' + JSON.stringify(items) + '; products = ' + JSON.stringify([product({price:100})]) + '; iskontoOrani = 15;', context);
  context.renderBasketPriceWarning();
  assert.equal(vm.runInContext('basket[0].price', context), 90);
  assert.equal(elements.get('basketPriceWarning').hidden, false);
  assert.match(elements.get('basketPriceWarningText').textContent, /1 ürünün fiyatı/);
  assert.match(elements.get('basketPriceWarningText').textContent, /1 ürünün güncel fiyatı bulunamadı/);
  context.renderBasket = () => context.renderBasketPriceWarning();
  context.updateBadge = () => {};
  context.showToast = () => {};
  context.updateBasketPrices();
  assert.equal(vm.runInContext('basket[0].price', context), 100);
  assert.equal(vm.runInContext('basket[0].qty', context), 3);
  assert.equal(vm.runInContext('basket[1].price', context), 40);
  assert.equal(vm.runInContext('iskontoOrani', context), 15);
  assert.equal(JSON.parse(storage.get('teknikelCurrentBasket'))[0].price,100);
  assert.equal(elements.get('updateBasketPricesBtn').hidden, true);
});

test('basket comparison uses billed cents and supports zero-price changes', () => {
  const { context } = harness();
  vm.runInContext('basket = ' + JSON.stringify([product({price: 100.001})]) + '; products = ' + JSON.stringify([product({price:100.004})]), context);
  assert.equal(context.getBasketPriceChanges().length, 0);
  vm.runInContext('products[0].price = 0', context);
  assert.equal(context.getBasketPriceChanges()[0].price, 0);
});
