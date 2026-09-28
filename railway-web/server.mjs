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
  limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 40 }
});

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(self), payment=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  });
  next();
});

const rateBuckets = new Map();
function limited(key, limit, windowMs) {
  const now = Date.now();
  const rec = rateBuckets.get(key);
  if (!rec || rec.until <= now) {
    rateBuckets.set(key, { count: 1, until: now + windowMs });
    return false;
  }
  rec.count += 1;
  return rec.count > limit;
}
function rateLimit(name, limit, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    if (limited(`${name}:${ip}`, limit, windowMs)) return apiError(res, 429, 'Juda ko‘p so‘rov yuborildi. Birozdan keyin qayta urinib ko‘ring.');
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets) if (v.until <= now) rateBuckets.delete(k);
}, 10 * 60 * 1000).unref();

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

function mapInstitution(r) {
  return {
    id: r.id,
    name: r.name,
    active: Boolean(r.active),
    createdAt: r.created_at?.toISOString?.() || r.created_at
  };
}
function mapDoctor(r) {
  return {
    id: r.id,
    name: r.name,
    specialty: r.specialty,
    institutionId: r.institution_id || '',
    institutionName: r.institution_name || '',
    active: Boolean(r.active),
    createdAt: r.created_at?.toISOString?.() || r.created_at
  };
}
function mapAppointment(r, includePrivate = true) {
  const base = {
    id: r.id,
    reference: r.reference,
    fullName: r.full_name,
    phone: r.phone,
    institutionId: r.institution_id || '',
    institutionName: r.institution_name || '',
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
      institutionName: base.institutionName,
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
    CREATE TABLE IF NOT EXISTS institutions (
      id UUID PRIMARY KEY,
      name VARCHAR(180) NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS doctors (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      specialty TEXT NOT NULL,
      institution_id UUID,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id UUID PRIMARY KEY,
      reference VARCHAR(40) UNIQUE NOT NULL,
      full_name VARCHAR(120) NOT NULL,
      phone VARCHAR(30) NOT NULL,
      institution_id UUID,
      institution_name VARCHAR(180) NOT NULL DEFAULT '',
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

    ALTER TABLE doctors ADD COLUMN IF NOT EXISTS institution_id UUID;
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS institution_id UUID;
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS institution_name VARCHAR(180) NOT NULL DEFAULT '';

    CREATE TABLE IF NOT EXISTS appointment_events (
      id BIGSERIAL PRIMARY KEY,
      appointment_id UUID NOT NULL,
      event_type VARCHAR(40) NOT NULL,
      old_status VARCHAR(30) NOT NULL DEFAULT '',
      new_status VARCHAR(30) NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_doctors_institution ON doctors(institution_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_created_at ON appointments(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_appointments_reference ON appointments(reference);
    CREATE INDEX IF NOT EXISTS idx_appointments_institution ON appointments(institution_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_doctor_slot ON appointments(doctor_id, appointment_date, appointment_time);
    CREATE INDEX IF NOT EXISTS idx_appointment_events_appointment ON appointment_events(appointment_id, created_at DESC);
  `);

  let inst = await pool.query('SELECT id,name FROM institutions WHERE active=TRUE ORDER BY created_at ASC LIMIT 1');
  if (!inst.rows[0]) {
    const id = randomUUID();
    await pool.query('INSERT INTO institutions(id,name,active) VALUES($1,$2,TRUE)', [id, 'Buxoro viloyati tibbiyot muassasasi']);
    inst = { rows: [{ id, name: 'Buxoro viloyati tibbiyot muassasasi' }] };
  }
  const defaultInstitution = inst.rows[0];

  await pool.query('UPDATE doctors SET institution_id=$1 WHERE institution_id IS NULL', [defaultInstitution.id]);
  await pool.query(`
    UPDATE appointments a
    SET institution_id=d.institution_id,
        institution_name=COALESCE(i.name, $1)
    FROM doctors d
    LEFT JOIN institutions i ON i.id=d.institution_id
    WHERE a.doctor_id=d.id
      AND (a.institution_id IS NULL OR a.institution_name='')
  `, [defaultInstitution.name]);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM doctors');
  if (rows[0].n === 0) {
    const seed = [
      ['Navbatchi terapevt', 'Terapiya'],
      ['Navbatchi kardiolog', 'Kardiologiya'],
      ['Navbatchi pediatr', 'Pediatriya'],
      ['Navbatchi nevrolog', 'Nevrologiya']
    ];
    for (const [name, specialty] of seed) {
      await pool.query('INSERT INTO doctors(id,name,specialty,institution_id,active) VALUES($1,$2,$3,$4,TRUE)', [randomUUID(), name, specialty, defaultInstitution.id]);
    }
  }
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.set('Cache-Control', 'no-store').json({ ok: true, service: 'Buxoro Tibbiyot Tizimi', version: '3.1.0', storage: 'PostgreSQL', time: new Date().toISOString() });
  } catch (e) {
    console.error(e);
    apiError(res, 503, 'Ma’lumotlar bazasi bilan aloqa yo‘q.');
  }
});

app.post('/api/login', rateLimit('login', 20, 15 * 60 * 1000), async (req, res) => {
  const login = clean(req.body?.login, 80);
  const password = String(req.body?.password || '');
  if (!safeEqual(login, LOGIN) || !safeEqual(password, PASSWORD)) return apiError(res, 401, 'Login yoki parol noto‘g‘ri.');
  res.set('Cache-Control', 'no-store').json({ token: makeToken(login) });
});

app.get('/api/institutions', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM institutions WHERE active=TRUE ORDER BY name ASC');
  res.set('Cache-Control', 'no-store').json({ institutions: rows.map(mapInstitution) });
});

app.get('/api/doctors', async (req, res) => {
  const institutionId = clean(req.query.institutionId, 80);
  const params = [];
  let where = 'd.active=TRUE AND i.active=TRUE';
  if (institutionId) {
    params.push(institutionId);
    where += ` AND d.institution_id=$${params.length}`;
  }
  const { rows } = await pool.query(`
    SELECT d.*, i.name AS institution_name
    FROM doctors d
    JOIN institutions i ON i.id=d.institution_id
    WHERE ${where}
    ORDER BY i.name ASC, d.name ASC
  `, params);
  res.set('Cache-Control', 'no-store').json({ doctors: rows.map(mapDoctor) });
});

app.get('/api/status', rateLimit('status', 180, 60 * 60 * 1000), async (req, res) => {
  const reference = clean(req.query.reference, 40).toUpperCase();
  const phone = clean(req.query.phone, 20);
  if (!reference || !phone || phoneKey(phone).length < 7) return apiError(res, 400, 'Nazorat raqami va telefon raqamini kiriting.');
  const { rows } = await pool.query('SELECT * FROM appointments WHERE reference=$1 LIMIT 1', [reference]);
  if (!rows[0] || phoneKey(rows[0].phone) !== phoneKey(phone)) return apiError(res, 404, 'Murojaat topilmadi. Nazorat raqami va telefonni tekshiring.');
  res.set('Cache-Control', 'no-store').json({ appointment: mapAppointment(rows[0], false) });
});

app.post('/api/appointments', rateLimit('appointment', 180, 60 * 60 * 1000), upload.single('audio'), async (req, res) => {
  try {
    const b = req.body || {};
    const audio = req.file || null;
    const fullName = clean(b.fullName, 120);
    const phone = clean(b.phone, 20);
    const institutionId = clean(b.institutionId, 80);
    const doctorId = clean(b.doctorId, 80);
    const date = clean(b.date, 10);
    const time = clean(b.time, 5);
    const topic = clean(b.topic, 160) || 'Umumiy murojaat';
    const description = cleanText(b.description, 2000);
    const needHelp = b.needHelp === true || b.needHelp === 'on' || b.needHelp === 'true';

    if (!fullName || !phone || !institutionId || !doctorId) return apiError(res, 400, 'F.I.Sh., telefon, muassasa va shifokorni kiriting.');
    if (!description && !audio) return apiError(res, 400, 'Murojaat mazmunini yozing yoki ovozli murojaat yuboring.');
    if (!validPhone(phone)) return apiError(res, 400, 'Telefon raqamini to‘g‘ri kiriting.');
    if (Boolean(date) !== Boolean(time)) return apiError(res, 400, 'Qabul sanasi va vaqtini birga tanlang yoki ikkalasini ham bo‘sh qoldiring.');
    if (date && (!validDate(date) || !validTime(time))) return apiError(res, 400, 'Qabul sanasi yoki vaqti noto‘g‘ri.');
    if (audio && !String(audio.mimetype || '').toLowerCase().startsWith('audio/')) return apiError(res, 400, 'Ovoz fayli formati qabul qilinmadi.');
    if (date) {
      const today = new Date().toISOString().slice(0, 10);
      const limit = new Date();
      limit.setDate(limit.getDate() + 180);
      if (date < today || date > limit.toISOString().slice(0, 10)) return apiError(res, 400, 'Qabul sanasi ruxsat etilgan oraliqda emas.');
    }

    const doc = await pool.query(`
      SELECT d.*, i.name AS institution_name
      FROM doctors d
      JOIN institutions i ON i.id=d.institution_id
      WHERE d.id=$1 AND d.institution_id=$2 AND d.active=TRUE AND i.active=TRUE
      LIMIT 1
    `, [doctorId, institutionId]);
    if (!doc.rows[0]) return apiError(res, 400, 'Tanlangan muassasa yoki shifokor topilmadi.');

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

    await pool.query('BEGIN');
    try {
      await pool.query(`INSERT INTO appointments(
        id,reference,full_name,phone,institution_id,institution_name,doctor_id,doctor_name,appointment_date,appointment_time,topic,description,status,response,need_help,
        latitude,longitude,location_accuracy,location_shared_at,audio,audio_type,audio_size,audio_duration_sec,created_at,updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'yangi','',$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22)`, [
        uid, ref, fullName, phone, institutionId, doc.rows[0].institution_name, doctorId, doc.rows[0].name, date, time, topic, description, needHelp,
        hasLocation ? latitude : null, hasLocation ? longitude : null, hasLocation ? accuracy : null, hasLocation ? now : null,
        audio ? audio.buffer : null, audio?.mimetype || '', audio?.size || 0, audio ? duration : null, now
      ]);
      await pool.query("INSERT INTO appointment_events(appointment_id,event_type,new_status,note) VALUES($1,'created','yangi',$2)", [uid, topic]);
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }

    res.status(201).set('Cache-Control', 'no-store').json({
      ok: true,
      reference: ref,
      status: 'yangi',
      institutionName: doc.rows[0].institution_name,
      doctorName: doc.rows[0].name,
      hasAudio: Boolean(audio)
    });
  } catch (e) {
    if (e?.code === 'LIMIT_FILE_SIZE') return apiError(res, 413, 'Ovozli murojaat 3 MB dan oshmasligi kerak.');
    console.error(e);
    apiError(res, 500, 'Server xatosi yuz berdi.');
  }
});

app.get('/api/dashboard', async (req, res) => {
  if (!authorized(req)) return apiError(res, 401, 'Avtorizatsiya talab qilinadi.');
  const [a, d, i] = await Promise.all([
    pool.query('SELECT id,reference,full_name,phone,institution_id,institution_name,doctor_id,doctor_name,appointment_date,appointment_time,topic,description,status,response,need_help,latitude,longitude,location_accuracy,location_shared_at,audio_type,audio_size,audio_duration_sec,created_at,updated_at FROM appointments ORDER BY created_at DESC LIMIT 5000'),
    pool.query(`SELECT d.*, i.name AS institution_name FROM doctors d JOIN institutions i ON i.id=d.institution_id WHERE d.active=TRUE AND i.active=TRUE ORDER BY i.name ASC,d.name ASC`),
    pool.query('SELECT * FROM institutions WHERE active=TRUE ORDER BY name ASC')
  ]);
  res.set('Cache-Control', 'no-store').json({
    appointments: a.rows.map(r => mapAppointment(r, true)),
    doctors: d.rows.map(mapDoctor),
    institutions: i.rows.map(mapInstitution)
  });
});

app.get('/api/appointments/:id/events', async (req, res) => {
  if (!authorized(req)) return apiError(res, 401, 'Avtorizatsiya talab qilinadi.');
  const { rows } = await pool.query('SELECT event_type,old_status,new_status,note,created_at FROM appointment_events WHERE appointment_id=$1 ORDER BY created_at DESC LIMIT 100', [req.params.id]);
  res.set('Cache-Control', 'no-store').json({
    events: rows.map(r => ({
      eventType: r.event_type,
      oldStatus: r.old_status,
      newStatus: r.new_status,
      note: r.note,
      createdAt: r.created_at?.toISOString?.() || r.created_at
    }))
  });
});

app.post('/api/institutions', async (req, res) => {
  if (!authorized(req)) return apiError(res, 401, 'Avtorizatsiya talab qilinadi.');
  const name = clean(req.body?.name, 180);
  if (name.length < 3) return apiError(res, 400, 'Muassasa nomini to‘liq kiriting.');
  const existing = await pool.query('SELECT * FROM institutions WHERE LOWER(name)=LOWER($1) LIMIT 1', [name]);
  if (existing.rows[0]) {
    if (!existing.rows[0].active) {
      const { rows } = await pool.query('UPDATE institutions SET active=TRUE,name=$1 WHERE id=$2 RETURNING *', [name, existing.rows[0].id]);
      return res.status(201).json({ institution: mapInstitution(rows[0]) });
    }
    return apiError(res, 409, 'Bu muassasa allaqachon mavjud.');
  }
  const id = randomUUID();
  const { rows } = await pool.query('INSERT INTO institutions(id,name,active) VALUES($1,$2,TRUE) RETURNING *', [id, name]);
  res.status(201).set('Cache-Control', 'no-store').json({ institution: mapInstitution(rows[0]) });
});

app.delete('/api/institutions/:id', async (req, res) => {
  if (!authorized(req)) return apiError(res, 401, 'Avtorizatsiya talab qilinadi.');
  const activeDoctors = await pool.query('SELECT COUNT(*)::int AS n FROM doctors WHERE institution_id=$1 AND active=TRUE', [req.params.id]);
  if (activeDoctors.rows[0]?.n > 0) return apiError(res, 409, 'Bu muassasada faol shifokorlar bor. Avval ularni o‘chiring yoki boshqa muassasaga o‘tkazing.');
  const { rowCount } = await pool.query('UPDATE institutions SET active=FALSE WHERE id=$1', [req.params.id]);
  if (!rowCount) return apiError(res, 404, 'Muassasa topilmadi.');
  res.set('Cache-Control', 'no-store').json({ ok: true });
});

app.post('/api/doctors', async (req, res) => {
  if (!authorized(req)) return apiError(res, 401, 'Avtorizatsiya talab qilinadi.');
  const name = clean(req.body?.name, 120);
  const specialty = clean(req.body?.specialty, 120);
  const institutionId = clean(req.body?.institutionId, 80);
  if (!name || !specialty || !institutionId) return apiError(res, 400, 'Muassasa, F.I.Sh. va mutaxassislikni kiriting.');
  const inst = await pool.query('SELECT id,name FROM institutions WHERE id=$1 AND active=TRUE LIMIT 1', [institutionId]);
  if (!inst.rows[0]) return apiError(res, 400, 'Muassasa topilmadi.');
  const id = randomUUID();
  const { rows } = await pool.query(`
    INSERT INTO doctors(id,name,specialty,institution_id,active)
    VALUES($1,$2,$3,$4,TRUE)
    RETURNING *
  `, [id, name, specialty, institutionId]);
  res.status(201).set('Cache-Control', 'no-store').json({ doctor: mapDoctor({ ...rows[0], institution_name: inst.rows[0].name }) });
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
  const current = await pool.query('SELECT status,response FROM appointments WHERE id=$1 LIMIT 1', [req.params.id]);
  if (!current.rows[0]) return apiError(res, 404, 'Murojaat topilmadi.');

  await pool.query('BEGIN');
  try {
    const { rows } = await pool.query('UPDATE appointments SET status=$1,response=$2,updated_at=NOW() WHERE id=$3 RETURNING *', [st, response, req.params.id]);
    const old = current.rows[0];
    const type = old.status !== st ? 'status_changed' : 'response_updated';
    const note = old.response !== response ? response.slice(0, 500) : '';
    await pool.query('INSERT INTO appointment_events(appointment_id,event_type,old_status,new_status,note) VALUES($1,$2,$3,$4,$5)', [req.params.id, type, old.status, st, note]);
    await pool.query('COMMIT');
    res.set('Cache-Control', 'no-store').json({ appointment: mapAppointment(rows[0], true) });
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
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
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) return res.sendFile(path.join(publicDir, 'index.html'));
  next();
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return apiError(res, 413, 'Ovozli murojaat 3 MB dan oshmasligi kerak.');
  console.error(err);
  apiError(res, 500, 'Server xatosi yuz berdi.');
});

await initDb();
app.listen(port, '0.0.0.0', () => console.log(`Buxoro Tibbiyot Tizimi v3.1.0 ${port}-portda ishga tushdi.`));
