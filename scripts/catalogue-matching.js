// Shared with the bound Apps Script. Keep identities conservative: model,
// decimal dimensions, packaging, quantity, origin and certification all matter.
function catalogueIdentity(value) {
  var text = String(value == null ? '' : value).normalize('NFKC')
    .replace(/[ıİ]/g, 'I').toUpperCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/(\d),(?=\d)/g, '$1.');
  var tokens = text.match(/[A-Z]+|\d+(?:\.\d+)?/g) || [];
  return tokens.map(function(token) {
    return /^\d/.test(token) ? String(Number(token)) : token;
  }).join('|');
}

function catalogueCode(value) {
  return String(value == null ? '' : value).replace(/\s+/g, '').toUpperCase();
}

function buildCatalogueIndex(products) {
  var byIdentity = new Map();
  Object.keys(products).forEach(function(code) {
    var product = products[code];
    var key = product.category + '\u001f' + catalogueIdentity(product.name + ' ' + (product.size || ''));
    var matches = byIdentity.get(key) || [];
    matches.push(product);
    byIdentity.set(key, matches);
  });
  return byIdentity;
}

function resolveCatalogueProduct(record, products, index) {
  var direct = products[catalogueCode(record.code)];
  if (direct) return { product: direct, method: 'Kod' };
  var identity = catalogueIdentity(record.name + ' ' + (record.size || ''));
  if (!identity || !record.category) return { product: null, method: 'Kaynakta yok' };
  var matches = index.get(record.category + '\u001f' + identity) || [];
  if (matches.length === 1) return { product: matches[0], method: 'Ad, ölçü ve ambalaj' };
  return { product: null, method: matches.length > 1 ? 'Çoklu eşleşme' : 'Kaynakta yok' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { catalogueIdentity, catalogueCode, buildCatalogueIndex, resolveCatalogueProduct };
}
