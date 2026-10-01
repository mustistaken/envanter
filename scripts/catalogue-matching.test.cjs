const test = require('node:test');
const assert = require('node:assert/strict');
const { catalogueIdentity, buildCatalogueIndex, resolveCatalogueProduct } = require('./catalogue-matching');

const wire = (code, size, name = 'FCW 11 (D200 RND) (VAC)') => ({
  code, name, size, category: 'Özlü Teller', price: 3.6, currency: 'USD'
});
const lookup = (record, list) => {
  const products = Object.fromEntries(list.map(p => [p.code, p]));
  return resolveCatalogueProduct({ category: 'Özlü Teller', ...record }, products, buildCatalogueIndex(products));
};

test('legacy barcode resolves to one exact manufacturer identity without changing the barcode', () => {
  const record = { code: 'OLD', name: 'FCW 11 (D200 RND) (VAC)', size: '1,00 (mm) - 5 (Kg) (NET)' };
  const result = lookup(record, [wire('NEW', '1.00 (mm) - 5 (Kg) (NET)')]);
  assert.equal(result.product.code, 'NEW');
  assert.equal(record.code, 'OLD');
  assert.equal(result.method, 'Ad, ölçü ve ambalaj');
});

test('numeric normalization preserves decimal dimensions and separate quantities', () => {
  assert.equal(catalogueIdentity('1,20 mm - 5 Kg'), catalogueIdentity('1.200 (mm) - 5(Kg)'));
  assert.notEqual(catalogueIdentity('1.2 mm'), catalogueIdentity('12 mm'));
  assert.notEqual(catalogueIdentity('1 mm - 25 Kg'), catalogueIdentity('12 mm - 5 Kg'));
});

test('different model, spool, packaging, size, origin and certification never match by similarity', () => {
  const source = wire('NEW', '1.20 (mm) - 5 (Kg) (NET) (EU)');
  for (const record of [
    { name: 'FCW 11A (D200 RND) (VAC)', size: source.size },
    { name: 'FCW 11 (D300 RND) (VAC)', size: source.size },
    { name: source.name, size: '1.20 (mm) - 15 (Kg) (NET) (EU)' },
    { name: source.name, size: '1.20 (mm) - 5 (Kg) (NET)' },
    { name: source.name, size: source.size + ' (3.1T)' }
  ]) assert.equal(lookup({ code: 'OLD', ...record }, [source]).product, null);
});

test('two current codes for the same complete identity require review', () => {
  const a = wire('A', '1.20 mm - 5 Kg');
  const b = wire('B', '1.20 mm - 5 Kg');
  const result = lookup({ code: 'OLD', name: a.name, size: a.size }, [a, b]);
  assert.equal(result.product, null);
  assert.equal(result.method, 'Çoklu eşleşme');
});

test('fallback identity cannot cross manufacturer categories', () => {
  const a = wire('A', '1.20 mm - 5 Kg');
  assert.equal(lookup({ code: 'OLD', name: a.name, size: a.size, category: 'Torç ve Sarfları' }, [a]).product, null);
});

test('exact canonical code remains authoritative when the display name changes', () => {
  const a = wire('A', '1.20 mm - 5 Kg');
  assert.equal(lookup({ code: ' a ', name: 'Eski başlık', size: '' }, [a]).product.code, 'A');
});
