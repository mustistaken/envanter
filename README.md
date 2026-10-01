# Teknikel

## 14.39

- Kur çevirisindeki kuruştan küçük farklar “0,00 ₺ fiyat değişti” uyarısı oluşturmaz. Fiyat değişimleri teklif hesabıyla aynı kuruş hassasiyetinde karşılaştırılır.

## 14.38

- Günlük Apps Script güncellemesi önce üretici kodunu, sonra yalnızca kategori, tam ürün adı, ölçü ve ambalajı tek bir güncel ürüne eşleşen kayıtları kullanır. Benzer model veya farklı ambalaj tahminle eşleştirilmez. Fiziksel barkodlar, favoriler ve sepet kimlikleri korunur.
- Özel ana Sheet'teki “Ürün Eşleştirme” sekmesi tüm katalog satırlarının sonucunu ve kaynağını kaydeder. Üretici ve fiziksel kod sütunları metin biçimindedir; `7042E00001` gibi kodlar bilimsel gösterim olarak sayıya dönüşmez.
- Site, yayın Sheet'inin F:I sütunlarından eşleştirme durumunu, üretici kodunu, fiyat birimini ve son kontrol zamanını okur. Hem eski barkod hem üretici kodu aranabilir. Üreticinin belirttiği kg/adet birimi ürün, sepet, teklif ve CSV'de gösterilir; bilinmeyen birim varsayılmaz.
- Kaynakta tam karşılığı bulunmayan veya üretici fiyatı sıfır olan ürünlerin eski fiyatı korunur ve yeni teklif için teyit istenir. Eski sepet fiyatları otomatik değiştirilmez; “Fiyatları güncelle” fiyat ve birim bilgisini birlikte yeniler.
- 01.10.2026 kontrolünde 2.018 Magmaweld kaydının 1.952'si eşleşti: 28 yeni kod eşleştirmesi ve 16 fiyat güncellemesi uygulandı. 66 kayıt tam eşleşme, 6 kayıt sıfır üretici fiyatı nedeniyle inceleme bekliyor. İkinci manuel çalışma fiyatları yeniden değiştirmeden tamamlandı.
- Trafimet'in Nisan 2026 torç kataloğunda 920 benzersiz kod doğrulandı. Katalog fiyat içermediğinden Trafimet kaynak fiyatları Sheet'ten korunur; USD/EUR–TL formülleri kontrol edilir. “Sheet fiyatı” güncel üretici fiyatı doğrulaması değildir. Katalog kontrol tarihi sabittir; günlük saat Sheet/formül kontrolünü belirtir.
- Sonraki zamanlanmış Apps Script çalışması ayrıca doğrulanmalıdır. Kontroller: `node --test scripts/*.test.cjs` ve yayın öncesi güvenlik taraması.

## 14.37

- Ürün yenileme ve kur kontrol zamanları Türkiye saatinde (Europe/Istanbul) tutarlı gösterilir; kontrol saati kurun gerçek değişme saati olarak sunulmaz.
- Önceki sürüm önbelleğinde kur kontrol bilgisi bulunmadığında ilk çevrimiçi yenileme istenir. Doğrulanmış yeni önbellek çevrimdışı kullanılabilir.

## 14.36

- Fiyatı eksik, geçersiz veya para birimiyle TL hesabı uyumsuz ürünlerde sepete ekleme kapalıdır. Eski sepette eksik fiyat varsa toplam hesaplanmaz; teklif, PDF, paylaşım ve Excel aktarımı geçerli fiyat bekler. Gerçek sıfır fiyat korunur.
- “Fiyat kontrolü gerekli” filtresi inceleme isteyen ürünleri gösterir. Üretici listesinde bulunamayan eski fiyatlar tahminle değiştirilmez.
- Arama için ürün metinleri bir kez hazırlanır; benzerlik hesabı yalnızca doğrudan eşleşme olmadığında yapılır. Arka plan yenilemesi aynı adlı ürünlerde seçilen ürün kodunu korur. Aynı ürünün birebir tekrarları listede birleştirilir.
- Tüm veri istekleri başarısız olduğunda daha yeni açık sayfa verisi eski önbellekle değiştirilmez. Zaman aşımı yanıt gövdesi indirilirken de geçerlidir.
- Sürümü aynı JS/CSS ve görseller cihazdaki önbellekten açılır. HTML kontrolü 8 saniyede sonlanır; sunucu hatasında kayıtlı uygulama açılır. Farklı JS/CSS sürümleri çevrimdışıyken birbirinin yerine kullanılmaz.
- Tanınmayan kamera barkodu benzer ürünü seçmez; kamera sayfadan ayrılırken kapatılır. Gerçek kamera/iOS testi ayrıca gerekir.
- Testler: `node --test scripts/*.test.cjs`.

