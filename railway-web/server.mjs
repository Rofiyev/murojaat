import express from 'express';
import multer from 'multer';
import pg from 'pg';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);

const LOGIN = (process.env.BOSHQARMA_LOGIN || 'boshliq').trim();
const PASSWORD = process.env.BOSHQARMA_PASSWORD || 'Buxoro2026!';
const SECRET = process.env.AUTH_SECRET || 'CHANGE-ME-IN-RAILWAY';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL topilmadi. Railway Postgres ulanishi talab qilinadi.');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, max: 10, idleTimeoutMillis: 30000 });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 30 }
});

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

function clean(v, max = 250) {
  return String(v ?? '').trim().replace(/[\u0000-\u001F\u007F]/g, '').slice(0, max);
}
function cleanText(v, max = 4000) {
  return String(v ?? '').trim().replace(/[\u0000\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max);
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function sign(payload) { return createHmac('sha256', SECRET).update(payload).digest('base64url'); }
function makeToken(login) {
  const p = Buffer.from(JSON.stringify({ login, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
  return `${p}.${sign(p)}`;
}
function authorized(req) {
  const raw = req.headers.authorization || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';
  const [p, s] = token.split('.');
  if (!p || !s || !safeEqual(sign(p), s)) return false;
  try {
    const v = JSON.parse(Buffer.from(p, 'base64url').toString());
    return Number(v.exp) > Date.now() && v.login === LOGIN;
  } catch { return false; }
}
function validStatus(s) { return ['yangi', 'jarayonda', 'hal_qilindi', 'rad_etildi'].includes(s); }
function validPhone(s) { return /^\+?[0-9][0-9\s()\-]{6,18}$/.test(s); }
function phoneKey(s) { return String(s || '').replace(/\D/g, ''); }
function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }
function validTime(s) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s); }
function finiteCoordinate(v, min, max) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
function apiError(res, status, message) { return res.status(status).json({ error: message }); }
function mapDoctor(r) {
  return { id: r.id, name: r.name, specialty: r.specialty, active: r.active, createdAt: r.created_at?.toISOString?.() || r.created_at };
}
function mapAppointment(r, includePrivate = true) {
  const base = {
    id: r.id,
    reference: r.reference,
    fullName: r.full_name,
    phone: r.phone,
    doctorId: r.doctor_id,
    doctorName: r.doctor_name,
    date: r.appointment_date || '',
    time: r.appointment_time || '',
    topic: r.topic,
    description: r.description,
    status: r.status,
    response: r.response || '',
    needHelp: Boolean(r.need_help),
    latitude: r.latitude == null ? null : Number(r.latitude),
    longitude: r.longitude == null ? null : Number(r.longitude),
    locationAccuracy: r.location_accuracy == null ? null : Number(r.location_accuracy),
    locationSharedAt: r.location_shared_at ? (r.location_shared_at.toISOString?.() || r.location_shared_at) : '',
    audioKey: r.audio_size > 0 ? `db:${r.id}` : '',
    audioType: r.audio_type || '',
    audioSize: Number(r.audio_size || 0),
    audioDurationSec: r.audio_duration_sec == null ? null : Number(r.audio_duration_sec),
    createdAt: r.created_at?.toISOString?.() || r.created_at,
    updatedAt: r.updated_at?.toISOString?.() || r.updated_at
  };
  if (!includePrivate) {
    return {
      reference: base.reference,
      status: base.status,
      response: base.response,
      doctorName: base.doctorName,
      date: base.date,
      time: base.time,
      topic: base.topic,
      hasAudio: Boolean(base.audioKey),
      updatedAt: base.updatedAt
    };
  }
  return base;
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS doctors (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      specialty TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS appointments (
      id UUID PRIMARY KEY,
      reference VARCHAR(40) UNIQUE NOT NULL,
      full_name VARCHAR(120) NOT NULL,
      phone VARCHAR(30) NOT NULL,
      doctor_id UUID NOT NULL REFERENCES doctors(id),
      doctor_name VARCHAR(120) NOT NULL,
      appointment_date VARCHAR(10) NOT NULL DEFAULT '',
      appointment_time VARCHAR(5) NOT NULL DEFAULT '',
      topic VARCHAR(160) NOT NULL DEFAULT 'Umumiy murojaat',
      description TEXT NOT NULL DEFAULT '',
      status VARCHAR(30) NOT NULL DEFAULT 'yangi',
      response TEXT NOT NULL DEFAULT '',
      need_help BOOLEAN NOT NULL DEFAULT FALSE,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      location_accuracy DOUBLE PRECISION,
      location_shared_at TIMESTAMPTZ,
      audio BYTEA,
      audio_type VARCHAR(120) NOT NULL DEFAULT '',
      audio_size INTEGER NOT NULL DEFAULT 0,
      audio_duration_sec INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_appointments_created_at ON appointments(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_appointments_reference ON appointments(reference);
    CREATE INDEX IF NOT EXISTS idx_appointments_doctor_slot ON appointments(doctor_id, appointment_date, appointment_time);
  `);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM doctors');
  if (rows[0].n === 0) {
    const seed = [
      ['Navbatchi terapevt', 'Terapiya'],
      ['Navbatchi kardiolog', 'Kardiologiya'],
      ['Navbatchi pediatr', 'Pediatriya'],
      ['Navbatchi nevrolog', 'Nevrologiya']
    ];
    for (const [name, specialty] of seed) {
      await pool.query('INSERT INTO doctors(id,name,specialty,active) VALUES($1,$2,$3,TRUE)', [randomUUID(), name, specialty]);
    }
  }
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.set('Cache-Control', 'no-store').json({ ok: true, service: 'Buxoro Tibbiyot Tizimi', storage: 'PostgreSQL', time: new Date().toISOString() });
  } catch (e) {
    console.error(e);
    apiError(res, 503, 'Ma’lumotlar bazasi bilan aloqa yo‘q.');
  }
});

app.post('/api/login', async (req, res) => {
  const login = clean(req.body?.login, 80);
  const password = String(req.body?.password || '');
  if (!safeEqual(login, LOGIN) || !safeEqual(password, PASSWORD)) return apiError(res, 401, 'Login yoki parol noto‘g‘ri.');
  res.set('Cache-Control', 'no-store').json({ token: makeToken(login) });
});

app.get('/api/doctors', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM doctors WHERE active=TRUE ORDER BY name ASC');
  res.set('Cache-Control', 'no-store').json({ doctors: rows.map(mapDoctor) });
});

app.get('/api/status', async (req, res) => {
  const reference = clean(req.query.reference, 40).toUpperCase();
  const phone = clean(req.query.phone, 20);
  if (!reference || !phone || phoneKey(phone).length < 7) return apiError(res, 400, 'Nazorat raqami va telefon raqamini kiriting.');
  const { rows } = await pool.query('SELECT * FROM appointments WHERE reference=$1 LIMIT 1', [reference]);
  if (!rows[0] || phoneKey(rows[0].phone) !== phoneKey(phone)) return apiError(res, 404, 'Murojaat topilmadi. Nazorat raqami va telefonni tekshiring.');
  res.set('Cache-Control', 'no-store').json({ appointment: mapAppointment(rows[0], false) });
});

app.post('/api/appointments', upload.single('audio'), async (req, res) => {
  try {
    const b = req.body || {};
    const audio = req.file || null;
    const fullName = clean(b.fullName, 120);
    const phone = clean(b.phone, 20);
    const doctorId = clean(b.doctorId, 80);
    const date = clean(b.date, 10);
    const time = clean(b.time, 5);
    const topic = clean(b.topic, 160) || 'Umumiy murojaat';
    const description = cleanText(b.description, 2000);
    const needHelp = b.needHelp === true || b.needHelp === 'on' || b.needHelp === 'true';
    if (!fullName || !phone || !doctorId) return apiError(res, 400, 'F.I.Sh., telefon va shifokorni kiriting.');
    if (!description && !audio) return apiError(res, 400, 'Murojaat mazmunini yozing yoki ovozli murojaat yuboring.');
    if (!validPhone(phone)) return apiError(res, 400, 'Telefon raqamini to‘g‘ri kiriting.');
    if (Boolean(date) !== Boolean(time)) return apiError(res, 400, 'Qabul sanasi va vaqtini birga tanlang yoki ikkalasini ham bo‘sh qoldiring.');
    if (date && (!validDate(date) || !validTime(time))) return apiError(res, 400, 'Qabul sanasi yoki vaqti noto‘g‘ri.');
    if (audio && !String(audio.mimetype || '').toLowerCase().startsWith('audio/')) return apiError(res, 400, 'Ovoz fayli formati qabul qilinmadi.');
    if (date) {
      const today = new Date().toISOString().slice(0, 10);
      const limit = new Date(); limit.setDate(limit.getDate() + 180);
      if (date < today || date > limit.toISOString().slice(0, 10)) return apiError(res, 400, 'Qabul sanasi ruxsat etilgan oraliqda emas.');
    }
    const doc = await pool.query('SELECT * FROM doctors WHERE id=$1 AND active=TRUE LIMIT 1', [doctorId]);
    if (!doc.rows[0]) return apiError(res, 400, 'Shifokor topilmadi.');
    if (date && time) {
      const busy = await pool.query("SELECT 1 FROM appointments WHERE doctor_id=$1 AND appointment_date=$2 AND appointment_time=$3 AND status <> 'rad_etildi' LIMIT 1", [doctorId, date, time]);
      if (busy.rows[0]) return apiError(res, 409, 'Bu qabul vaqti band. Boshqa vaqtni tanlang yoki sanani bo‘sh qoldirib oddiy murojaat yuboring.');
    }
    const latitude = finiteCoordinate(b.latitude, -90, 90);
    const longitude = finiteCoordinate(b.longitude, -180, 180);
    const accuracy = finiteCoordinate(b.locationAccuracy, 0, 100000);
    const hasLocation = latitude !== null && longitude !== null;
    const duration = finiteCoordinate(b.audioDurationSec, 0, 180);
    const now = new Date();
    const uid = randomUUID();
    const ref = `Q-${now.toISOString().slice(2, 10).replaceAll('-', '')}-${uid.slice(0, 6).toUpperCase()}`;
    await pool.query(`INSERT INTO appointments(
      id,reference,full_name,phone,doctor_id,doctor_name,appointment_date,appointment_time,topic,description,status,response,need_help,
      latitude,longitude,location_accuracy,location_shared_at,audio,audio_type,audio_size,audio_duration_sec,created_at,updated_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'yangi','',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20)`, [
      uid, ref, fullName, phone, doctorId, doc.rows[0].name, date, time, topic, description, needHelp,
      hasLocation ? latitude : null, hasLocation ? longitude : null, hasLocation ? accuracy : null, hasLocation ? now : null,
      audio ? audio.buffer : null, audio?.mimetype || '', audio?.size || 0, audio ? duration : null, now
    ]);
    res.status(201).set('Cache-Control', 'no-store').json({ ok: true, reference: ref, status: 'yangi', hasAudio: Boolean(audio) });
  } catch (e) {
    if (e?.code === 'LIMIT_FILE_SIZE') return apiError(res, 413, 'Ovozli murojaat 3 MB dan oshmasligi kerak.');
    console.error(e);
    apiError(res, 500, 'Server xatosi yuz berdi.');
  }
});

app.get('/api/dashboard', async (req, res) => {
  if (!authorized(req)) return apiError(res, 401, 'Avtorizatsiya talab qilinadi.');
  const [a, d] = await Promise.all([
    pool.query('SELECT id,reference,full_name,phone,doctor_id,doctor_name,appointment_date,appointment_time,topic,description,status,response,need_help,latitude,longitude,location_accuracy,location_shared_at,audio_type,audio_size,audio_duration_sec,created_at,updated_at FROM appointments ORDER BY created_at DESC'),
    pool.query('SELECT * FROM doctors WHERE active=TRUE ORDER BY name ASC')
  ]);
  res.set('Cache-Control', 'no-store').json({ appointments: a.rows.map(r => mapAppointment(r, true)), doctors: d.rows.map(mapDoctor) });
});

app.post('/api/doctors', async (req, res) => {
  if (!authorized(req)) return apiError(res, 401, 'Avtorizatsiya talab qilinadi.');
  const name = clean(req.body?.name, 120);
  const specialty = clean(req.body?.specialty, 120);
  if (!name || !specialty) return apiError(res, 400, 'F.I.Sh. va mutaxassislikni kiriting.');
  const id = randomUUID();
  const { rows } = await pool.query('INSERT INTO doctors(id,name,specialty,active) VALUES($1,$2,$3,TRUE) RETURNING *', [id, name, specialty]);
  res.status(201).set('Cache-Control', 'no-store').json({ doctor: mapDoctor(rows[0]) });
});

app.delete('/api/doctors/:id', async (req, res) => {
  if (!authorized(req)) return apiError(res, 401, 'Avtorizatsiya talab qilinadi.');
  const { rowCount } = await pool.query('UPDATE doctors SET active=FALSE WHERE id=$1', [req.params.id]);
  if (!rowCount) return apiError(res, 404, 'Shifokor topilmadi.');
  res.set('Cache-Control', 'no-store').json({ ok: true });
});

app.patch('/api/appointments/:id', async (req, res) => {
  if (!authorized(req)) return apiError(res, 401, 'Avtorizatsiya talab qilinadi.');
  const st = clean(req.body?.status, 30);
  if (!validStatus(st)) return apiError(res, 400, 'Holat noto‘g‘ri.');
  const response = cleanText(req.body?.response, 3000);
  const { rows } = await pool.query('UPDATE appointments SET status=$1,response=$2,updated_at=NOW() WHERE id=$3 RETURNING *', [st, response, req.params.id]);
  if (!rows[0]) return apiError(res, 404, 'Murojaat topilmadi.');
  res.set('Cache-Control', 'no-store').json({ appointment: mapAppointment(rows[0], true) });
});

app.get('/api/appointments/:id/audio', async (req, res) => {
  if (!authorized(req)) return apiError(res, 401, 'Avtorizatsiya talab qilinadi.');
  const { rows } = await pool.query('SELECT audio,audio_type,audio_size FROM appointments WHERE id=$1 LIMIT 1', [req.params.id]);
  if (!rows[0] || !rows[0].audio) return apiError(res, 404, 'Ovozli murojaat topilmadi.');
  res.set({
    'Content-Type': rows[0].audio_type || 'audio/webm',
    'Content-Length': String(rows[0].audio_size || rows[0].audio.length),
    'Cache-Control': 'private, no-store',
    'Content-Disposition': 'inline'
  });
  res.send(rows[0].audio);
});

const publicDir = path.join(__dirname, 'public');
app.get('/sw.js', (_req, res, next) => { res.set('Cache-Control', 'no-cache, no-store, must-revalidate'); next(); });
app.use(express.static(publicDir, {
  index: 'index.html',
  setHeaders(res, filePath) {
    if (filePath.endsWith('sw.js') || filePath.endsWith('manifest.webmanifest')) res.setHeader('Cache-Control', 'no-cache');
    else if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));
app.get('*path', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return apiError(res, 413, 'Ovozli murojaat 3 MB dan oshmasligi kerak.');
  console.error(err);
  apiError(res, 500, 'Server xatosi yuz berdi.');
});

await initDb();
app.listen(port, '0.0.0.0', () => console.log(`Buxoro Tibbiyot Tizimi ${port}-portda ishga tushdi.`));
