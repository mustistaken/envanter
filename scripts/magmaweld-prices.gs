// Prepared 07.10.2026; this repository copy is not proof of deployment to Apps Script.
const MAGMA_CONFIG = Object.freeze({
  spreadsheetId: '18hZzuWA2BKES85qMrFylNsDawM81QKWTJF84xJAlM4U',
  sourceUrl: 'https://www.magmaweld.com.tr/satis-fiyati',
  timeZone: 'Europe/Istanbul',
  historySheet: 'Fiyat Güncelleme Geçmişi',
  matchingSheet: 'Ürün Eşleştirme',
  historyResetDays: 3,
  historyResetProperty: 'MAGMA_HISTORY_LAST_RESET_MS',
  historyExtraRows: 1000,
  categoryField: 'ctl00$masterContent$drpSecenek',
  eventTarget: 'ctl00$masterContent$drpSecenek',
  categories: [
    { id: '11', name: 'Örtülü Kaynak Elektrodları', minimum: 300 },
    { id: '2', name: 'MIG / MAG ve TIG Telleri', minimum: 100 },
    { id: '4', name: 'Özlü Teller', minimum: 40 },
    { id: '5', name: 'Tozaltı Telleri ve Tozları', minimum: 5 },
    { id: '6', name: 'Kaynak ve Kesme Makineleri', minimum: 20 },
    { id: '8', name: 'Kaynak Tamamlayıcı Ürünler', minimum: 100 },
    { id: '10', name: 'Torç ve Sarfları', minimum: 50 }
  ],
  inventorySheets: [
    { name: 'MW Torç ve Sarfları', priceColumn: 3, sourceCategory: 'Torç ve Sarfları' },
    { name: 'MW Kaynak Makinaları', priceColumn: 3, sourceCategory: 'Kaynak ve Kesme Makineleri' },
    { name: 'Kaynak Tamamlayıcı Ürünler', priceColumn: 4, sourceCategory: 'Kaynak Tamamlayıcı Ürünler' },
    { name: 'Özlü Teller', priceColumn: 4, sourceCategory: 'Özlü Teller' },
    { name: 'Tozaltı Telleri ve Tozları', priceColumn: 4, sourceCategory: 'Tozaltı Telleri ve Tozları' },
    { name: 'Örtülü Elektrodlar', priceColumn: 4, sourceCategory: 'Örtülü Kaynak Elektrodları' },
    { name: 'MIG-MAG ve TIG Telleri', priceColumn: 4, sourceCategory: 'MIG / MAG ve TIG Telleri' }
  ]
});

/**
 * İlk kurulum için çalıştırılır. Siteyi sadece okur, güvenlik
 * kontrollerini yapar ve her gün 09:00 civarı çalışacak tetikleyiciyi kurar.
 */
function setupMagmaweldAutomation() {
  const report = testMagmaweldFetch();
  installDailyTrigger_();
  ensureHistorySheet_();
  return report;
}

/**
 * Siteyi ve tüm kategorileri okur, fakat tabloya fiyat yazmaz.
 */
function testMagmaweldFetch() {
  const fetched = fetchAllMagmaweldProducts_();
  const result = {
    status: 'OK',
    totalProducts: Object.keys(fetched.products).length,
    categoryCounts: fetched.categoryCounts,
    checkedAt: formatDate_(new Date())
  };
  console.log(JSON.stringify(result));
  return result;
}

/**
 * Günlük tetikleyicinin çağırdığı ana işlev.
 */