### Bağlı Apps Script

- Geçmiş tablosundaki türü belirtilmiş tarih sütununa sayı biçimi uygulanması kaldırıldı; manuel çalıştırma doğrulandı.
- Günlük fiyat güncellemesi, üreticide bulunan ürünlerin TL formülünü kaynak para birimiyle karşılaştırır. Basit kaynak/kur formülleri düzeltilir; özel formüller kontrol için kaydedilir.
- Kategori başlıkları eksik ürün sayılmaz. Üreticide bulunamayan SKU’lar önceki fiyatları korunarak geçmişe ürün koduyla yazılır.
- Kaynak okuma, kategori sayısı ve çelişen ürün kodu denetimleri; kilit ve günlük tetikleyici korunur. Sonraki zamanlanmış çalışmanın sonucu ayrıca kontrol edilmelidir.

## 14.35

- Kur göstergesi, ürün fiyatlarını hesaplayan Google Sheets kurlarını `Kurlar!A1:B3` üzerinden okur. Eski Frankfurter önbelleği kullanılmaz; bağlantı koparsa son Sheet kaydı açıkça belirtilir.
- Sepette değişen fiyatlar uyarılır ve yalnızca “Fiyatları güncelle” seçildiğinde güncellenir. Adet, iskonto ve geçmiş teklifler korunur; bulunamayan fiyatlar üzerine yazılmaz.
- Stok verisi olmadığında “Stok bilgisi yok” gösterilir; boş ve geçersiz stok değerleri sıfır sayılmaz.
- Ana Sheet yeniden hesaplama ayarı dakikalık yapıldı. Bu ayar GoogleFinance/IMPORTRANGE servis gecikmesini ortadan kaldırmaz ve Apps Script tetikleyicisi doğrulaması değildir.

## 14.34

- Ürün verileri ve USD/EUR referans kurları, site görünür ve çevrimiçiyken 5 dakikada bir kontrol edilir. Uygulamaya geri dönüldüğünde süresi dolmuş veriler, internet geri geldiğinde ise veriler hemen yenilenir.
- “Veriyi yenile” düğmesi hem ürünleri hem kur göstergesini günceller. Aynı anda başlayan yenilemeler tek istekte birleştirilir.
- Tablo başlıkları ve fiyatsız kategori grupları ürün listesine alınmaz; eski ürün önbelleği de aynı kontrolden geçer.
- Regresyon kontrolleri: `node --test scripts/inventory-regression.test.cjs`.

## Önceki davranışlar

- Ürün kimliği kategori ve barkoddan oluşturulur. Barkodsuz kayıtlarda ürün adı kullanılır.
- Eski favoriler aynı adı taşıyan tüm mevcut barkodlara taşınır. Eski sürümde birleşmiş sepet satırlarının kaybolan barkod/adet bilgisi geri üretilemez; bu sepetler kullanıcı tarafından kontrol edilmelidir.
- İskonto cihazda saklanır. Tutarlar ekranda gösterilen kuruş hassasiyetindeki birim fiyatlarla hesaplanır.
- Tam veri önbelleği başarısız veya kısmi yenilemeyle silinmez. Eski veri tarih ve uyarı ile gösterilir.
- Ayarlar menüsünden kişisel kayıtlar JSON olarak yedeklenebilir ve doğrulama sonrasında geri yüklenebilir. Yedek müşteri bilgileri içerebilir; özel saklanmalıdır.
- Cihazda kayıt başarısız olduğunda kullanıcıya uyarı gösterilir.

Yayın öncesi `scripts/security-check.ps1` çalıştırılmalıdır. `index.html`, `app.js` ve `service-worker.js` sürüm numaraları birlikte güncellenmelidir. Gerçek iOS kamera ve ana ekran uygulaması kontrolleri ayrıca yapılmalıdır.
