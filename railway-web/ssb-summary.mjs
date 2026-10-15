import { timingSafeEqual } from 'node:crypto';
export function validSummaryToken(header, secret) {
  if (!secret || secret.length < 32) return false;
  const got=Buffer.from(String(header||'')), expected=Buffer.from('Bearer '+secret);
  return got.length===expected.length && timingSafeEqual(got,expected);
}
export function monthBounds(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('INVALID_MONTH');
  const [y,m]=month.split('-').map(Number);
  return [month+'-01',`${m===12?y+1:y}-${String(m===12?1:m+1).padStart(2,'0')}-01`];
}
export function mountSsbSummary(app,pool) {
  app.get('/api/integrations/ssb/summary',async(req,res)=>{
    res.set('Cache-Control','private, no-store');
    if (!validSummaryToken(req.headers.authorization,process.env.SSB_SUMMARY_TOKEN)) return res.status(401).json({error:'Unauthorized'});
    let bounds;try {bounds=monthBounds(String(req.query.month||''))} catch {return res.status(400).json({error:'Invalid month'})}
    try {
      const {rows}=await pool.query(`SELECT COALESCE(a.institution_id,'unassigned') AS id,
        COALESCE(i.name,MAX(a.institution_name),'Biriktirilmagan') AS name,
        COUNT(*)::int AS total,
        COUNT(*) FILTER(WHERE a.status='yangi')::int AS new_count,
        COUNT(*) FILTER(WHERE a.status='jarayonda')::int AS in_progress,
        COUNT(*) FILTER(WHERE a.status='hal_qilindi')::int AS resolved,
        COUNT(*) FILTER(WHERE a.status='rad_etildi')::int AS rejected,
        COUNT(*) FILTER(WHERE a.status NOT IN ('hal_qilindi','rad_etildi') AND a.created_at < NOW()-INTERVAL '48 hours')::int AS overdue48
        FROM appointments a LEFT JOIN institutions i ON i.id=a.institution_id
        WHERE a.created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Tashkent')
          AND a.created_at < ($2::date::timestamp AT TIME ZONE 'Asia/Tashkent')
        GROUP BY a.institution_id,i.name ORDER BY total DESC`,bounds);
      res.json({ok:true,source:'murojaat',month:req.query.month,generatedAt:new Date().toISOString(),rows,
        totals:rows.reduce((out,r)=>{for(const k of Object.keys(out))out[k]+=r[k];return out},{total:0,new_count:0,in_progress:0,resolved:0,rejected:0,overdue48:0})});
    }catch {res.status(503).json({error:'Summary unavailable'})}
  });
}