function updateMagmaweldPrices() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Başka bir fiyat güncellemesi hâlen çalışıyor.');
  }

  const startedAt = new Date();
  try {
    const fetched = fetchAllMagmaweldProducts_();
    const ss = SpreadsheetApp.openById(MAGMA_CONFIG.spreadsheetId);
    const history = ensureHistorySheet_(ss);
    const logRows = [];
    const historyWasReset = resetHistoryIfDue_(history);
    if (historyWasReset) {
      logRows.push([
        formatDate_(startedAt), 'Geçmiş yenilendi', '', '', '', '', '', '', '',
        'Üç günlük kayıt dönemi tamamlandı; eski geçmiş temizlendi.'
      ]);
    }
    const stats = {
      matched: 0,
      changed: 0,
      missingOnSite: 0,
      skippedFormula: 0,
      conversionRepaired: 0,
      skippedConversion: 0,
      matchedByIdentity: 0,
      zeroSourcePrice: 0,
      sheetOnly: 0,
      websiteProducts: Object.keys(fetched.products).length
    };

    const index = buildCatalogueIndex(fetched.products);
    const reportRows = [];
    const checkedAt = startedAt.toISOString();
    MAGMA_CONFIG.inventorySheets.forEach(function (sheetConfig) {
      const sheet = ss.getSheetByName(sheetConfig.name);
      if (!sheet) {
        throw new Error('Envanter sekmesi bulunamadı: ' + sheetConfig.name);
      }
      updateOneInventorySheet_(sheet, sheetConfig, fetched.products, logRows, stats, index, reportRows, checkedAt);
    });

    // The web publication retains this category snapshot if older daily code omits it.
    syncSubmergedArcMetadata_(ss, reportRows);
    updateSheetOnlyCatalogue_(ss.getSheetByName('Trafimet'), logRows, stats, reportRows, checkedAt);
    writeMatchingReport_(ss, reportRows);
    logRows.push([
      formatDate_(startedAt),
      'Özet',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'Eşleşen: ' + stats.matched +
        ' | Değişen: ' + stats.changed +
        ' | Sitede bulunamayan: ' + stats.missingOnSite +
        ' | Formül nedeniyle atlanan: ' + stats.skippedFormula +
        ' | TL formülü düzeltilen: ' + stats.conversionRepaired +
        ' | Özel TL formülü korunan: ' + stats.skippedConversion +
        ' | Ad/ölçü/ambalaj ile eşleşen: ' + stats.matchedByIdentity +
        ' | Üreticide sıfır fiyat: ' + stats.zeroSourcePrice +
        ' | Trafimet Sheet fiyatı: ' + stats.sheetOnly +
        ' | Site toplamı: ' + stats.websiteProducts
    ]);
    appendHistory_(history, logRows);
    console.log(JSON.stringify(stats));
    return stats;
  } catch (error) {
    try {
      const ss = SpreadsheetApp.openById(MAGMA_CONFIG.spreadsheetId);
      const history = ensureHistorySheet_(ss);
      appendHistory_(history, [[
        formatDate_(startedAt), 'HATA', '', '', '', '', '', '', '',
        String(error && error.message ? error.message : error)
      ]]);
    } catch (historyError) {
      console.error(historyError);
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function updateOneInventorySheet_(sheet, sheetConfig, products, logRows, stats, index, reportRows, checkedAt) {
  const firstDataRow = 3;
  const lastRow = sheet.getLastRow();
  if (lastRow < firstDataRow) return;
  const range = sheet.getRange(firstDataRow, 1, lastRow - firstDataRow + 1, 5);
  const values = range.getValues();
  const displays = range.getDisplayValues();
  const formats = range.getNumberFormats();
  const formulas = range.getFormulas();
  const priceIndex = sheetConfig.priceColumn - 1;
  const pending = [];
  const conversions = [];
  index = index || buildCatalogueIndex(products);
  reportRows = reportRows || [];
  checkedAt = checkedAt || new Date().toISOString();

  for (let i = 0; i < values.length; i++) {
    const row = firstDataRow + i;
    const code = normalizeCode_(displays[i][0]);
    if (!code || !displays[i][1].trim() || /^\d{1,3}$/.test(code)) continue;
    const name = displays[i][1];
    const size = priceIndex === 3 ? displays[i][2] : '';
    const resolution = resolveCatalogueProduct({ code: code, name: name, size: size, category: sheetConfig.sourceCategory }, products, index);
    const product = resolution.product;
    const oldCurrency = detectCurrency_(formats[i][priceIndex], displays[i][priceIndex]);
    if (!product) {
      stats.missingOnSite++;
      const reason = resolution.method === 'Çoklu eşleşme' ? 'Aynı ad, ölçü ve ambalaj için birden fazla üretici kodu bulundu.' : 'Güncel üretici listesinde aynı kod veya tam ürün kimliği bulunamadı.';
      reportRows.push(matchingReportRow_(sheet.getName(), code, '', resolution.method, '', checkedAt, name, size, reason, '', '', MAGMA_CONFIG.sourceUrl));
      logRows.push([formatDate_(new Date()), resolution.method, sheet.getName(), code, name, displays[i][priceIndex], '', oldCurrency, '', reason + ' Önceki fiyat korundu; tekliften önce teyit edin.']);
      continue;
    }
    stats.matched++;
    if (resolution.method !== 'Kod') {
      stats.matchedByIdentity++;
      logRows.push([formatDate_(new Date()), 'Kod eşleştirildi', sheet.getName(), code, name, '', '', '', '',
        'Ad, ölçü ve ambalaj tek bir güncel ürünle birebir eşleşti. Orijinal barkod korundu.', product.code]);
    }
    let status = resolution.method === 'Kod' ? 'Doğrulandı' : 'Kod eşleştirildi';
    let reason = resolution.method === 'Kod' ? 'Üretici kodu ile güncel fiyat doğrulandı.' : 'Ad, ölçü ve ambalaj birebir eşleşti; barkod korundu.';
    if (product.price === 0) {
      stats.zeroSourcePrice++;
      reason = 'Üretici listesindeki fiyat sıfır; önceki değer korundu, teklif için fiyat teyidi gerekiyor.';
      reportRows.push(matchingReportRow_(sheet.getName(), code, product.code, 'Üretici fiyatı yok', product.unit, checkedAt, name, size, reason, product.price, product.currency, MAGMA_CONFIG.sourceUrl));
      logRows.push([formatDate_(new Date()), 'Üretici fiyatı yok', sheet.getName(), code, name, displays[i][priceIndex], 0, oldCurrency, product.currency, reason]);
      continue;
    }
    if (formulas[i][priceIndex]) {
      stats.skippedFormula++;
      reason = 'Kaynak fiyat hücresinde formül var; otomatik fiyat yazılmadı.';
      reportRows.push(matchingReportRow_(sheet.getName(), code, product.code, 'Fiyat formülü kontrolü', product.unit, checkedAt, name, size, reason, product.price, product.currency, MAGMA_CONFIG.sourceUrl));
      logRows.push([formatDate_(new Date()), 'Kontrol gerekli', sheet.getName(), code, name, displays[i][priceIndex], product.price, oldCurrency, product.currency, reason]);
      continue;
    }
    const conversion = planTryConversion_(row, sheetConfig, product.currency, formulas[i][4]);
    if (conversion.review) {
      stats.skippedConversion++;
      status = 'TL formülü kontrolü';
      reason = 'Özel TL fiyat formülü korundu: ' + formulas[i][4];
      logRows.push([formatDate_(new Date()), 'Kontrol gerekli', sheet.getName(), code, name, displays[i][4], '', oldCurrency, product.currency, reason]);
    } else if (conversion.formula) {
      conversions.push({ row: row, formula: conversion.formula, code: code, name: name, previous: formulas[i][4], currency: product.currency });
    }
    reportRows.push(matchingReportRow_(sheet.getName(), code, product.code, status, product.unit, checkedAt, name, size, reason, product.price, product.currency, MAGMA_CONFIG.sourceUrl));
    const oldNumber = typeof values[i][priceIndex] === 'number' ? values[i][priceIndex] : parseTurkishNumber_(displays[i][priceIndex]);
    const desiredFormat = currencyFormat_(product.currency, product.decimals);
    const changed = !Number.isFinite(oldNumber) || Math.abs(oldNumber - product.price) > Math.pow(10, -Math.max(product.decimals, 2)) / 2;
    if (!changed && formats[i][priceIndex] === desiredFormat) continue;
    pending.push({ row: row, value: product.price, format: desiredFormat, code: code, name: name,
      oldDisplay: displays[i][priceIndex], oldCurrency: oldCurrency, newCurrency: product.currency });
  }
  makeConsecutiveRuns_(pending).forEach(function(run) {
    const target = sheet.getRange(run[0].row, sheetConfig.priceColumn, run.length, 1);
    target.setValues(run.map(function(item) { return [item.value]; }));
    target.setNumberFormats(run.map(function(item) { return [item.format]; }));
  });
  pending.forEach(function(item) {
    stats.changed++;
    logRows.push([formatDate_(new Date()), 'Güncellendi', sheet.getName(), item.code, item.name,
      item.oldDisplay, item.value, item.oldCurrency, item.newCurrency, MAGMA_CONFIG.sourceUrl]);
  });
  makeConsecutiveRuns_(conversions).forEach(function(run) {
    sheet.getRange(run[0].row, 5, run.length, 1).setFormulas(run.map(function(item) { return [item.formula]; }));
  });
  conversions.forEach(function(item) {
    stats.conversionRepaired++;
    logRows.push([formatDate_(new Date()), 'TL formülü düzeltildi', sheet.getName(), item.code, item.name,
      item.previous, item.formula, item.currency, 'TL', 'Kaynak para birimine göre TL hesaplama formülü düzeltildi.']);
  });
}

function syncSubmergedArcMetadata_(ss, reportRows) {
  const sheet = ss.getSheetByName('Tozaltı Telleri ve Tozları');
  if (!sheet || sheet.getLastRow() < 3) return;
  const rows = sheet.getRange(3, 1, sheet.getLastRow() - 2, 2).getDisplayValues();
  const lookup = new Map(reportRows.map(function(row) { return [row[0], row]; }));
  const values = rows.map(function(row) {
    const report = lookup.get(sheet.getName() + '|' + normalizeCode_(row[0]));
    return report ? report.slice(1, 5) : ['', '', '', ''];
  });
  sheet.getRange(3, 7, values.length, 4).setValues(values);
  sheet.getRange(3, 8, values.length, 1).setNumberFormat('@');
}

function matchingReportRow_(sheet, code, canonical, status, unit, checkedAt, name, size, reason, price, currency, url) {
  return [sheet + '|' + code, status, canonical || '', unit || '', checkedAt, sheet, code,
    name + (size ? ' · ' + size : ''), reason, price, currency, url];
}

function updateSheetOnlyCatalogue_(sheet, logRows, stats, reportRows, checkedAt) {
  if (!sheet) throw new Error('Trafimet sekmesi bulunamadı.');
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return;
  const range = sheet.getRange(3, 1, lastRow - 2, 4);
  const values = range.getValues(), displays = range.getDisplayValues(), formats = range.getNumberFormats(), formulas = range.getFormulas();
  const pending = [];
  for (let i = 0; i < values.length; i++) {
    const code = normalizeCode_(displays[i][0]), name = displays[i][1];
    if (!code || !name.trim() || /^\d{1,3}$/.test(code)) continue;
    stats.sheetOnly++;
    const currency = detectCurrency_(formats[i][2], displays[i][2]);
    const price = values[i][2];
    let status = 'Sheet fiyatı';
    let reason = 'Güncel üretici fiyat listesi erişilebilir değil; fiyat Sheet kaydıdır.';
    if (TRAFIMET_CATALOGUE_CODES.has(code)) reason += ' Kod 01.10.2026 tarihinde resmi Nisan 2026 torç kataloğunda doğrulandı.';
    else reason += ' Kod resmi Nisan 2026 torç kataloğunda bulunamadı; başka seri/katalog olabilir.';
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || !currency) {
      status = 'Fiyat formülü kontrolü'; reason = 'Sheet fiyatı veya para birimi geçerli değil.';
    } else {
      const row = i + 3;
      const desired = '=C' + row + (currency === 'EUR' ? '*$E$3' : currency === 'USD' ? '*$F$2' : '');
      const current = formulas[i][3].replace(/[\s$]/g, '').toUpperCase();
      const recognized = ['=C' + row, '=C' + row + '*E3', '=C' + row + '*F2'];
      if (current !== desired.replace(/[\s$]/g, '').toUpperCase()) {
        if (current && !recognized.includes(current)) { status = 'TL formülü kontrolü'; reason = 'Özel TL formülü korundu: ' + formulas[i][3]; }
        else pending.push({ row: row, formula: desired, code: code, name: name, previous: formulas[i][3], currency: currency });
      }
    }
    reportRows.push(matchingReportRow_(sheet.getName(), code, code, status, '', checkedAt, name, '', reason, price, currency, TRAFIMET_CATALOGUE_URL));
  }
  makeConsecutiveRuns_(pending).forEach(function(run) {
    sheet.getRange(run[0].row, 4, run.length, 1).setFormulas(run.map(function(item) { return [item.formula]; }));
  });
  pending.forEach(function(item) {
    stats.conversionRepaired++;
    logRows.push([formatDate_(new Date()), 'TL formülü düzeltildi', 'Trafimet', item.code, item.name, item.previous, item.formula, item.currency, 'TL', 'Sheet para birimine göre TL formülü düzeltildi; kaynak fiyat korunur.']);
  });
}

function writeMatchingReport_(ss, reportRows) {
  let sheet = ss.getSheetByName(MAGMA_CONFIG.matchingSheet);
  if (!sheet) {
    sheet = ss.insertSheet(MAGMA_CONFIG.matchingSheet);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 12).setFontWeight('bold').setBackground('#1f4e78').setFontColor('#ffffff');
    sheet.setColumnWidths(1, 12, 160);
    sheet.setColumnWidth(1, 310); sheet.setColumnWidth(8, 450); sheet.setColumnWidth(9, 500); sheet.setColumnWidth(12, 420);
  }
  const unique = new Map();
  reportRows.forEach(function(row) {
    const previous = unique.get(row[0]);
    if (previous && JSON.stringify(previous.slice(1)) !== JSON.stringify(row.slice(1))) {
      row[1] = 'Çelişkili kayıt'; row[8] = 'Aynı kategori ve barkod için farklı kayıtlar var; fiyatı doğrulayın.';
    }
    unique.set(row[0], row);
  });
  const rows = [['Anahtar', 'Durum', 'Üretici kodu', 'Fiyat birimi', 'Kontrol zamanı (ISO)', 'Kategori', 'Orijinal barkod', 'Ürün / ölçü / ambalaj', 'Açıklama', 'Kaynak fiyat', 'Para birimi', 'Kaynak']].concat(Array.from(unique.values()));
  if (sheet.getMaxRows() < rows.length) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length - sheet.getMaxRows() + 100);
  const previousLast = sheet.getLastRow();
  const literal = rows.map(function(row) { return row.map(function(value) { return typeof value === 'string' && value.startsWith('=') ? "'" + value : value; }); });
  // Product codes containing E (for example 7042E00003) must stay text.
  sheet.getRange(1, 3, rows.length, 1).setNumberFormat('@');
  sheet.getRange(1, 7, rows.length, 1).setNumberFormat('@');
  sheet.getRange(1, 1, rows.length, 12).setValues(literal);
  if (previousLast > rows.length) sheet.getRange(rows.length + 1, 1, previousLast - rows.length, 12).clearContent();
}

