# Tekshiruv hisoboti — 2026-09-12

## Avtomatik tekshiruv

- `python manage.py check`: **0 issue**
- `python manage.py test`: **11/11 passed**
- `python manage.py makemigrations --check --dry-run`: **No changes detected**
- production parametrlar bilan `python manage.py check --deploy`: **0 issue**

Testlar mavjud ishchi muhitdagi Django 6.1.1 bilan bajarildi. Production `requirements.txt` esa uzoq muddatli qo'llab-quvvatlash (LTS) liniyasidagi Django 5.2.17 ga pin qilingan; ishlatilgan model/migration API'lari 5.2 liniyasida mavjud.

## Data security tekshiruvi

Migratsiyadan keyingi mavjud bazada:

- User: 10
- Doctor profile: 4
- Patient profile: 2
- Appointment: 5
- Tanish Django password hashiga mos kelmaydigan saqlangan password qiymati: **0**
- Legacy xavfsiz bo'lmagan paroli bekor qilingan account: **3**
- Faol, non-staff va doctor/patient profilsiz account: **0**

Bekor qilingan 3 account credentiali oshkor qilinmadi; ularga reset orqali yangi parol berish talab qilinadi.

## Android build holati

Android source, Gradle konfiguratsiyasi, manifest, HTTPS network security config va GitHub Actions APK build workflow tayyor. Ushbu ishchi muhitda Android SDK/build-tools mavjud bo'lmagani va Google Android SDK hostiga tarmoqdan chiqish bloklangani sabab bu sessiyada `.apk` binari kompilyatsiya qilinmadi. `android-apk.yml` Android SDK mavjud GitHub runnerida `app-debug.apk`ni build qilish uchun tayyor.
