# Teknikel

## 14.32

- Ürün kimliği kategori ve barkoddan oluşturulur. Barkodsuz kayıtlarda ürün adı kullanılır.
- Eski favoriler aynı adı taşıyan tüm mevcut barkodlara taşınır. Eski sürümde birleşmiş sepet satırlarının kaybolan barkod/adet bilgisi geri üretilemez; bu sepetler kullanıcı tarafından kontrol edilmelidir.
- İskonto cihazda saklanır. Tutarlar ekranda gösterilen kuruş hassasiyetindeki birim fiyatlarla hesaplanır.
- Tam veri önbelleği başarısız veya kısmi yenilemeyle silinmez. Eski veri tarih ve uyarı ile gösterilir.
- Ayarlar menüsünden kişisel kayıtlar JSON olarak yedeklenebilir ve doğrulama sonrasında geri yüklenebilir. Yedek müşteri bilgileri içerebilir; özel saklanmalıdır.
- Cihazda kayıt başarısız olduğunda kullanıcıya uyarı gösterilir.

Yayın öncesi `scripts/security-check.ps1` çalıştırılmalıdır. `index.html`, `app.js` ve `service-worker.js` sürüm numaraları birlikte güncellenmelidir. Gerçek iOS kamera ve ana ekran uygulaması kontrolleri ayrıca yapılmalıdır.