function planTryConversion_(row, sheetConfig, currency, currentFormula) {
  const column = sheetConfig.priceColumn === 3 ? 'C' : 'D';
  const source = column + row;
  let desired = '=' + source;
  if (currency === 'USD') desired += '*' + (sheetConfig.name === 'Örtülü Elektrodlar' ? "'MW Torç ve Sarfları'!$F$3" : '$F$3');
  else if (currency === 'EUR') desired += '*' + (sheetConfig.name === 'Kaynak Tamamlayıcı Ürünler' ? '$H$3' : "'Trafimet'!$E$3");
  else if (currency !== 'TL') return { review: true };
  const normalized = String(currentFormula || '').replace(/[\s$]/g, '').toUpperCase();
  if (normalized === desired.replace(/[\s$]/g, '').toUpperCase()) return {};
  const recognized = ['=' + source, '=' + source + '*F3', '=' + source + '*H3', '=' + source + "*'MWTORÇVESARFLARI'!F3", '=' + source + "*'TRAFIMET'!E3"];

  if (normalized && !recognized.includes(normalized)) return { review: true };
  return { formula: desired };
}

function fetchAllMagmaweldProducts_() {
  const baseResponse = UrlFetchApp.fetch(MAGMA_CONFIG.sourceUrl, {
    method: 'get',
    followRedirects: true,
    muteHttpExceptions: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MagmaweldInventoryMonitor/1.0)'
    }
  });
  assertHttpOk_(baseResponse, 'Ana fiyat sayfası');

  const baseHtml = baseResponse.getContentText('UTF-8');
  const hidden = extractHiddenInputs_(baseHtml);
  if (!hidden.__VIEWSTATE) {
    throw new Error('Magmaweld sayfasındaki güvenlik alanı (__VIEWSTATE) bulunamadı.');
  }
  const cookie = extractCookieHeader_(baseResponse);
  const products = {};
  const categoryCounts = {};
  const duplicates = [];

  MAGMA_CONFIG.categories.forEach(function (category) {
    let html;
    if (category.id === '11') {
      html = baseHtml;
    } else {
      const payload = Object.assign({}, hidden);
      payload.__EVENTTARGET = MAGMA_CONFIG.eventTarget;
      payload.__EVENTARGUMENT = '';
      payload[MAGMA_CONFIG.categoryField] = category.id;

      const headers = {
        'User-Agent': 'Mozilla/5.0 (compatible; MagmaweldInventoryMonitor/1.0)',
        'Referer': MAGMA_CONFIG.sourceUrl
      };
      if (cookie) headers.Cookie = cookie;

      const response = UrlFetchApp.fetch(MAGMA_CONFIG.sourceUrl, {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        payload: payload,
        followRedirects: true,
        muteHttpExceptions: true,
        headers: headers
      });
      assertHttpOk_(response, category.name);
      html = response.getContentText('UTF-8');
    }

    const categoryProducts = parseProductRows_(html, category);
    categoryCounts[category.name] = categoryProducts.length;
    if (categoryProducts.length < category.minimum) {
      throw new Error(
        category.name + ' kategorisinde yalnızca ' + categoryProducts.length +
        ' ürün okundu; güvenlik sınırı ' + category.minimum + '. Hiçbir fiyat değiştirilmedi.'
      );
    }

    categoryProducts.forEach(function (product) {
      const existing = products[product.code];
      if (existing &&
          (existing.price !== product.price || existing.currency !== product.currency)) {
        duplicates.push(product.code);
      } else {
        products[product.code] = product;
      }
    });
  });

  if (duplicates.length) {
    throw new Error('Farklı fiyatla tekrarlanan ürün kodları bulundu: ' + duplicates.slice(0, 20).join(', '));
  }
  if (Object.keys(products).length < 900) {
    throw new Error('Toplam ürün sayısı beklenenden düşük; hiçbir fiyat değiştirilmedi.');
  }
  return { products: products, categoryCounts: categoryCounts };
}

