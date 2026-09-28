# Buxoro Tibbiyot Tizimi — Railway

WEB/PWA elektron murojaat tizimining Railway uchun versiyasi.

## Arxitektura
- Frontend: static HTML/CSS/JS/PWA
- Backend: Node.js + Express
- Ma'lumotlar: PostgreSQL
- Ovozli murojaatlar: PostgreSQL `BYTEA`, maksimum 3 MB
- Admin: `/boshliq/`
- Healthcheck: `/api/health`

## Environment variables
`DATABASE_URL`, `BOSHQARMA_LOGIN`, `BOSHQARMA_PASSWORD`, `AUTH_SECRET`.

## Ishga tushirish
```bash
npm install
npm start
```
