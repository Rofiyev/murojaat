import express from 'express';
import multer from 'multer';
import pg from 'pg';
import QRCode from 'qrcode';
import webpush from 'web-push';
import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
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
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

if (!DATABASE_URL) {
  console.error('DATABASE_URL topilmadi. Railway Postgres ulanishi talab qilinadi.');
  process.exit(1);
}
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const pool = new Pool({ connectionString: DATABASE_URL, max: 12, idleTimeoutMillis: 30000 });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 2, fields: 60 }
});
const appointmentUpload = upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'attachment', maxCount: 1 }]);

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(self), payment=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  });
  next();
});

const rateBuckets = new Map();
function apiError(res, status, message) { return res.status(status).json({ error: message }); }
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
function cleanText(v, max = 5000) {
  return String(v ?? '').trim().replace(/[\u0000\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max);
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function phoneKey(s) { return String(s || '').replace(/\D/g, ''); }
function validPhone(s) { return /^\+?[0-9][0-9\s()\-]{6,18}$/.test(s); }
function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }
function validTime(s) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s); }
function validStatus(s) { return ['yangi', 'jarayonda', 'hal_qilindi', 'rad_etildi'].includes(s); }
function finiteCoordinate(v, min, max) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
function slug(s) {
  return String(s || '').toLowerCase()
    .replace(/[‘’ʻʼ']/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 22) || 'user';
}
function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `scrypt$${salt}$${scryptSync(String(password), salt, 64).toString('hex')}`;
}
function verifyPassword(password, encoded) {
  const [kind, salt, hex] = String(encoded || '').split('$');
  if (kind !== 'scrypt' || !salt || !hex) return false;
  const a = Buffer.from(hex, 'hex');
  const b = scryptSync(String(password), salt, a.length);
  return a.length === b.length && timingSafeEqual(a, b);
}
function sign(payload) { return createHmac('sha256', SECRET).update(payload).digest('base64url'); }
function makeToken(user) {
  const payload = {
    login: user.username || user.login,
    role: user.role,
    userId: user.id || '',
    institutionId: user.institutionId || user.institution_id || '',
    doctorId: user.doctorId || user.doctor_id || '',
    exp: Date.now() + 8 * 60 * 60 * 1000
  };
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${p}.${sign(p)}`;
}
function authInfo(req) {
  const raw = req.headers.authorization || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';
  const [p, s] = token.split('.');
  if (!p || !s || !safeEqual(sign(p), s)) return null;
  try {
    const v = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (Number(v.exp) <= Date.now()) return null;
    if (!v.role && v.login === LOGIN) return { ...v, role: 'admin', userId: '', institutionId: '', doctorId: '' };
    return v;
  } catch { return null; }
}
function requireRoles(...roles) {
  return (req, res, next) => {
    const auth = authInfo(req);
    if (!auth) return apiError(res, 401, 'Avtorizatsiya talab qilinadi.');
    if (!roles.includes(auth.role)) return apiError(res, 403, 'Bu bo‘limga ruxsat yo‘q.');
    req.auth = auth;
    next();
  };
}
function allowedAttachment(file) {
  if (!file) return true;
  const allowed = new Set([
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]);
  return allowed.has(String(file.mimetype || '').toLowerCase());
}
function hoursBetween(a, b = new Date()) {
  const aa = new Date(a).getTime(), bb = new Date(b).getTime();
  return Math.max(0, (bb - aa) / 3600000);
}
function slaFor(row) {
  if (['hal_qilindi', 'rad_etildi'].includes(row.status)) return 'closed';
  const h = hoursBetween(row.created_at);
  if (h >= 48) return 'red';
  if (h >= 24) return 'yellow';
  return 'normal';
}
function mapInstitution(r) {
  return { id: r.id, name: r.name, active: Boolean(r.active), createdAt: r.created_at?.toISOString?.() || r.created_at };
}
function mapDoctor(r) {
  return {
    id: r.id, name: r.name, specialty: r.specialty,
    institutionId: r.institution_id || '', institutionName: r.institution_name || '',
    active: Boolean(r.active), createdAt: r.created_at?.toISOString?.() || r.created_at
  };
}
function mapAppointment(r, includePrivate = true) {
  const createdAt = r.created_at?.toISOString?.() || r.created_at;
  const updatedAt = r.updated_at?.toISOString?.() || r.updated_at;
  const base = {
    id: r.id, reference: r.reference, fullName: r.full_name, phone: r.phone,
    institutionId: r.institution_id || '', institutionName: r.institution_name || '',
    doctorId: r.doctor_id || '', doctorName: r.doctor_name || '',
    direction: r.direction || r.specialty || '',
    date: r.appointment_date || '', time: r.appointment_time || '',
    topic: r.topic, description: r.description, status: r.status, response: r.response || '',
    needHelp: Boolean(r.need_help),
    latitude: r.latitude == null ? null : Number(r.latitude),
    longitude: r.longitude == null ? null : Number(r.longitude),
    locationAccuracy: r.location_accuracy == null ? null : Number(r.location_accuracy),
    locationSharedAt: r.location_shared_at ? (r.location_shared_at.toISOString?.() || r.location_shared_at) : '',
    audioType: r.audio_type || '', audioSize: Number(r.audio_size || 0),
    audioDurationSec: r.audio_duration_sec == null ? null : Number(r.audio_duration_sec),
    attachmentName: r.attachment_name || '', attachmentType: r.attachment_type || '',
    attachmentSize: Number(r.attachment_size || 0),
    slaLevel: slaFor(r), ageHours: Math.round(hoursBetween(r.created_at) * 10) / 10,
    firstResponseAt: r.first_response_at ? (r.first_response_at.toISOString?.() || r.first_response_at) : '',
    resolvedAt: r.resolved_at ? (r.resolved_at.toISOString?.() || r.resolved_at) : '',
    createdAt, updatedAt
  };
  if (!includePrivate) {
    return {
      reference: base.reference, status: base.status, response: base.response,
      institutionName: base.institutionName, doctorName: base.doctorName, direction: base.direction,
      date: base.date, time: base.time, topic: base.topic,
      hasAudio: base.audioSize > 0, hasAttachment: base.attachmentSize > 0,
      slaLevel: base.slaLevel, updatedAt: base.updatedAt
    };
  }
  return base;
}
function scopeSql(auth, alias = 'a') {
  if (auth.role === 'admin') return { sql: '', params: [] };
  if (auth.role === 'institution') return { sql: ` AND ${alias}.institution_id=$1`, params: [auth.institutionId] };
  if (auth.role === 'doctor') return { sql: ` AND ${alias}.doctor_id=$1`, params: [auth.doctorId] };
  return { sql: ' AND 1=0', params: [] };
}
function dashboardSelect() {
  return 'id,reference,full_name,phone,institution_id,institution_name,doctor_id,doctor_name,direction,appointment_date,appointment_time,topic,description,status,response,need_help,latitude,longitude,location_accuracy,location_shared_at,audio_type,audio_size,audio_duration_sec,attachment_name,attachment_type,attachment_size,first_response_at,resolved_at,created_at,updated_at';
}
async function findScopedAppointment(id, auth) {
  const scope = scopeSql(auth);
  const params = [id, ...scope.params];
  const shifted = scope.sql.replace(/\$1/g, '$2');
  const { rows } = await pool.query(`SELECT * FROM appointments a WHERE a.id=$1${shifted} LIMIT 1`, params);
  return rows[0] || null;
}
async function uniqueUsername(base) {
  let username = slug(base);
  if (username.length < 4) username = 'user_' + username;
  for (let n = 0; n < 50; n++) {
    const candidate = n ? `${username}_${n + 1}` : username;
    const { rows } = await pool.query('SELECT 1 FROM users WHERE username=$1 LIMIT 1', [candidate]);
    if (!rows[0] && candidate !== LOGIN) return candidate;
  }
  return `${username}_${randomBytes(3).toString('hex')}`;
}
async function issueCredentials(role, targetId, actor) {
  let target;
  if (role === 'institution') {
    if (actor.role !== 'admin') throw Object.assign(new Error('Ruxsat yo‘q.'), { status: 403 });
    const q = await pool.query('SELECT id,name FROM institutions WHERE id=$1 AND active=TRUE LIMIT 1', [targetId]);
    target = q.rows[0];
  } else if (role === 'doctor') {
    const q = await pool.query(`SELECT d.id,d.name,d.institution_id,i.name AS institution_name FROM doctors d JOIN institutions i ON i.id=d.institution_id WHERE d.id=$1 AND d.active=TRUE LIMIT 1`, [targetId]);
    target = q.rows[0];
    if (actor.role === 'institution' && target?.institution_id !== actor.institutionId) throw Object.assign(new Error('Ruxsat yo‘q.'), { status: 403 });
    if (!['admin', 'institution'].includes(actor.role)) throw Object.assign(new Error('Ruxsat yo‘q.'), { status: 403 });
  } else throw Object.assign(new Error('Rol noto‘g‘ri.'), { status: 400 });
  if (!target) throw Object.assign(new Error('Foydalanuvchi uchun obyekt topilmadi.'), { status: 404 });

  const existing = await pool.query('SELECT * FROM users WHERE role=$1 AND ' + (role === 'institution' ? 'institution_id=$2' : 'doctor_id=$2') + ' LIMIT 1', [role, targetId]);
  const password = 'BT-' + randomBytes(6).toString('base64url').slice(0, 8);
  let username = existing.rows[0]?.username;
  if (!username) username = await uniqueUsername((role === 'institution' ? 'muassasa_' : 'shifokor_') + target.name);
  const hash = hashPassword(password);
  if (existing.rows[0]) {
    await pool.query('UPDATE users SET username=$1,password_hash=$2,active=TRUE,must_change_password=TRUE,updated_at=NOW() WHERE id=$3', [username, hash, existing.rows[0].id]);
  } else {
    await pool.query(`INSERT INTO users(id,username,password_hash,role,institution_id,doctor_id,active,must_change_password)
      VALUES($1,$2,$3,$4,$5,$6,TRUE,TRUE)`, [
      randomUUID(), username, hash, role,
      role === 'institution' ? targetId : target.institution_id,
      role === 'doctor' ? targetId : null
    ]);
  }
  return { username, password, role, targetName: target.name };
}
function buildAnalytics(rows) {
  const total = rows.length;
  const doneRows = rows.filter(r => r.status === 'hal_qilindi');
  const overdue24 = rows.filter(r => !['hal_qilindi','rad_etildi'].includes(r.status) && hoursBetween(r.created_at) >= 24).length;
  const overdue48 = rows.filter(r => !['hal_qilindi','rad_etildi'].includes(r.status) && hoursBetween(r.created_at) >= 48).length;
  const resolutionHours = doneRows.map(r => hoursBetween(r.created_at, r.resolved_at || r.updated_at));
  const avgResolutionHours = resolutionHours.length ? resolutionHours.reduce((a,b)=>a+b,0)/resolutionHours.length : 0;
  const byDirectionMap = new Map();
  const byInstitutionMap = new Map();
  for (const r of rows) {
    const direction = r.direction || 'Belgilanmagan';
    byDirectionMap.set(direction, (byDirectionMap.get(direction) || 0) + 1);
    const k = r.institution_id || 'none';
    if (!byInstitutionMap.has(k)) byInstitutionMap.set(k, { id:k, name:r.institution_name || 'Belgilanmagan', total:0, done:0, hours:[] });
    const g = byInstitutionMap.get(k); g.total++;
    if (r.status === 'hal_qilindi') {
      g.done++;
      g.hours.push(hoursBetween(r.created_at, r.resolved_at || r.updated_at));
    }
  }
  const institutions = [...byInstitutionMap.values()].map(g => ({
    id:g.id, name:g.name, total:g.total, done:g.done,
    resolutionRate:g.total ? Math.round(g.done/g.total*1000)/10 : 0,
    avgResolutionHours:g.hours.length ? Math.round(g.hours.reduce((a,b)=>a+b,0)/g.hours.length*10)/10 : 0
  })).sort((a,b)=>b.resolutionRate-a.resolutionRate || a.avgResolutionHours-b.avgResolutionHours || b.total-a.total)
    .map((g,i)=>({ ...g, rank:i+1 }));
  return {
    total,
    newCount: rows.filter(r=>r.status==='yangi').length,
    inProgress: rows.filter(r=>r.status==='jarayonda').length,
    done: doneRows.length,
    rejected: rows.filter(r=>r.status==='rad_etildi').length,
    helpCount: rows.filter(r=>r.need_help).length,
    overdue24, overdue48,
    avgResolutionHours: Math.round(avgResolutionHours*10)/10,
    byDirection: [...byDirectionMap.entries()].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count),
    institutions
  };
}
async function sendPushForAppointment(appointment, title, body) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  const { rows } = await pool.query('SELECT id,endpoint,p256dh,auth FROM push_subscriptions WHERE appointment_id=$1', [appointment.id]);
  const payload = JSON.stringify({
    title,
    body,
    url: `/?ref=${encodeURIComponent(appointment.reference)}#holat`,
    reference: appointment.reference
  });
  for (const sub of rows) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      await pool.query(`INSERT INTO notification_log(appointment_id,channel,status,message) VALUES($1,'push','sent',$2)`, [appointment.id, body]);
    } catch (e) {
      if ([404,410].includes(e.statusCode)) await pool.query('DELETE FROM push_subscriptions WHERE id=$1', [sub.id]);
      await pool.query(`INSERT INTO notification_log(appointment_id,channel,status,message) VALUES($1,'push','failed',$2)`, [appointment.id, cleanText(e.message, 500)]);
    }
  }
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

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username VARCHAR(80) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(24) NOT NULL,
      institution_id UUID,
      doctor_id UUID,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id UUID PRIMARY KEY,
      reference VARCHAR(40) UNIQUE NOT NULL,
      full_name VARCHAR(120) NOT NULL,
      phone VARCHAR(30) NOT NULL,
      institution_id UUID,
      institution_name VARCHAR(180) NOT NULL DEFAULT '',
      doctor_id UUID,
      doctor_name VARCHAR(120) NOT NULL DEFAULT '',
      direction VARCHAR(120) NOT NULL DEFAULT '',
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
      attachment BYTEA,
      attachment_name VARCHAR(240) NOT NULL DEFAULT '',
      attachment_type VARCHAR(160) NOT NULL DEFAULT '',
      attachment_size INTEGER NOT NULL DEFAULT 0,
      first_response_at TIMESTAMPTZ,
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE doctors ADD COLUMN IF NOT EXISTS institution_id UUID;
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS institution_id UUID;
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS institution_name VARCHAR(180) NOT NULL DEFAULT '';
    ALTER TABLE appointments ALTER COLUMN doctor_id DROP NOT NULL;
    ALTER TABLE appointments ALTER COLUMN doctor_name SET DEFAULT '';
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS direction VARCHAR(120) NOT NULL DEFAULT '';
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS attachment BYTEA;
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(240) NOT NULL DEFAULT '';
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS attachment_type VARCHAR(160) NOT NULL DEFAULT '';
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS attachment_size INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS appointment_events (
      id BIGSERIAL PRIMARY KEY,
      appointment_id UUID NOT NULL,
      event_type VARCHAR(40) NOT NULL,
      old_status VARCHAR(30) NOT NULL DEFAULT '',
      new_status VARCHAR(30) NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id BIGSERIAL PRIMARY KEY,
      appointment_id UUID NOT NULL,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notification_log (
      id BIGSERIAL PRIMARY KEY,
      appointment_id UUID NOT NULL,
      channel VARCHAR(30) NOT NULL,
      status VARCHAR(30) NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_users_scope ON users(role,institution_id,doctor_id);
    CREATE INDEX IF NOT EXISTS idx_doctors_institution ON doctors(institution_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_created_at ON appointments(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_appointments_reference ON appointments(reference);
    CREATE INDEX IF NOT EXISTS idx_appointments_institution ON appointments(institution_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON appointments(doctor_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_direction ON appointments(direction);
    CREATE INDEX IF NOT EXISTS idx_appointments_doctor_slot ON appointments(doctor_id, appointment_date, appointment_time);
    CREATE INDEX IF NOT EXISTS idx_appointment_events_appointment ON appointment_events(appointment_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_push_appointment ON push_subscriptions(appointment_id);
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
        institution_name=COALESCE(i.name, $1),
        direction=CASE WHEN a.direction='' THEN d.specialty ELSE a.direction END
    FROM doctors d
    LEFT JOIN institutions i ON i.id=d.institution_id
    WHERE a.doctor_id=d.id
      AND (a.institution_id IS NULL OR a.institution_name='' OR a.direction='')
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
    res.set('Cache-Control', 'no-store').json({ ok:true, service:'Buxoro Tibbiyot Tizimi', version:'4.0.0', storage:'PostgreSQL', push:Boolean(VAPID_PUBLIC_KEY), time:new Date().toISOString() });
  } catch (e) {
    console.error(e); apiError(res, 503, 'Ma’lumotlar bazasi bilan aloqa yo‘q.');
  }
});

app.post('/api/login', rateLimit('login', 25, 15 * 60 * 1000), async (req, res) => {
  const login = clean(req.body?.login, 80);
  const password = String(req.body?.password || '');
  if (safeEqual(login, LOGIN) && safeEqual(password, PASSWORD)) {
    const admin = { login, username:login, role:'admin', id:'', institutionId:'', doctorId:'' };
    return res.set('Cache-Control','no-store').json({ token:makeToken(admin), role:'admin', displayName:'Boshqarma' });
  }
  const { rows } = await pool.query(`SELECT u.*,i.name AS institution_name,d.name AS doctor_name FROM users u
    LEFT JOIN institutions i ON i.id=u.institution_id
    LEFT JOIN doctors d ON d.id=u.doctor_id
    WHERE u.username=$1 AND u.active=TRUE LIMIT 1`, [login]);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) return apiError(res, 401, 'Login yoki parol noto‘g‘ri.');
  const token = makeToken({
    id:user.id, username:user.username, role:user.role,
    institutionId:user.institution_id || '', doctorId:user.doctor_id || ''
  });
  res.set('Cache-Control','no-store').json({
    token, role:user.role, mustChangePassword:Boolean(user.must_change_password),
    displayName:user.role==='doctor' ? user.doctor_name : user.institution_name
  });
});

app.post('/api/account/password', requireRoles('institution','doctor'), async (req,res)=>{
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  if (next.length < 8) return apiError(res,400,'Yangi parol kamida 8 belgidan iborat bo‘lsin.');
  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1 AND active=TRUE LIMIT 1',[req.auth.userId]);
  if (!rows[0] || !verifyPassword(current,rows[0].password_hash)) return apiError(res,401,'Amaldagi parol noto‘g‘ri.');
  await pool.query('UPDATE users SET password_hash=$1,must_change_password=FALSE,updated_at=NOW() WHERE id=$2',[hashPassword(next),req.auth.userId]);
  res.json({ok:true});
});

app.get('/api/institutions', async (_req,res)=>{
  const { rows } = await pool.query('SELECT * FROM institutions WHERE active=TRUE ORDER BY name ASC');
  res.set('Cache-Control','no-store').json({institutions:rows.map(mapInstitution)});
});
app.get('/api/doctors', async (req,res)=>{
  const institutionId = clean(req.query.institutionId,80);
  const params=[]; let where='d.active=TRUE AND i.active=TRUE';
  if (institutionId) { params.push(institutionId); where += ` AND d.institution_id=$${params.length}`; }
  const { rows } = await pool.query(`SELECT d.*,i.name AS institution_name FROM doctors d JOIN institutions i ON i.id=d.institution_id WHERE ${where} ORDER BY i.name,d.name`,params);
  res.set('Cache-Control','no-store').json({doctors:rows.map(mapDoctor)});
});
app.get('/api/directions', async (req,res)=>{
  const institutionId=clean(req.query.institutionId,80);
  if (!institutionId) return res.json({directions:[]});
  const {rows}=await pool.query(`SELECT specialty AS name,COUNT(*)::int AS doctor_count FROM doctors WHERE institution_id=$1 AND active=TRUE GROUP BY specialty ORDER BY specialty`,[institutionId]);
  res.set('Cache-Control','no-store').json({directions:rows.map(r=>({name:r.name,doctorCount:r.doctor_count}))});
});

app.get('/api/status', rateLimit('status',180,60*60*1000), async (req,res)=>{
  const reference=clean(req.query.reference,40).toUpperCase(), phone=clean(req.query.phone,20);
  if (!reference || !phone || phoneKey(phone).length<7) return apiError(res,400,'Nazorat raqami va telefon raqamini kiriting.');
  const {rows}=await pool.query('SELECT * FROM appointments WHERE reference=$1 LIMIT 1',[reference]);
  if (!rows[0] || phoneKey(rows[0].phone)!==phoneKey(phone)) return apiError(res,404,'Murojaat topilmadi. Nazorat raqami va telefonni tekshiring.');
  res.set('Cache-Control','no-store').json({appointment:mapAppointment(rows[0],false)});
});

app.post('/api/appointments', rateLimit('appointment',180,60*60*1000), appointmentUpload, async (req,res)=>{
  try{
    const b=req.body||{}, audio=req.files?.audio?.[0]||null, attachment=req.files?.attachment?.[0]||null;
    const fullName=clean(b.fullName,120), phone=clean(b.phone,20), institutionId=clean(b.institutionId,80);
    const direction=clean(b.direction,120), doctorIdRequested=clean(b.doctorId,80);
    const date=clean(b.date,10), time=clean(b.time,5), topic=clean(b.topic,160)||'Umumiy murojaat';
    const description=cleanText(b.description,2000), needHelp=['on','true',true].includes(b.needHelp);
    if (!fullName||!phone||!institutionId) return apiError(res,400,'F.I.Sh., telefon va muassasani kiriting.');
    if (!direction && !doctorIdRequested) return apiError(res,400,'Murojaat yo‘nalishini tanlang.');
    if (!description && !audio && !attachment) return apiError(res,400,'Murojaat mazmunini yozing, ovoz yuboring yoki fayl biriktiring.');
    if (!validPhone(phone)) return apiError(res,400,'Telefon raqamini to‘g‘ri kiriting.');
    if (Boolean(date)!==Boolean(time)) return apiError(res,400,'Qabul sanasi va vaqtini birga tanlang yoki ikkalasini ham bo‘sh qoldiring.');
    if (date && (!validDate(date)||!validTime(time))) return apiError(res,400,'Qabul sanasi yoki vaqti noto‘g‘ri.');
    if (audio && !String(audio.mimetype||'').toLowerCase().startsWith('audio/')) return apiError(res,400,'Ovoz fayli formati qabul qilinmadi.');
    if (audio && audio.size>3*1024*1024) return apiError(res,413,'Ovozli murojaat 3 MB dan oshmasligi kerak.');
    if (attachment && !allowedAttachment(attachment)) return apiError(res,400,'Biriktirilgan fayl formati ruxsat etilmagan.');
    if (date) {
      const today=new Date().toISOString().slice(0,10), limit=new Date(); limit.setDate(limit.getDate()+180);
      if (date<today||date>limit.toISOString().slice(0,10)) return apiError(res,400,'Qabul sanasi ruxsat etilgan oraliqda emas.');
    }

    let doc;
    if (doctorIdRequested) {
      const q=await pool.query(`SELECT d.*,i.name AS institution_name FROM doctors d JOIN institutions i ON i.id=d.institution_id WHERE d.id=$1 AND d.institution_id=$2 AND d.active=TRUE AND i.active=TRUE LIMIT 1`,[doctorIdRequested,institutionId]);
      doc=q.rows[0];
    } else {
      const q=await pool.query(`
        SELECT d.*,i.name AS institution_name,COUNT(a.id)::int AS open_count
        FROM doctors d
        JOIN institutions i ON i.id=d.institution_id
        LEFT JOIN appointments a ON a.doctor_id=d.id AND a.status IN ('yangi','jarayonda')
        WHERE d.institution_id=$1 AND LOWER(d.specialty)=LOWER($2) AND d.active=TRUE AND i.active=TRUE
        GROUP BY d.id,i.name
        ORDER BY open_count ASC,d.name ASC
        LIMIT 1
      `,[institutionId,direction]);
      doc=q.rows[0];
    }
    if (!doc) return apiError(res,409,'Tanlangan yo‘nalishda faol shifokor topilmadi.');

    if (date&&time) {
      const busy=await pool.query("SELECT 1 FROM appointments WHERE doctor_id=$1 AND appointment_date=$2 AND appointment_time=$3 AND status <> 'rad_etildi' LIMIT 1",[doc.id,date,time]);
      if (busy.rows[0]) return apiError(res,409,'Bu qabul vaqti band. Boshqa vaqtni tanlang yoki sanani bo‘sh qoldiring.');
    }

    const latitude=finiteCoordinate(b.latitude,-90,90), longitude=finiteCoordinate(b.longitude,-180,180);
    const accuracy=finiteCoordinate(b.locationAccuracy,0,100000), hasLocation=latitude!==null&&longitude!==null;
    const duration=finiteCoordinate(b.audioDurationSec,0,180), now=new Date(), uid=randomUUID();
    const ref=`Q-${now.toISOString().slice(2,10).replaceAll('-','')}-${uid.slice(0,6).toUpperCase()}`;
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query(`INSERT INTO appointments(
        id,reference,full_name,phone,institution_id,institution_name,doctor_id,doctor_name,direction,appointment_date,appointment_time,topic,description,status,response,need_help,
        latitude,longitude,location_accuracy,location_shared_at,audio,audio_type,audio_size,audio_duration_sec,attachment,attachment_name,attachment_type,attachment_size,created_at,updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'yangi','',$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$27)`,[
        uid,ref,fullName,phone,institutionId,doc.institution_name,doc.id,doc.name,direction||doc.specialty,date,time,topic,description,needHelp,
        hasLocation?latitude:null,hasLocation?longitude:null,hasLocation?accuracy:null,hasLocation?now:null,
        audio?audio.buffer:null,audio?.mimetype||'',audio?.size||0,audio?duration:null,
        attachment?attachment.buffer:null,attachment?clean(attachment.originalname,240):'',attachment?.mimetype||'',attachment?.size||0,now
      ]);
      await client.query("INSERT INTO appointment_events(appointment_id,event_type,new_status,note) VALUES($1,'created','yangi',$2)",[uid,`${topic} · ${direction||doc.specialty}`]);
      await client.query("INSERT INTO notification_log(appointment_id,channel,status,message) VALUES($1,'inapp','sent',$2)",[uid,'Murojaat qabul qilindi.']);
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
    res.status(201).set('Cache-Control','no-store').json({
      ok:true,reference:ref,status:'yangi',institutionName:doc.institution_name,doctorName:doc.name,direction:direction||doc.specialty,
      hasAudio:Boolean(audio),hasAttachment:Boolean(attachment)
    });
  }catch(e){
    if (e?.code==='LIMIT_FILE_SIZE') return apiError(res,413,'Fayl hajmi 10 MB dan oshmasligi kerak.');
    console.error(e); apiError(res,500,'Server xatosi yuz berdi.');
  }
});

app.get('/api/push/config', (_req,res)=>res.json({enabled:Boolean(VAPID_PUBLIC_KEY&&VAPID_PRIVATE_KEY),publicKey:VAPID_PUBLIC_KEY}));
app.post('/api/push/subscribe', rateLimit('push-subscribe',60,60*60*1000), async (req,res)=>{
  if (!VAPID_PUBLIC_KEY||!VAPID_PRIVATE_KEY) return apiError(res,503,'Push bildirishnomalar hali yoqilmagan.');
  const reference=clean(req.body?.reference,40).toUpperCase(), phone=clean(req.body?.phone,20), sub=req.body?.subscription;
  if (!reference||!phone||!sub?.endpoint||!sub?.keys?.p256dh||!sub?.keys?.auth) return apiError(res,400,'Push ma’lumotlari to‘liq emas.');
  const {rows}=await pool.query('SELECT id,phone FROM appointments WHERE reference=$1 LIMIT 1',[reference]);
  if (!rows[0]||phoneKey(rows[0].phone)!==phoneKey(phone)) return apiError(res,404,'Murojaat topilmadi.');
  await pool.query(`INSERT INTO push_subscriptions(appointment_id,endpoint,p256dh,auth) VALUES($1,$2,$3,$4)
    ON CONFLICT(endpoint) DO UPDATE SET appointment_id=EXCLUDED.appointment_id,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth`,
    [rows[0].id,cleanText(sub.endpoint,2000),cleanText(sub.keys.p256dh,500),cleanText(sub.keys.auth,500)]);
  res.json({ok:true});
});

app.get('/api/qr', rateLimit('qr',240,60*60*1000), async (req,res)=>{
  const reference=clean(req.query.reference,40).toUpperCase(), kiosk=clean(req.query.kiosk,80);
  let target='';
  const origin=`${req.protocol}://${req.get('host')}`;
  if (reference) target=`${origin}/?ref=${encodeURIComponent(reference)}#holat`;
  else if (kiosk) {
    const {rows}=await pool.query('SELECT 1 FROM institutions WHERE id=$1 AND active=TRUE LIMIT 1',[kiosk]);
    if (!rows[0]) return apiError(res,404,'Muassasa topilmadi.');
    target=`${origin}/kiosk/?institution=${encodeURIComponent(kiosk)}`;
  } else return apiError(res,400,'QR uchun ma’lumot yetarli emas.');
  const png=await QRCode.toBuffer(target,{type:'png',width:320,margin:1,errorCorrectionLevel:'M'});
  res.set({'Content-Type':'image/png','Cache-Control':'public, max-age=3600'}).send(png);
});

app.get('/api/dashboard', requireRoles('admin'), async (req,res)=>{
  const [a,d,i]=await Promise.all([
    pool.query(`SELECT ${dashboardSelect()} FROM appointments ORDER BY created_at DESC LIMIT 5000`),
    pool.query(`SELECT d.*,i.name AS institution_name FROM doctors d JOIN institutions i ON i.id=d.institution_id WHERE d.active=TRUE AND i.active=TRUE ORDER BY i.name,d.name`),
    pool.query('SELECT * FROM institutions WHERE active=TRUE ORDER BY name')
  ]);
  res.set('Cache-Control','no-store').json({
    appointments:a.rows.map(r=>mapAppointment(r,true)),doctors:d.rows.map(mapDoctor),institutions:i.rows.map(mapInstitution),analytics:buildAnalytics(a.rows)
  });
});

app.get('/api/portal/dashboard', requireRoles('institution','doctor'), async (req,res)=>{
  const scope=scopeSql(req.auth);
  const {rows}=await pool.query(`SELECT ${dashboardSelect()} FROM appointments a WHERE 1=1${scope.sql} ORDER BY created_at DESC LIMIT 5000`,scope.params);
  let doctors=[];
  if (req.auth.role==='institution') {
    const q=await pool.query(`SELECT d.*,i.name AS institution_name FROM doctors d JOIN institutions i ON i.id=d.institution_id WHERE d.active=TRUE AND d.institution_id=$1 ORDER BY d.name`,[req.auth.institutionId]);
    doctors=q.rows.map(mapDoctor);
  }
  res.set('Cache-Control','no-store').json({role:req.auth.role,appointments:rows.map(r=>mapAppointment(r,true)),doctors,analytics:buildAnalytics(rows)});
});

app.get('/api/appointments/:id/events', requireRoles('admin','institution','doctor'), async (req,res)=>{
  const ap=await findScopedAppointment(req.params.id,req.auth);
  if (!ap) return apiError(res,404,'Murojaat topilmadi.');
  const {rows}=await pool.query('SELECT event_type,old_status,new_status,note,created_at FROM appointment_events WHERE appointment_id=$1 ORDER BY created_at DESC LIMIT 100',[req.params.id]);
  res.json({events:rows.map(r=>({eventType:r.event_type,oldStatus:r.old_status,newStatus:r.new_status,note:r.note,createdAt:r.created_at?.toISOString?.()||r.created_at}))});
});
app.get('/api/appointments/:id/audio', requireRoles('admin','institution','doctor'), async (req,res)=>{
  const ap=await findScopedAppointment(req.params.id,req.auth);
  if (!ap||!ap.audio) return apiError(res,404,'Ovozli murojaat topilmadi.');
  res.set({'Content-Type':ap.audio_type||'audio/webm','Content-Length':String(ap.audio_size||ap.audio.length),'Cache-Control':'private,no-store','Content-Disposition':'inline'}).send(ap.audio);
});
app.get('/api/appointments/:id/attachment', requireRoles('admin','institution','doctor'), async (req,res)=>{
  const ap=await findScopedAppointment(req.params.id,req.auth);
  if (!ap||!ap.attachment) return apiError(res,404,'Biriktirilgan fayl topilmadi.');
  const safeName=(ap.attachment_name||'fayl').replace(/[\r\n"]/g,'_');
  res.set({'Content-Type':ap.attachment_type||'application/octet-stream','Content-Length':String(ap.attachment_size||ap.attachment.length),'Cache-Control':'private,no-store','Content-Disposition':`attachment; filename="${safeName}"`}).send(ap.attachment);
});

async function patchAppointment(req,res){
  const current=await findScopedAppointment(req.params.id,req.auth);
  if (!current) return apiError(res,404,'Murojaat topilmadi.');
  const st=clean(req.body?.status,30); if (!validStatus(st)) return apiError(res,400,'Holat noto‘g‘ri.');
  const response=cleanText(req.body?.response,3000);
  let doctorId=current.doctor_id, doctorName=current.doctor_name, direction=current.direction;
  const requestedDoctor=clean(req.body?.doctorId,80);
  if (requestedDoctor && ['admin','institution'].includes(req.auth.role)) {
    const params=req.auth.role==='institution'?[requestedDoctor,req.auth.institutionId]:[requestedDoctor,current.institution_id];
    const q=await pool.query('SELECT id,name,specialty FROM doctors WHERE id=$1 AND institution_id=$2 AND active=TRUE LIMIT 1',params);
    if (!q.rows[0]) return apiError(res,400,'Shifokor topilmadi.');
    doctorId=q.rows[0].id;doctorName=q.rows[0].name;direction=q.rows[0].specialty;
  }
  const now=new Date(), firstResponse=current.first_response_at || ((st!=='yangi'||response)?now:null);
  const resolved=st==='hal_qilindi'?(current.resolved_at||now):current.resolved_at;
  const client=await pool.connect();
  let updated;
  try{
    await client.query('BEGIN');
    const q=await client.query(`UPDATE appointments SET status=$1,response=$2,doctor_id=$3,doctor_name=$4,direction=$5,
      first_response_at=$6,resolved_at=$7,updated_at=NOW() WHERE id=$8 RETURNING *`,
      [st,response,doctorId,doctorName,direction,firstResponse,resolved,req.params.id]);
    updated=q.rows[0];
    const type=current.status!==st?'status_changed':(current.doctor_id!==doctorId?'reassigned':'response_updated');
    const note=current.doctor_id!==doctorId?`Shifokor: ${doctorName}`:(current.response!==response?response.slice(0,500):'');
    await client.query('INSERT INTO appointment_events(appointment_id,event_type,old_status,new_status,note) VALUES($1,$2,$3,$4,$5)',[req.params.id,type,current.status,st,note]);
    const msg=st==='jarayonda'?'Murojaatingiz ko‘rib chiqilmoqda.':st==='hal_qilindi'?'Murojaatingiz hal qilindi.':st==='rad_etildi'?'Murojaat bo‘yicha yakuniy holat yangilandi.':'Murojaat holati yangilandi.';
    await client.query("INSERT INTO notification_log(appointment_id,channel,status,message) VALUES($1,'inapp','sent',$2)",[req.params.id,msg]);
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  if (current.status!==st) {
    const title=st==='hal_qilindi'?'Murojaat hal qilindi':'Murojaat holati yangilandi';
    const body=st==='jarayonda'?`${updated.reference}: ko‘rib chiqilmoqda.`:st==='hal_qilindi'?`${updated.reference}: hal qilindi. Natijani sayt orqali ko‘ring.`:`${updated.reference}: holat yangilandi.`;
    sendPushForAppointment(updated,title,body).catch(console.error);
  }
  res.json({appointment:mapAppointment(updated,true)});
}
app.patch('/api/appointments/:id', requireRoles('admin','institution','doctor'), patchAppointment);

app.post('/api/credentials', requireRoles('admin','institution'), async (req,res)=>{
  try{
    const role=clean(req.body?.role,30), targetId=clean(req.body?.targetId,80);
    const credentials=await issueCredentials(role,targetId,req.auth);
    res.json({credentials});
  }catch(e){apiError(res,e.status||500,e.message||'Login yaratib bo‘lmadi.')}
});

app.post('/api/institutions', requireRoles('admin'), async (req,res)=>{
  const name=clean(req.body?.name,180); if (name.length<3) return apiError(res,400,'Muassasa nomini to‘liq kiriting.');
  const existing=await pool.query('SELECT * FROM institutions WHERE LOWER(name)=LOWER($1) LIMIT 1',[name]);
  let institution;
  if (existing.rows[0]) {
    if (existing.rows[0].active) return apiError(res,409,'Bu muassasa allaqachon mavjud.');
    const q=await pool.query('UPDATE institutions SET active=TRUE,name=$1 WHERE id=$2 RETURNING *',[name,existing.rows[0].id]); institution=q.rows[0];
  } else {
    const q=await pool.query('INSERT INTO institutions(id,name,active) VALUES($1,$2,TRUE) RETURNING *',[randomUUID(),name]); institution=q.rows[0];
  }
  const credentials=await issueCredentials('institution',institution.id,req.auth);
  res.status(201).json({institution:mapInstitution(institution),credentials});
});
app.delete('/api/institutions/:id', requireRoles('admin'), async (req,res)=>{
  const activeDoctors=await pool.query('SELECT COUNT(*)::int AS n FROM doctors WHERE institution_id=$1 AND active=TRUE',[req.params.id]);
  if (activeDoctors.rows[0]?.n>0) return apiError(res,409,'Bu muassasada faol shifokorlar bor. Avval ularni o‘chiring yoki boshqa muassasaga o‘tkazing.');
  const {rowCount}=await pool.query('UPDATE institutions SET active=FALSE WHERE id=$1',[req.params.id]);
  await pool.query('UPDATE users SET active=FALSE,updated_at=NOW() WHERE role=\'institution\' AND institution_id=$1',[req.params.id]);
  if (!rowCount) return apiError(res,404,'Muassasa topilmadi.');
  res.json({ok:true});
});
app.post('/api/doctors', requireRoles('admin'), async (req,res)=>{
  const name=clean(req.body?.name,120), specialty=clean(req.body?.specialty,120), institutionId=clean(req.body?.institutionId,80);
  if (!name||!specialty||!institutionId) return apiError(res,400,'Muassasa, F.I.Sh. va mutaxassislikni kiriting.');
  const inst=await pool.query('SELECT id,name FROM institutions WHERE id=$1 AND active=TRUE LIMIT 1',[institutionId]);
  if (!inst.rows[0]) return apiError(res,400,'Muassasa topilmadi.');
  const id=randomUUID();
  const q=await pool.query('INSERT INTO doctors(id,name,specialty,institution_id,active) VALUES($1,$2,$3,$4,TRUE) RETURNING *',[id,name,specialty,institutionId]);
  const doctor=mapDoctor({...q.rows[0],institution_name:inst.rows[0].name});
  const credentials=await issueCredentials('doctor',id,req.auth);
  res.status(201).json({doctor,credentials});
});
app.delete('/api/doctors/:id', requireRoles('admin'), async (req,res)=>{
  const {rowCount}=await pool.query('UPDATE doctors SET active=FALSE WHERE id=$1',[req.params.id]);
  await pool.query('UPDATE users SET active=FALSE,updated_at=NOW() WHERE role=\'doctor\' AND doctor_id=$1',[req.params.id]);
  if (!rowCount) return apiError(res,404,'Shifokor topilmadi.');
  res.json({ok:true});
});

function reportScope(auth, query) {
  const clauses=[]; const params=[];
  if (auth.role==='institution') { params.push(auth.institutionId); clauses.push(`institution_id=$${params.length}`); }
  if (auth.role==='doctor') { params.push(auth.doctorId); clauses.push(`doctor_id=$${params.length}`); }
  if (auth.role==='admin' && query.institutionId) { params.push(clean(query.institutionId,80)); clauses.push(`institution_id=$${params.length}`); }
  const from=clean(query.from,10), to=clean(query.to,10);
  if (from&&validDate(from)) { params.push(from); clauses.push(`created_at >= $${params.length}::date`); }
  if (to&&validDate(to)) { params.push(to); clauses.push(`created_at < ($${params.length}::date + interval '1 day')`); }
  return { where:clauses.length?'WHERE '+clauses.join(' AND '):'', params };
}
async function reportRows(auth, query) {
  const s=reportScope(auth,query);
  const {rows}=await pool.query(`SELECT ${dashboardSelect()} FROM appointments ${s.where} ORDER BY created_at DESC`,s.params);
  return rows;
}
app.get('/api/reports/excel', requireRoles('admin','institution'), async (req,res)=>{
  const rows=await reportRows(req.auth,req.query), analytics=buildAnalytics(rows);
  const data=rows.map(r=>({
    'Nazorat raqami':r.reference,'F.I.Sh.':r.full_name,'Telefon':r.phone,'Muassasa':r.institution_name,'Shifokor':r.doctor_name,
    'Yo‘nalish':r.direction,'Murojaat turi':r.topic,'Holat':r.status,'Yordam':r.need_help?'Ha':'Yo‘q',
    'Yuborilgan':new Date(r.created_at).toLocaleString('uz-UZ'),'Hal qilingan':r.resolved_at?new Date(r.resolved_at).toLocaleString('uz-UZ'):'',
    'Hal qilish vaqti (soat)':r.resolved_at?Math.round(hoursBetween(r.created_at,r.resolved_at)*10)/10:''
  }));
  const summary=[
    ['Ko‘rsatkich','Qiymat'],['Jami murojaat',analytics.total],['Yangi',analytics.newCount],['Jarayonda',analytics.inProgress],
    ['Hal qilingan',analytics.done],['24 soatdan oshgan',analytics.overdue24],['48 soatdan oshgan',analytics.overdue48],
    ['O‘rtacha hal qilish vaqti (soat)',analytics.avgResolutionHours]
  ];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data),'Murojaatlar');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(summary),'Xulosa');
  const buf=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
  res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="murojaatlar-hisobot.xlsx"'}).send(buf);
});
app.get('/api/reports/pdf', requireRoles('admin','institution'), async (req,res)=>{
  const rows=await reportRows(req.auth,req.query), a=buildAnalytics(rows);
  res.set({'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="murojaatlar-hisobot.pdf"'});
  const doc=new PDFDocument({margin:42,size:'A4'});doc.pipe(res);
  doc.fontSize(18).text('Buxoro Tibbiyot Tizimi — Murojaatlar hisoboti');
  doc.moveDown(.5).fontSize(10).text(`Tayyorlangan: ${new Date().toLocaleString('uz-UZ')}`);
  doc.moveDown().fontSize(12).text(`Jami: ${a.total}   Yangi: ${a.newCount}   Jarayonda: ${a.inProgress}   Hal qilingan: ${a.done}`);
  doc.text(`24 soatdan oshgan: ${a.overdue24}   48 soatdan oshgan: ${a.overdue48}   O‘rtacha hal qilish: ${a.avgResolutionHours} soat`);
  doc.moveDown();
  rows.slice(0,250).forEach((r,idx)=>{
    if (doc.y>740) doc.addPage();
    doc.fontSize(9).text(`${idx+1}. ${r.reference} | ${r.institution_name} | ${r.doctor_name} | ${r.direction} | ${r.status}`);
  });
  if (rows.length>250) doc.moveDown().fontSize(9).text(`Yana ${rows.length-250} ta murojaat Excel hisobotida mavjud.`);
  doc.end();
});

const publicDir=path.join(__dirname,'public');
app.get('/sw.js',(_req,res,next)=>{res.set('Cache-Control','no-cache,no-store,must-revalidate');next()});
app.use(express.static(publicDir,{
  index:'index.html',
  setHeaders(res,filePath){
    if (filePath.endsWith('sw.js')||filePath.endsWith('manifest.webmanifest')) res.setHeader('Cache-Control','no-cache');
    else if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control','public,max-age=3600');
  }
}));
app.use((req,res,next)=>{
  if (req.method==='GET'&&!req.path.startsWith('/api/')) return res.sendFile(path.join(publicDir,'index.html'));
  next();
});
app.use((err,_req,res,_next)=>{
  if (err instanceof multer.MulterError && err.code==='LIMIT_FILE_SIZE') return apiError(res,413,'Fayl hajmi 10 MB dan oshmasligi kerak.');
  console.error(err);apiError(res,500,'Server xatosi yuz berdi.');
});

await initDb();
app.listen(port,'0.0.0.0',()=>console.log(`Buxoro Tibbiyot Tizimi v4.0.0 ${port}-portda ishga tushdi.`));