function parseProductRows_(html, category) {
  const products = [];
  const rowRegex = /<tr[^>]*id=["']masterContent_productGrid_DXDataRow\d+["'][^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(cleanHtmlText_(cellMatch[1]));
    }
    if (cells.length < 5) continue;

    const code = normalizeCode_(cells[0]);
    const price = parseTurkishNumber_(cells[3]);
    const currency = normalizeCurrency_(cells[4]);
    if (!code || !Number.isFinite(price) || !currency) continue;
    if (price < 0) throw new Error('Negatif kaynak fiyatı bulundu: ' + code);

    products.push({
      code: code,
      name: cells[1],
      size: cells[2],
      price: price,
      currency: currency,
      decimals: decimalPlaces_(cells[3]),
      category: category.name,
      unit: cells[5] || ''
    });
  }
  return products;
}

function extractHiddenInputs_(html) {
  const result = {};
  const inputRegex = /<input\b[^>]*type=["']hidden["'][^>]*>/gi;
  let match;
  while ((match = inputRegex.exec(html)) !== null) {
    const tag = match[0];
    const nameMatch = tag.match(/\bname=["']([^"']*)["']/i);
    if (!nameMatch || !nameMatch[1]) continue;
    const valueMatch = tag.match(/\bvalue=["']([\s\S]*?)["']/i);
    result[decodeHtml_(nameMatch[1])] = decodeHtml_(valueMatch ? valueMatch[1] : '');
  }
  return result;
}

function extractCookieHeader_(response) {
  const headers = response.getAllHeaders();
  const raw = headers['Set-Cookie'] || headers['set-cookie'];
  if (!raw) return '';
  const values = Array.isArray(raw) ? raw : [raw];
  return values.map(function (item) {
    return String(item).split(';')[0];
  }).filter(Boolean).join('; ');
}

function assertHttpOk_(response, label) {
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(label + ' okunamadı. HTTP durum kodu: ' + code);
  }
}

function cleanHtmlText_(value) {
  return decodeHtml_(String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml_(value) {
  return String(value)
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); });
}

function parseTurkishNumber_(value) {
  const text = String(value || '')
    .replace(/[^\d,.\-]/g, '')
    .trim();
  if (!text) return NaN;
  if (text.indexOf(',') >= 0) {
    return Number(text.replace(/\./g, '').replace(',', '.'));
  }
  // Türkçe gösterimde virgül yoksa "1.250" çoğunlukla 1.250 değil,
  // bin iki yüz elli anlamına gelir. Tam üçlü nokta gruplarını binlik
  // ayırıcı olarak ele al; diğer noktalı değerleri ondalık bırak.
  if (/^-?\d{1,3}(?:\.\d{3})+$/.test(text)) {
    return Number(text.replace(/\./g, ''));
  }
  return Number(text);
}

function decimalPlaces_(value) {
  const text = String(value || '').trim();
  const match = text.match(/,(\d+)\s*$/);
  return match ? Math.max(0, Math.min(4, match[1].length)) : 2;
}

function normalizeCode_(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

function normalizeCurrency_(value) {
  const text = String(value || '').trim().toUpperCase();
  if (text === 'TL' || text === 'TRY' || text === '₺') return 'TL';
  if (text === 'EUR' || text === '€') return 'EUR';
  if (text === 'USD' || text === '$') return 'USD';
  return '';
}

function detectCurrency_(format, display) {
  const text = String(format || '') + ' ' + String(display || '');
  if (text.indexOf('₺') >= 0 || /\bTL\b/i.test(text)) return 'TL';
  if (text.indexOf('€') >= 0 || /\bEUR\b/i.test(text)) return 'EUR';
  if (text.indexOf('$') >= 0 || /\bUSD\b/i.test(text)) return 'USD';
  return '';
}

function currencyFormat_(currency, decimals) {
  const places = Math.max(0, Math.min(4, Number(decimals) || 2));
  const fraction = places ? '.' + '0'.repeat(places) : '';
  if (currency === 'TL') return '#,##0' + fraction + ' "₺"';
  if (currency === 'EUR') return '"€"#,##0' + fraction;
  if (currency === 'USD') return '"$"#,##0' + fraction;
  return '#,##0' + fraction;
}

function makeConsecutiveRuns_(items) {
  const runs = [];
  items.forEach(function (item) {
    const lastRun = runs[runs.length - 1];
    if (lastRun && lastRun[lastRun.length - 1].row + 1 === item.row) {
      lastRun.push(item);
    } else {
      runs.push([item]);
    }
  });
  return runs;
}

function ensureHistorySheet_(spreadsheet) {
  const ss = spreadsheet || SpreadsheetApp.openById(MAGMA_CONFIG.spreadsheetId);
  let sheet = ss.getSheetByName(MAGMA_CONFIG.historySheet);
  if (!sheet) {
    sheet = ss.insertSheet(MAGMA_CONFIG.historySheet);
    sheet.getRange(1, 1, 1, 11).setValues([[
      'Tarih/Saat', 'Durum', 'Sekme', 'Ürün Kodu', 'Ürün Adı',
      'Eski Fiyat', 'Yeni Fiyat', 'Eski Para Birimi',
      'Yeni Para Birimi', 'Açıklama/Kaynak', 'Eşleşen üretici kodu'
    ]]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 11)
      .setFontWeight('bold')
      .setBackground('#1f4e78')
      .setFontColor('#ffffff');
    sheet.setColumnWidths(1, 11, 140);
    sheet.setColumnWidth(5, 260);
    sheet.setColumnWidth(10, 360);
    sheet.setColumnWidth(11, 190);
  }
  // Existing history sheets may retain currency/scientific formats on code rows.
  sheet.getRange(1, 11).setValue('Eşleşen üretici kodu');
  sheet.getRange('D:D').setNumberFormat('@');
  sheet.getRange('K:K').setNumberFormat('@');
  return sheet;
}

function appendHistory_(sheet, rows) {
  if (!rows || !rows.length) return;
  const startRow = sheet.getLastRow() + 1;
  const requiredLastRow = startRow + rows.length - 1;
  if (requiredLastRow > sheet.getMaxRows()) {
    sheet.insertRowsAfter(
      sheet.getMaxRows(),
      Math.max(MAGMA_CONFIG.historyExtraRows, requiredLastRow - sheet.getMaxRows())
    );
  }
  const literalRows = rows.map(function (row) {
    return Array.from({ length: 11 }, function (_, index) {
      const value = row[index] == null ? '' : row[index];
      return typeof value === 'string' && value.startsWith('=') ? "'" + value : value;
    });
  });
  sheet.getRange(startRow, 1, literalRows.length, 11).setValues(literalRows);
}

/**
 * Üç günlük geçmiş temizleme sayacını bugünden başlatır.
 * Kurulumdan veya kural değişikliğinden sonra bir kez çalıştırılır.
 */
function initializeThreeDayHistoryCycle() {
  const now = new Date();
  PropertiesService.getScriptProperties().setProperty(
    MAGMA_CONFIG.historyResetProperty,
    String(now.getTime())
  );
  const nextReset = new Date(
    now.getTime() + MAGMA_CONFIG.historyResetDays * 24 * 60 * 60 * 1000
  );
  const result = {
    startedAt: formatDate_(now),
    nextResetAfter: formatDate_(nextReset)
  };
  console.log(JSON.stringify(result));
  return result;
}

function resetHistoryIfDue_(sheet) {
  const properties = PropertiesService.getScriptProperties();
  const now = Date.now();
  const lastReset = Number(properties.getProperty(MAGMA_CONFIG.historyResetProperty));
  const resetIntervalMs = MAGMA_CONFIG.historyResetDays * 24 * 60 * 60 * 1000;

  if (!Number.isFinite(lastReset) || lastReset <= 0) {
    properties.setProperty(MAGMA_CONFIG.historyResetProperty, String(now));
    return false;
  }
  if (now - lastReset < resetIntervalMs) return false;

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 11).clearContent();
  }
  properties.setProperty(MAGMA_CONFIG.historyResetProperty, String(now));
  return true;
}

