# Hospital Management — production paket

Bu paket eski Hospital Management loyihasining xavfsizlik, rollar, qabul yozuvi, mobil moslashuv va deploy qismlari qayta ishlangan variantidir. `README.md` original loyiha haqidagi ma'lumotni saqlaydi.

## Tuzatilgan asosiy joylar

- `SECRET_KEY`, host, CSRF, email, database va security parametrlar environment orqali boshqariladi.
- `DEBUG=False` production rejim, secure cookie, HTTPS redirect, HSTS, X-Frame-Options, CSP va Permissions-Policy qo'shildi.
- Shifokor va bemor rollari alohida himoyalangan. Public Doctor self-registration standart holatda o'chirilgan.
- Legacy bazadagi Django hash bo'lmagan parollar bekor qilindi; foydalanuvchi password reset orqali yangi parol o'rnatadi.
- Password reset tokenining faqat SHA-256 digesti bazada saqlanadi, tokenning amal qilish muddati bor va email mavjudligini oshkor qilmaydi.
- Blog edit/view ownership tekshirildi; boshqa shifokorning qoralamasini ko'rish yoki tahrirlash bloklandi.
- `|safe` orqali foydalanuvchi matnini majburan HTML qilish olib tashlandi.
- Rasm yuklash turi va hajmi cheklangan.
- Bir shifokorning bir sana/vaqtiga ikki faol qabulni DB constraint ham bloklaydi.
- Bekor qilingan slot qayta band qilinishi mumkin; o'tib ketgan sanaga yozilish bloklanadi.
- Dashboardlardagi soxta demo Medicine/Birthday/Reminder raqamlari olib tashlandi; bazadagi real appointment ma'lumotlari ko'rsatiladi.
- Bootstrap bitta 5.3.8 versiyaga keltirildi; mobil responsiv CSS qo'shildi.
- Docker, Gunicorn, WhiteNoise, PostgreSQL/SQLite, Railway va Render konfiguratsiyasi qo'shildi.
- `/health/` endpoint qo'shildi.
- Android `mobile-android/` klienti qo'shildi: faqat HTTPS, SSL xatosini bypass qilmaydi, tanlangan server originidan tashqariga WebView ichida chiqmaydi, cleartext/file access bloklangan.

## Lokal ishga tushirish

Python 3.12–3.14 tavsiya qilinadi.

```bash
python -m venv .venv
# Linux/macOS
. .venv/bin/activate
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

Development uchun `.env` qiymatlarini shell environment sifatida yuklang yoki IDE orqali kiriting. So'ng:

```bash
python manage.py migrate
python manage.py runserver
```

## Railway — internetga chiqarish

Eng barqaror variant: Docker + PostgreSQL + media uchun persistent volume.

1. Loyihani **private GitHub repository**ga joylang. `db.sqlite3`, `deployment_seed.json` va `media/` fayllarini public repoga commit qilmang.
2. Railway'da yangi Project yarating va repo'ni ulang. `railway.json`/`Dockerfile` avtomatik ishlaydi.
3. PostgreSQL servis qo'shing; uning `DATABASE_URL` qiymatini web servisga ulang.
4. Variables:
   - `DEBUG=False`
   - `SECRET_KEY=<uzun random secret>`
   - `RAILWAY_PUBLIC_DOMAIN` Railway tomonidan beriladi
   - `MEDIA_ROOT=/data/media`
   - email ishlatilsa SMTP qiymatlari `.env.example` bo'yicha
5. `/data` mount point bilan persistent Volume ulang. Bu foydalanuvchi yuklagan rasmlarni restartdan keyin saqlaydi.
6. Eski ma'lumotlarni yangi PostgreSQL bazaga birinchi marta ko'chirish kerak bo'lsa, `deployment_seed.json`ni serverga **private** tarzda joylashtiring va `LOAD_INITIAL_DATA=True` bilan bir marta ishga tushiring. Seed command bazada users mavjud bo'lsa qayta import qilmaydi.
7. Deploydan keyin `https://<domain>/health/` `{"status":"ok"}` qaytarishi kerak.

### SQLite bilan soddaroq variant

PostgreSQLsiz ishlasa, Railway volume mount `/data`, `SQLITE_PATH=/data/db.sqlite3` va `MEDIA_ROOT=/data/media` qo'ying. Entrypoint birinchi ishga tushishda paketdagi secured SQLite bazani volume'ga nusxalaydi. Bir nechta parallel web worker kerak bo'lsa PostgreSQL ishlating.

## Android APK klient

Kod: `mobile-android/`.

Ilova birinchi ochilganda server manzilini so'raydi. Masalan:

```text
https://hospital.example.uz
```

HTTP manzil qabul qilinmaydi. Django login sessiyasi WebView cookie orqali saqlanadi. Foydalanuvchi profil rasmini telefondan tanlab yuklay oladi.

### Android Studio

`mobile-android` papkasini oching va **Build > Build APK(s)** bosing. SDK 35 kerak.

### GitHub Actions

`.github/workflows/android-apk.yml` private repoga push qilinganda yoki `workflow_dispatch` orqali ishga tushirilganda debug APK build qiladi. Natija GitHub Actions Artifact ichida `hospital-management-debug-apk` nomi bilan chiqadi.

Release/Play Store uchun o'zingizning private signing keystore'ingiz kerak; signing kalitini repoga yoki ushbu ZIPga saqlamang.

## Muhim xavfsizlik eslatmasi

Bu ZIP ichida foydalanuvchining avvalgi SQLite ma'lumotlari va media fayllari saqlangan. Paketni public GitHub/Telegram kanaliga qo'ymang. `.gitignore` shu sabab `db.sqlite3`, `deployment_seed.json` va `media/`ni commitdan chiqaradi.

Legacy bazada Django hash formatida bo'lmagan parol qiymatlari migratsiyada unusable passwordga aylantirildi. Ular plaintext sifatida paketda saqlanmaydi; tegishli foydalanuvchilar password reset qilishi kerak.
