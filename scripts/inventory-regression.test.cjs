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
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    setAttribute() {},
    style: {},
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

test('older cache records require currency and catalogue checks; verified cache remains usable offline', () => {
  const {context,storage}=harness();
  function save(item) { storage.set('teknikelProductSnapshot',JSON.stringify({products:[item],syncedAt:'2026-10-01T15:00:00Z'})); }
  save(product());
  assert.equal(context.hasUsablePrice(context.readProductSnapshot().products[0]),false);
  save(product({priceIssue:''}));
  assert.equal(context.hasUsablePrice(context.readProductSnapshot().products[0]),false);
  save(product({priceIssue:'',matchStatus:'Sheet fiyatı'}));
  assert.equal(context.hasUsablePrice(context.readProductSnapshot().products[0]),true);
});

test('rate and product check times use the same Istanbul time for ISO and epoch timestamps', () => {
  const {context,elements}=harness();
  const iso='2026-10-01T15:21:25Z', epoch=Date.parse(iso);
  assert.equal(context.formatCheckTime(iso),context.formatCheckTime(epoch));
  assert.equal(context.formatCheckTime(epoch,true),'18:21');
  context.setLastSync(iso,false);
  context.renderExchangeRates({eurTry:55,usdTry:49,savedAt:epoch},false);
  assert.equal(elements.get('statLastSync').textContent,'18:21');
  assert.equal(elements.get('lastSyncText').textContent.replace('Son yenileme: ',''),elements.get('exchangeRateDate').textContent.replace('Sheet kontrolü · ',''));
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
  assert.match(elements.get('basketPriceWarningText').textContent, /1 ürünün fiyatı veya birimi/);
  assert.match(elements.get('basketPriceWarningText').textContent, /1 ürünün güncel fiyatı doğrulanamadı/);
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

test('invalid prices cannot be added, quoted or exported as zero, while a real zero remains valid', () => {
  const { context } = harness();
  const messages = [];
  context.showToast = text => messages.push(text);
  for (const price of [null, '', ' ', 'hata', -1, Infinity, true]) {
    vm.runInContext('currentProduct = ' + JSON.stringify(product()) + '; currentProduct.price = undefined;', context);
    context.currentProductPrice = price;
    vm.runInContext('currentProduct.price = currentProductPrice', context);
    context.addToBasket();
    assert.equal(vm.runInContext('basket.length', context), 0);
  }
  vm.runInContext('basket = ' + JSON.stringify([product({price:null,qty:1})]), context);
  assert.equal(context.getBasketTotals().complete, false);
  assert.equal(context.getBasketTotals().vatIncluded, null);
  assert.equal(context.buildOfferText(), '');
  let exports = 0;
  context.downloadCsv = () => exports++;
  context.window.open = () => exports++;
  context.copyText = () => exports++;
  context.copyOffer(); context.shareOffer(); context.printOffer(); context.exportBasketCsv(); context.saveOfferHistory();
  assert.equal(exports, 0);
  assert.equal(vm.runInContext('offerHistory.length', context), 0);
  vm.runInContext('basket[0].price = 0', context);
  assert.equal(context.getBasketTotals().complete, true);
  assert.equal(context.getBasketTotals().vatIncluded, 0);
  assert.ok(messages.length > 0);
});

test('currency labels inconsistent with TL prices are flagged without guessing a replacement price', async () => {
  const {context} = harness();
  const rows = [
    [{v:'USD-OLD'}, {v:'Eski USD'}, null, {v:10, f:'10,00 $'}, {v:10}],
    [{v:'TL-WRONG'}, {v:'TL ürün'}, null, {v:1820, f:'1.820,00 ₺'}, {v:89241.88}],
    [{v:'USD-OK'}, {v:'USD ürün'}, null, {v:10, f:'$10,00'}, {v:490.34}]
  ];
  context.fetch = async () => ({ok:true,text:async()=> 'setResponse(' + JSON.stringify({status:'ok', table:{rows:rows.map(c=>({c}))}}) + ');'});
  const result = await context.fetchSheet({name:'Kaynak Tamamlayıcı Ürünler', b:0,n:1,p:4,s:null,u:null});
  assert.equal(result[0].price,10);
  assert.equal(context.hasUsablePrice(result[0]),false);
  assert.equal(context.hasUsablePrice(result[1]),false);
  assert.equal(context.hasUsablePrice(result[2]),true);
  assert.match(result[0].priceIssue,/Para birimi/);
});

test('timeout stays active while a response body is stalled', async () => {
  const {context} = harness();
  let expire, started, cleared = false;
  const bodyStarted = new Promise(resolve => { started = resolve; });
  context.setTimeout = callback => { expire = callback; return 1; };
  context.clearTimeout = () => { cleared = true; };
  context.fetch = async (url, {signal}) => ({ok:true, text:() => { started(); return new Promise((resolve,reject) => signal.addEventListener('abort',()=>reject(new Error('aborted body')))); }});
  const read = context.fetchWithTimeout('https://docs.google.com/test');
  await bodyStarted;
  assert.equal(cleared,false);
  expire();
  await assert.rejects(read,/aborted body/);
  assert.equal(cleared,true);
});

test('total refresh failure preserves newer in-memory data instead of restoring an older cache', async () => {
  const {context,storage} = harness();
  storage.set('teknikelProductSnapshot',JSON.stringify({products:[product({price:90})],syncedAt:'2026-09-30T21:00:00Z'}));
  vm.runInContext('products = '+JSON.stringify([product({price:110})]),context);
  context.fetchSheet = async () => null;
  context.applyProductSnapshot = () => assert.fail('Older cache must not replace current data');
  context.showToast = () => {};
  await context.loadData(true);
  assert.equal(vm.runInContext('products[0].price',context),110);
  assert.equal(JSON.parse(storage.get('teknikelProductSnapshot')).products[0].price,90);
});

test('duplicate rows are collapsed while different SKUs and differing prices are preserved', () => {
  const {context} = harness();
  const records=[product(), product(), product({barcode:'OTHER'}), product({price:120})];
  const result=context.uniqueProductRecords(records);
  assert.equal(result.length,3);
  assert.equal(result[1].barcode,'OTHER');
  assert.equal(result[2].price,120);
});

test('search keeps the selected SKU after refresh and skips fuzzy scoring when direct matches exist', () => {
  const {context,elements} = harness();
  const items=[product({barcode:'FIRST',name:'Lava torç',specification:'1,00 mm - 5 Kg',priceUnit:'KG'}), product({barcode:'SELECTED',name:'Lava torç',specification:'1,20 mm - 15 Kg',priceUnit:'KG'}), product({barcode:'OTHER',name:'Başka ürün'})];
  vm.runInContext('products = '+JSON.stringify(items),context);
  const original=context.scoreProductSearch;
  const fuzzyCalls=[];
  context.scoreProductSearch=(p,q,allowFuzzy)=> {fuzzyCalls.push(allowFuzzy);return original(p,q,allowFuzzy);};
  let selected;
  context.showResult=p=> {selected=p;};
  context.search('Lava torç',context.productKey(items[1]));
  assert.equal(selected.barcode,'SELECTED');
  assert.deepEqual(fuzzyCalls,[false,false,false]);
  assert.ok(elements.get('suggestions').children.length>0);
  const suggestions=elements.get('suggestions').children.filter(e=>e.className==='sug-item');
  assert.deepEqual(suggestions.map(e=>e.children[0].children.find(c=>c.className==='sug-specification').textContent),['1,00 mm - 5 Kg','1,20 mm - 15 Kg']);
  assert.ok(suggestions.every(e=>e.children[1].textContent==='100,00 ₺ / kg'));
  assert.ok(context.scoreProductSearch(product({name:'Lava torç'}),'lavaaa').score>0);
});

test('scanner lookup does not select a similar product for an unknown barcode', () => {
  const {context} = harness();
  vm.runInContext('products = '+JSON.stringify([product({name:'Lava torç',barcode:'LAVA-01'})]),context);
  let selected='not called';
  context.showResult=p=> {selected=p;};
  context.search('lavaaa',null,true);
  assert.equal(selected,null);
});

test('a removed full product code never selects a fuzzy priced product', () => {
  const {context,elements} = harness();
  vm.runInContext('products = '+JSON.stringify([product({barcode:'31001EGAM3',name:'31001EGAM3',price:277})]),context);
  let selected='not called';
  context.showResult=p=> {selected=p;};
  context.search('31001EGAM2');
  assert.equal(selected,null);
  assert.equal(elements.get('suggestions').children.length,0);
});

test('empty catalogues are failed reads, while an empty stock inventory is valid', async () => {
  const {context}=harness();
  context.fetch=async()=>gviz([]);
  assert.equal(await context.fetchSheet({name:'Trafimet',b:0,n:1,p:3,s:null,u:null}),null);
  assert.equal((await context.fetchSheet({name:'Envanter',b:0,n:1,p:2,s:3,u:4})).length,0);
});

test('public matching columns preserve alphanumeric codes, pack specifications and price units', async () => {
  const {context}=harness();
  context.fetch=async url=> {
    assert.match(url,/range=A:I/);
    return gviz([['31001DCBM2','FCW 11 (D200 RND) (VAC)','1,00 mm - 5 Kg',3.6,176.52204,'Kod eşleştirildi','31001DFBM2','KG','2026-10-01T17:13:38.568Z']]);
  };
  const [item]=await context.fetchSheet({name:'Özlü Teller',b:0,n:1,p:4,u:null,s:null,m:5});
  assert.equal(item.barcode,'31001DCBM2');
  assert.equal(item.sourceCode,'31001DFBM2');
  assert.equal(item.specification,'1,00 mm - 5 Kg');
  assert.equal(context.hasUsablePrice(item),true);
  assert.equal(context.productPriceLabel(item),'176,52 ₺ / kg');
  const check=context.catalogueCheck([null,null,null,null,null,{v:'Kod eşleştirildi'},{v:'7042E00001'},{v:'AD'},{v:'2026-10-01T17:13:38Z'}],{name:'MW Torç ve Sarfları',m:5});
  assert.equal(check.sourceCode,'7042E00001');
});

test('missing, zero, ambiguous, formula and absent matching metadata require price review',()=>{
  const {context}=harness();
  function check(status,time='2026-10-01T17:13:38Z') {
    return context.catalogueCheck([null,null,null,null,null,{v:status},{v:'CODE'},{v:'AD'},{v:time}],{name:'MW Torç ve Sarfları',m:5});
  }
  for (const status of ['Kaynakta yok','Üretici fiyatı yok','Çoklu eşleşme','Fiyat formülü kontrolü','TL formülü kontrolü','Çelişkili kayıt','']) assert.ok(check(status).issue);
  for (const status of ['Doğrulandı','Kod eşleştirildi','Sheet fiyatı']) assert.equal(check(status).issue,'');
  assert.ok(check('Doğrulandı','').issue);
  assert.match(check('Üretici fiyatı yok').issue,/fiyat sıfır/);
});

test('old and canonical barcode searches resolve the same original SKU and scanner prefers physical barcode',()=>{
  const {context}=harness();
  const alias=product({barcode:'70420',sourceCode:'7042E00001',matchStatus:'Kod eşleştirildi'});
  const direct=product({barcode:'7042E00001',name:'Doğrudan barkod'});
  vm.runInContext('products='+JSON.stringify([alias]),context);
  let selected;
  context.showResult=item=>{selected=item;};
  for (const query of ['70420','7042E00001']) {
    context.search(query,null,true);
    assert.equal(selected.barcode,'70420');
    assert.equal(context.productKey(selected),context.productKey(alias));
  }
  vm.runInContext('products='+JSON.stringify([alias,direct]),context);
  context.search('7042E00001',null,true);
  assert.equal(selected.name,'Doğrudan barkod');
  context.search('7042E00002',null,true);
  assert.equal(selected,null);
});

test('PDF catalogues preserve source dates, variant identity, units and missing-price blocking',async()=>{
  const {context}=harness();
  const cfg={name:'Komark',b:0,n:1,p:4,s:null,u:null,m:5,pdf:true,pdfListDate:'11.08.2025'};
  let url;
  context.fetch=async request=>{
    url=request;
    return gviz([
      ['CODE · STANDARD','WP 9 TIG TORÇ','Standart · 4 m',101,5575.39,'PDF fiyatı','CODE','AD','2025-08-11T00:00:00+03:00','EUR',16,'PDF fiyatı'],
      ['CODE · ECO','WP 9 TIG TORÇ','EKO · 4 m',55,3036.10,'PDF fiyatı','CODE','AD','2025-08-11T00:00:00+03:00','EUR',16,'PDF fiyatı'],
      ['WAIT','MIG KONTAK MEME','L 28',null,null,'PDF fiyatı sorunuz','WAIT','AD','2025-08-11T00:00:00+03:00','EUR',13,'Sorunuz']
    ]);
  };
  const items=await context.fetchSheet(cfg);
  assert.ok(url.includes('range=A:L'));
  assert.equal(items.length,3);
  assert.equal(context.hasUsablePrice(items[0]),true);
  assert.equal(context.hasUsablePrice(items[1]),true);
  assert.equal(context.hasUsablePrice(items[2]),false);
  assert.match(items[2].priceIssue,/Sorunuz/);
  assert.equal(context.productDateLabel(items[0]),'PDF: 11.08.2025');
  assert.match(context.productSourceNote(items[0]),/Sayfa 16/);
  assert.equal(context.productPriceLabel(items[1]),'3.036,10 ₺ / adet');
  assert.notEqual(context.productKey(items[0]),context.productKey(items[1]));
  assert.equal(context.getBrand(items[0]),'Komark');
  assert.equal(context.getBrand(product({sheet:'Süper Kaynak'})),'Süper Kaynak');
  assert.ok(context.catalogueCheck([null,null,null,null,null,{v:'PDF fiyatı'},null,null,{v:'2025-08-11T00:00:00+03:00'}],{name:'Trafimet',m:5}).issue);
});

test('ambiguous supplier codes require a variant selection in typed search and scanning',()=>{
  const {context,elements}=harness();
  const variants=[product({barcode:'SKE 001 TK · MIG',sourceCode:'SKE 001 TK',name:'MIG akım kablosu'}),product({barcode:'SKE 001 TK · TIG',sourceCode:'SKE 001 TK',name:'TIG akım kablosu'})];
  vm.runInContext('products='+JSON.stringify(variants),context);
  let selected;
  context.showResult=p=>{selected=p;};
  for(const scanned of [false,true]){
    context.search('SKE001TK',null,scanned);
    assert.equal(selected,null);
    assert.equal(elements.get('suggestions').children.filter(x=>x.className==='sug-item').length,2);
  }
  context.search('SKE001TK',context.productKey(variants[1]),false);
  assert.equal(selected.name,'TIG akım kablosu');
  context.search('SKE 001 TK · MIG',null,true);
  assert.equal(selected.name,'MIG akım kablosu');
});

test('a current supplier price warning blocks quotes from an older basket without overwriting its price',()=>{
  const {context}=harness();
  const stored=product({qty:2,price:156.42});
  vm.runInContext('basket='+JSON.stringify([stored])+'; products='+JSON.stringify([product({price:156.42,priceIssue:'Üretici fiyatı yok'})]),context);
  context.showToast=()=>{};
  assert.equal(context.getBasketTotals().complete,false);
  assert.equal(context.buildOfferText(),'');
  context.downloadCsv=()=>assert.fail('Unconfirmed quote must not be exported');
  context.exportBasketCsv();
  assert.equal(vm.runInContext('basket[0].price',context),156.42);
});

test('explicit basket update repairs old unit metadata without changing quantity or discount',()=>{
  const {context,storage}=harness();
  const live=product({price:176.52204,priceUnit:'KG',priceIssue:'',matchStatus:'Kod eşleştirildi',sourceCode:'NEW'});
  vm.runInContext('basket='+JSON.stringify([product({price:176.52,qty:2})])+'; products='+JSON.stringify([live])+'; iskontoOrani=10;',context);
  context.renderBasket=()=>{};context.updateBadge=()=>{};context.showToast=()=>{};
  assert.equal(context.getBasketTotals().complete,false);
  assert.equal(context.getBasketPriceChanges().length,1);
  context.updateBasketPrices();
  assert.equal(context.getBasketTotals().complete,true);
  assert.equal(context.getBasketTotals().vatIncluded,381.29);
  const [saved]=JSON.parse(storage.get('teknikelCurrentBasket'));
  assert.equal(saved.qty,2);
  assert.equal(saved.priceUnit,'KG');
  assert.equal(saved.sourceCode,'NEW');
  assert.equal(vm.runInContext('iskontoOrani',context),10);
});

test('offers and CSV use known price units and do not invent a unit for Sheet-only prices',()=>{
  const {context}=harness();
  context.showToast=()=>{};context.ensureOfferNumber=()=>{};
  const items=[product({qty:2,price:176.52204,priceUnit:'KG'}),product({barcode:'OTHER',qty:1,priceUnit:''})];
  vm.runInContext('basket='+JSON.stringify(items),context);
  const offer=context.buildOfferText();
  assert.match(offer,/2 kg × 176,52 ₺ \/ kg/);
  assert.equal(context.productQuantityLabel(items[1]),'1');
  let exported;
  context.downloadCsv=(filename,rows)=>{exported=rows;};
  context.exportBasketCsv();
  assert.equal(exported[0][4],'Birim');
  assert.equal(exported[1][4],'kg');
  assert.equal(exported[2][4],'');
});

test('exchange-rate fractions do not create a zero-cent price-change alert',()=>{
  const {context,storage}=harness();
  const item=product({price:257.427975});
  storage.set('teknikelPriceSnapshotV2',JSON.stringify({[context.productKey(item)]:257.43}));
  vm.runInContext('products='+JSON.stringify([item]),context);
  context.applyPriceChanges();
  assert.equal(vm.runInContext('products[0].priceChange',context),undefined);
  assert.equal(context.getPriceChangeText({priceChange:0.00001,previousPrice:257.43}),'Değişiklik yok');
  vm.runInContext('products[0].price=257.45',context);
  context.applyPriceChanges();
  assert.equal(vm.runInContext('products[0].priceChange',context),0.02);
  assert.match(context.getPriceChangeText(vm.runInContext('products[0]',context)),/Yükseldi · 0,02 ₺/);
});