/**
 * İlk kurulum sırasında dosyanın saat dilimiyle yazılmış geçmiş tarihlerini
 * İstanbul saatine çevirir. Tek sefer çalıştırılması yeterlidir.
 */
function repairHistoryTimeZone() {
  const ss = SpreadsheetApp.openById(MAGMA_CONFIG.spreadsheetId);
  const sheet = ensureHistorySheet_(ss);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const range = sheet.getRange(2, 1, lastRow - 1, 1);
  const values = range.getValues();
  let changed = 0;
  values.forEach(function (row) {
    if (Object.prototype.toString.call(row[0]) === '[object Date]' && !isNaN(row[0].getTime())) {
      row[0] = formatDate_(row[0]);
      changed++;
    }
  });
  range.setValues(values);
  console.log('İstanbul saatine çevrilen geçmiş kaydı: ' + changed);
  return changed;
}

function installDailyTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'updateMagmaweldPrices') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('updateMagmaweldPrices')
    .timeBased()
    .atHour(9)
    .everyDays(1)
    .inTimezone(MAGMA_CONFIG.timeZone)
    .create();
}

function formatDate_(date) {
  return Utilities.formatDate(date, MAGMA_CONFIG.timeZone, 'dd.MM.yyyy HH:mm:ss');
}

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


