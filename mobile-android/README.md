# Hospital Management Android APK

Bu Android klient serverdagi Django tizimini HTTPS orqali ochadi. Birinchi ishga tushishda production server manzilini kiriting, masalan `https://hospital.example.uz`.

Xavfsizlik:
- HTTP bloklangan; faqat HTTPS qabul qilinadi.
- SSL sertifikat xatolari bypass qilinmaydi.
- WebView faqat tanlangan server hosti ichida navigatsiya qiladi; boshqa havolalar tashqi brauzerda ochiladi.
- `addJavascriptInterface` ishlatilmaydi.
- file/content access o‘chirilgan, mixed content bloklangan.
- Profil rasmi kabi `<input type=file>` yuklash qo‘llanadi.

Build:
1. Android Studio bilan `mobile-android` papkasini oching.
2. SDK 35 o‘rnatilgan bo‘lsin.
3. `Build > Build APK(s)`.

GitHub Actions orqali ham APK avtomatik build qilinadi (`android-apk.yml`).
