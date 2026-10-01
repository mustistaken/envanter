Security notes for Teknikel Akıllı Envanter

Current data model
- The site does not use Google Sign-In and does not store authentication tokens.
- Inventory data is read from the separate, read-only "Teknikel Envanter - Web Yayını" spreadsheet.
- The publication spreadsheet contains the eight inventory/product tabs, Kurlar and Eşleştirme publication tabs used by the site.
- The private source spreadsheet remains restricted. _Kullanıcı Sepetleri and Fiyat Güncelleme Geçmişi are not present in the public workbook.
- The public workbook uses IMPORTRANGE to receive current product data from the private source workbook.
- Eşleştirme imports only the product key, matching status, manufacturer code, price unit and check timestamp (A:E) from the private product-matching report. Customer records and private execution history are excluded. Catalogue F:I columns look up this product metadata.
- Unmatched products, zero supplier prices and invalid matching metadata cannot create new quotes. Manufacturer codes are kept as text and original barcode identities are preserved.
- Basket, favorites, customer profiles and offer history are stored only in the current browser's localStorage. Users can permanently clear current and legacy account-scoped records from the settings menu.
- Google Sheets and exchange-rate requests, including response-body download, are cancelled after 12 seconds so a stalled service cannot leave the interface waiting indefinitely.
- Product data is intentionally public to anyone who knows the website or publication-sheet URL.
- The service worker caches only the static app shell. Google Sheets responses are not cached by the service worker.

Publishing checklist
- [x] Google Sign-In, redirect authentication and token persistence removed.
- [x] Private user-basket and price-history tabs excluded from the public workbook.
- [x] Public workbook is read-only for link visitors.
- [x] Static app-shell cache version is updated with every release.
- [x] Run scripts\security-check.ps1 before publishing.
- [ ] Add a tested Content-Security-Policy after all external dependencies are enumerated.