const TRAFIMET_CATALOGUE_URL = "https://www.trafimet.com/images/CATALOGHI/EA2775-Torches-Catalogue-lores-042026_compressed.pdf";
const TRAFIMET_CATALOGUE_CODES = new Set(["AR0052", "AR0054", "BW0020", "BW0056", "BW0061", "BW0062", "BW0063", "BW0064", "BW0065", "BW0066", "BW0067", "BW0139", "BW0311", "BW0424", "BW0993", "BW0994", "BW1387-SP", "BW1388-SP", "BW1389-SP", "BW1390-SP", "BW1391-SP", "BW1392-SP", "BW1393-SP", "BW1394-SP", "BX0020", "BX0044", "BX0046", "BX0047", "BX0070", "BX0251", "BX0283", "BX0478", "BX0481", "BX0702", "BX0917", "BX1421-030", "BX1421-040", "BX1421-050", "CV0008", "CV0009", "CV0010", "CV0011", "CV0012", "CV0013", "CV0014", "CV0021", "CV0022", "CV0023", "CV0024", "CV0025", "CV0026", "CV0028", "CV0033", "CV0036", "CV0037", "CV0038", "CV0039", "CV0051", "CV0052", "CV0073", "CV0074", "CV0076", "CV0083", "CV0201", "CV0229", "CV0279", "CV0298", "CV0383P", "CV0384P", "CV0385P", "CV0386P", "CV0388P", "CV1105", "CV1106", "CV1117", "CV1118", "CX0025", "CX0077", "CX0079", "CX0080", "CX0087", "EA0129", "EA0130", "EA0131", "EA0223", "EA0303", "EA0304", "EA0326", "EA2367", "F11680", "F11681", "F11682", "F11683", "F11685", "F11687", "F11688", "F11689", "F11690", "F11691", "F11692", "F11693", "F11694", "F11695", "F11696", "F11697", "F11698", "F11699", "F11700", "F11701", "F11702", "FA0026", "FB0117", "FB1278", "FH0211", "FH0213", "FH0215", "FH0560", "FH0562", "FH0563", "FH0647", "FH0847", "FH0866", "FH0979", "FH0980", "FH1716P", "FY0002", "FY0018", "FY0022", "FY0023", "FY0043", "FY0080", "FY0090", "GM0012", "GM0013", "GM0226", "GM0241", "GM0310", "GM0331", "GM0332", "GM0334", "GM0335", "GM0337", "GM0500", "GM0501", "GM0502", "GM0510", "GM0511", "GM0512", "GM0526", "GM0527", "GM0528", "GM0530", "GM0531", "GM0532", "GM0534", "GM0535", "GM0540", "GM0541", "GM0542", "GM0610", "GM0611", "GM0612", "GM0625", "GM0626", "GM0627", "GM0705", "GM0706", "GM0715", "GM0716", "GM0720", "GM0721", "GM0722", "GM0726", "GM0760", "GM0761", "GM0762", "MA4200-030", "MA4200-040", "MA4200-050", "MA4201-030", "MA4201-040", "MA4201-050", "MA4202-030", "MA4202-040", "MA4202-050", "MA4202-060", "MA4202-080", "MA4203-030", "MA4203-040", "MA4203-050", "MA4204-030", "MA4204-040", "MA4204-050", "MA4204-060", "MA4204-080", "MA4209-030", "MA4209-040", "MA4209-050", "MA4230-030", "MA4230-040", "MA4230-050", "MA4232-030", "MA4232-030-4505", "MA4232-030-4510", "MA4232-040", "MA4232-040-4505", "MA4232-040-4510", "MA4232-050", "MA4232-050-4505", "MA4232-050-4510", "MA4234-030", "MA4234-030-4505", "MA4234-030-4510", "MA4234-030-60SH", "MA4234-040", "MA4234-040-4505", "MA4234-040-4510", "MA4234-040-60SH", "MA4234-050", "MA4234-050-4505", "MA4234-050-4510", "MA4234-050-60SH", "MA4250-030", "MA4250-040", "MA4250-050", "MA4251-030", "MA4251-040", "MA4251-050", "MA4260-030", "MA4260-040", "MA4260-050", "MA4262-030", "MA4262-040", "MA4262-050", "MA4264-030", "MA4264-040", "MA4264-050", "MA4501A030", "MA4501A030A", "MA4501A040", "MA4501A040A", "MA4501A050", "MA4501A050A", "MA4501C030", "MA4501C030A", "MA4501C040", "MA4501C040A", "MA4501C050", "MA4501C050A", "MA4501F030", "MA4501F030A", "MA4501F040", "MA4501F040A", "MA4501F050", "MA4501F050A", "MA4502B030", "MA4502B030A", "MA4502B040", "MA4502B040A", "MA4502B050", "MA4502B050A", "MA4502D030", "MA4502D030A", "MA4502D040", "MA4502D040A", "MA4502D050", "MA4502D050A", "MA4502G030", "MA4502G030A", "MA4502G040", "MA4502G040A", "MA4502G050", "MA4502G050A", "MA4503B030", "MA4503B030A", "MA4503B040", "MA4503B040A", "MA4503B050", "MA4503B050A", "MA4503E030", "MA4503E030A", "MA4503E040", "MA4503E040A", "MA4503E050", "MA4503E050A", "MB2600-030", "MB2600-040", "MB2600-050", "MB2601-030", "MB2601-040", "MB2601-050", "MB2602-030", "MB2602-030-3000", "MB2602-030-5010", "MB2602-030-5016", "MB2602-030-5030", "MB2602-030-5050", "MB2602-030-5070", "MB2602-040", "MB2602-040-3000", "MB2602-040-5010", "MB2602-040-5016", "MB2602-040-5030", "MB2602-040-5050", "MB2602-040-5070", "MB2602-050", "MB2602-050-3000", "MB2602-050-5010", "MB2602-050-5016", "MB2602-050-5030", "MB2602-050-5050", "MB2602-050-5070", "MB2602-060", "MB2602-080", "MB2603-030", "MB2603-040", "MB2603-050", "MB2631-030", "MB2631-030-3000", "MB2631-040", "MB2631-040-3000", "MB2631-050", "MB2631-050-3000", "MB2632-030", "MB2632-030-3000", "MB2632-030-3005", "MB2632-030-3016", "MB2632-030-5005", "MB2632-030-5016", "MB2632-040", "MB2632-040-3000", "MB2632-040-3005", "MB2632-040-3016", "MB2632-040-5005", "MB2632-040-5016", "MB2632-050", "MB2632-050-3000", "MB2632-050-3005", "MB2632-050-3016", "MB2632-050-5005", "MB2632-050-5016", "MB2650-030", "MB2650-040", "MB2650-050", "MB2651-030", "MB2651-040", "MB2651-050", "MB2652-030", "MB2652-040", "MB2652-050", "MB4501A030", "MB4501A040", "MB4501A050", "MB4502B030", "MB4502B040", "MB4502B050", "MB4503B030", "MB4503B040", "MB4503B050", "MC0008", "MC0009", "MC0010", "MC0011", "MC0012", "MC0013", "MC0017", "MC0018", "MC0022", "MC0023", "MC0024", "MC0027", "MC0290", "MC0301", "MC0302", "MC0527", "MC0540", "MC0568", "MC0576", "MD0003-08", "MD0003-10", "MD0003-12", "MD0004-08", "MD0004-10", "MD0004-12", "MD0005-08", "MD0005-10", "MD0005-12", "MD0005-14", "MD0005-16", "MD0005-38", "MD0005-40", "MD0005-42", "MD0005-46", "MD0005-58", "MD0005-60", "MD0005-62", "MD0005-66", "MD0005-78", "MD0005-80", "MD0005-82", "MD0005-84", "MD0005-86", "MD0008-06", "MD0008-08", "MD0008-10", "MD0008-12", "MD0008-38", "MD0008-40", "MD0008-42", "MD0009-06", "MD0009-08", "MD0009-10", "MD0009-12", "MD0009-14", "MD0009-16", "MD0009-38", "MD0009-40", "MD0009-42", "MD0009-58", "MD0009-60", "MD0009-62", "MD0009-78", "MD0009-80", "MD0009-82", "MD0063-00", "MD0064-00", "MD0131-00", "MD0132-00", "MD0250-78", "MD0250-80", "MD0250-82", "MD0250-86", "MD0300-08", "MD0300-10", "MD0300-12", "MD0300-80", "MD1005-10", "MD1005-12", "MD1005-16", "MD1005-80", "MD1005-82", "MD1005-86", "MD1009-08", "MD1009-10", "MD1009-12", "ME0016", "ME0017", "ME0040", "ME0076", "ME0079", "ME0084", "ME0113-SP", "ME0116-SP", "ME0370-SP", "ME0372-SP", "ME0373-SP", "ME0374-SP", "ME0375-SP", "ME0381-SP", "ME0382-SP", "ME0383-SP", "ME0384-SP", "ME0385-SP", "ME0390", "ME0400", "ME0402", "ME0417", "ME0479", "ME0517", "ME0579", "ME0584", "MF1515", "MF1516", "MF1517", "MF1519", "MF1546-SP", "MF1547-SP", "MF1548-SP", "MG0284", "MG0285", "MG0286", "MG0287", "MG0307-SP", "MG0308-SP", "MG0309-SP", "MG0310-SP", "MH0816-030", "MH0816-040", "MH0816-050", "MH0817-030", "MH0817-040", "MH0817-050", "MH0818-030", "MH0818-040", "MH0818-050", "MH0819-030", "MH0819-040", "MH0819-050", "MH0820-030", "MH0820-040", "MH0820-050", "MH0821-030", "MH0821-040", "MH0821-050", "MN2014-030", "MN2014-040", "MN2014-050", "MN2015-030", "MN2015-040", "MN2015-050", "MQ0125-030", "MQ0125-040", "MQ0125-050", "MQ0127-030", "MQ0127-040", "MQ0127-050", "MQ0388-030", "MQ0388-040", "MQ0388-050", "MT0211", "MT0560", "MT0561", "MT0562", "MT0563", "MT0564", "MT0565", "MT0566", "MT0568", "PA0145", "PA1240", "PA1242", "PA1272", "PA1393", "PA1682", "PA2210", "PAA106M-000-WA3", "PAA106M-004-WA3", "PAA206M-000-WA3", "PAA206M-004-WA3", "PAA306M-000-WA3", "PAA306M-004-WA3", "PAA406M-000-WA3", "PAA406M-004-WA3", "PAE006M-001-WA3", "PAE006M-060-WA3", "PAE106M-001-WA3", "PAE106M-060-WA3", "PAE306M-003-WA3", "PAE306M-060-WA3", "PAP306M-004-SA3", "PAP306M-004-SC3", "PAP312M-004-SA3", "PAP312M-004-SC3", "PAP406M-004-SA3", "PAP406M-004-SC3", "PAP412M-004-SA3", "PAP412M-004-SC3", "PAS306M-000-WA3", "PAS306M-004-WA3", "PAS306M-304-WA3", "PAS406M-000-WA3", "PAS406M-004-WA3", "PAS506M-000-WA3", "PAS506M-004-WA3", "PAS506M-304-WA3", "PAS606M-000-WA3", "PAS606M-004-WA3", "PAS706M-000-WA3", "PAS706M-004-WA3", "PAS706M-304-WA3", "PB0003", "PB0006", "PC0002", "PC0003", "PC0032", "PC0034", "PC0098", "PC0101", "PC0102", "PC0103", "PC0109", "PC0111", "PC0113", "PC0114", "PC0115", "PC0116", "PC0117", "PC0118", "PC0120", "PC0130", "PC0131", "PC0135", "PC0179", "PC0279", "PC0370P", "PC0371P", "PD0015-10", "PD0015-12", "PD0025-14", "PD0025-16", "PD0025-18", "PD0026-11", "PD0026-13", "PD0026-16", "PD0026-18", "PD0063-10", "PD0063-12", "PD0088-10", "PD0088-12", "PD0098-08", "PD0098-10", "PD0101-11", "PD0101-14", "PD0101-17", "PD0101-19", "PD0102-08", "PD0105-10", "PD0105-12", "PD0109-14", "PD0109-16", "PD0109-18", "PD0111-12", "PD0114-10", "PD0114-12", "PD0115-12", "PD0115-14", "PD0115-16", "PD0115-18", "PD0115-20", "PD0116-06", "PD0116-08", "PD0116-09", "PD0117-14", "PD0117-17", "PD0117-19", "PD0118-10", "PD0119-10", "PD0119-12", "PD0119-14", "PD0179-13", "PD0179-15", "PD0279-13", "PD0279-15", "PD0402P15", "PD0403P09", "PD0403P12", "PD0403P13", "PD0406P12", "PD0406P13", "PD0406P15", "PD0409P11", "PD0409P13", "PD0410P14", "PE0007", "PE0009", "PE0101", "PE0103", "PE0106", "PE0107", "PE0112", "PE0114", "PE0179", "PE0362P", "PE0363P", "PF0030", "PF0033", "PF0050", "PF0065", "PF0080", "PF0090", "PF0102", "PF0127", "PF0128", "PF0131", "PF0135", "PF0136", "PF0137", "PF0138", "PF0140", "PF0145", "PF0155", "PF0160", "PF1390", "PG0006", "PR0017", "PR0034", "PR0063", "PR0064", "PR0065", "PR0098", "PR0101", "PR0105", "PR0109", "PR0110", "PR0116", "PR0117", "PR0118", "PR0119", "PR0179", "PR0245", "PR0279", "PR0362P", "PR0363P", "PT0030", "PT1045", "PT1065", "PT1085", "PT1105", "QA0019", "QA0020", "QA0021", "QA0030-030", "QA0030-040", "QA0030-050", "QB0230-030", "QB0230-040", "QB0230-050", "QB0231-030", "QB0231-040", "QB0231-050", "QB0232-030", "QB0232-040", "QB0232-050", "SH4431-00", "SH4831-00", "SM4431-00", "SM4831-00", "TA0904S-511-WA3", "TA0908S-511-WA3", "TA1704S-511-WA3", "TA1708S-511-WA3", "TA2604S-511-WA3", "TA2608S-511-WA3", "TB1804S-511-WA3", "TB1808S-511-WA3", "TB2004S-511-WA3", "TB2008S-511-WA3", "TC0002", "TC0003", "TC0004", "TC0005", "TC0006", "TC0007", "TC0008", "TC0012", "TC0013", "TC0014", "TC0015", "TC0016", "TC0017", "TC0021", "TC0022", "TC0023", "TC0024", "TC0027", "TC0028", "TC0031", "TC0032", "TC0033", "TC0034", "TC0035", "TC0036", "TC0037", "TC0041", "TC0042", "TC0043", "TC0044", "TC0045", "TC0086", "TC0087", "TC0088", "TC0091", "TC0092", "TC0093", "TC0096", "TC0097", "TC0098", "TC0101", "TC0102", "TC0103", "TC0118", "TC0119", "TC0120", "TD0001-10", "TD0001-16", "TD0001-20", "TD0001-24", "TD0001-32", "TD0001-40", "TD0001-48", "TD0003-10", "TD0003-16", "TD0003-20", "TD0003-24", "TD0003-32", "TD0004-16", "TD0004-24", "TD0005-16", "TD0005-24", "TD0022-16", "TD0022-24", "TD0022-32", "TD0022-40", "TD0088-16", "TD0088-20", "TD0088-24", "TD0088-32", "TD0097-16", "TD0097-24", "TD0097-32", "TD0097-40", "TD0097-48", "TE0001-10", "TE0001-16", "TE0001-20", "TE0001-24", "TE0001-32", "TE0001-40", "TE0001-48", "TE0003-10", "TE0003-16", "TE0003-20", "TE0003-24", "TE0003-32", "TE0004-16", "TE0004-24", "TE0005-16", "TE0005-20", "TE0005-24", "TE0005-32", "TE0006-16", "TE0006-20", "TE0006-24", "TE0006-32", "TE0006-40", "TE0009-16", "TE0009-24", "TE0009-32", "TE0009-40", "TE0025-24", "TE0097-16", "TE0097-24", "TE0097-32", "TE0097-40", "TF0009", "TF0010", "TF0017", "TF0022", "TF0026", "TF0027", "TF0109", "TF0117", "TF0118", "TF0126", "TF0127", "TF0222", "TF0224", "TF1000", "TF1001", "TG0018", "TG0020", "TG0118", "TG0220", "TG0912", "TG0913", "TG0917", "TG1001", "TP0301", "TP0302", "TP0303", "TP0310", "TP0320", "TQ0001", "TQ0002", "TQ0003", "TQ0027", "TR0002-10", "TR0002-16", "TR0002-20", "TR0002-24", "TR0002-32", "TR0002-40", "TR0008-10", "TR0008-16", "TR0008-20", "TR0008-24", "TR0008-32", "TR0008-40", "TR0012-16", "TR0012-24", "TR0012-32", "TR0014-10", "TR0014-16", "TR0014-20", "TR0014-24", "TR0014-32", "TR0014-40", "TR0018-10", "TR0018-16", "TR0018-20", "TR0018-24", "TR0018-32", "TR0018-40", "TR0022-10", "TR0022-16", "TR0022-20", "TR0022-24", "TR0022-32", "TR0022-40", "TT0018", "TT0108", "TT0611", "TT0612", "TT0613", "TT0620", "TT0630", "TT0631", "TT0632", "TT0633", "TT0634"]);
