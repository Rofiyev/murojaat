const $=(s)=>document.querySelector(s);
const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let token=sessionStorage.getItem('buxoro-admin-token')||'',appointments=[],doctors=[],institutions=[],analytics={},audioUrl='',refreshTimer=null;
const labels={yangi:'Yangi',jarayonda:'Jarayonda',hal_qilindi:'Hal qilingan',rad_etildi:'Rad etilgan'};
const eventLabels={created:'Murojaat yuborildi',status_changed:'Holat o‘zgartirildi',response_updated:'Javob yangilandi',reassigned:'Shifokor almashtirildi'};

async function api(url,opts={}){
  const h={accept:'application/json',...(opts.headers||{})};if(token)h.authorization='Bearer '+token;
  const r=await fetch(url,{...opts,headers:h});let j={};try{j=await r.json()}catch{}
  if(!r.ok)throw new Error(j.error||'So‘rov bajarilmadi.');return j;
}
function showLogin(){$('#loginView').hidden=false;$('#dashView').hidden=true;stopAutoRefresh()}
function showDash(){$('#loginView').hidden=true;$('#dashView').hidden=false;startAutoRefresh()}
async function loginSubmit(e){
  e.preventDefault();$('#loginError').textContent='';
  try{
    const j=await api('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login:$('#login').value,password:$('#password').value})});
    if(j.role!=='admin')throw new Error('Bu login Boshqarma paneliga tegishli emas.');
    token=j.token;sessionStorage.setItem('buxoro-admin-token',token);showDash();await loadAll();
  }catch(err){$('#loginError').textContent=err.message}
}
async function loadAll(){
  try{
    const j=await api('/api/dashboard');appointments=j.appointments||[];doctors=j.doctors||[];institutions=j.institutions||[];analytics=j.analytics||{};render();
  }catch(e){
    if(/Avtorizatsiya|ruxsat/i.test(e.message)){token='';sessionStorage.removeItem('buxoro-admin-token');showLogin()}
    else console.error(e);
  }
}
function renderStats(){
  $('#sAll').textContent=analytics.total||0;$('#sNew').textContent=analytics.newCount||0;$('#sProgress').textContent=analytics.inProgress||0;$('#sDone').textContent=analytics.done||0;
  $('#sHelp').textContent=analytics.helpCount||0;$('#sOverdue').textContent=analytics.overdue24||0;$('#sAvg').textContent=(analytics.avgResolutionHours||0)+' soat';
}
function renderInstitutionOptions(){
  const f=$('#institutionFilter'),d=$('#doctorInstitution');const fv=f.value,dv=d.value;
  const opts=institutions.map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('');
  f.innerHTML='<option value="">Barcha muassasalar</option>'+opts;d.innerHTML='<option value="">Muassasani tanlang</option>'+opts;
  if(institutions.some(i=>i.id===fv))f.value=fv;if(institutions.some(i=>i.id===dv))d.value=dv;
}
function filtered(){
  const q=$('#search').value.trim().toLowerCase(),f=$('#filter').value,inst=$('#institutionFilter').value;
  return appointments.filter(x=>{
    const hay=`${x.reference} ${x.fullName} ${x.phone} ${x.institutionName} ${x.doctorName} ${x.direction} ${x.topic} ${x.description}`.toLowerCase();
    const fm=!f||x.status===f||(f==='audio'&&x.audioSize>0)||(f==='file'&&x.attachmentSize>0)||(f==='help'&&x.needHelp)||(f==='overdue'&&['yellow','red'].includes(x.slaLevel));
    return fm&&(!inst||x.institutionId===inst)&&(!q||hay.includes(q));
  });
}
function slaBadge(x){if(x.slaLevel==='red')return '<span class="sla red-sla">48+ soat</span>';if(x.slaLevel==='yellow')return '<span class="sla yellow-sla">24+ soat</span>';return ''}
function renderTable(){
  $('#rows').innerHTML=filtered().map(x=>`<tr class="${x.slaLevel==='red'?'overdue-red':x.slaLevel==='yellow'?'overdue-yellow':''}">
    <td><b>${esc(x.reference)}</b><br>${slaBadge(x)}</td>
    <td>${esc(x.fullName)}<br><small>${esc(x.phone)}</small></td>
    <td>${esc(x.institutionName||'—')}</td><td>${esc(x.direction||'—')}</td><td>${esc(x.doctorName||'—')}</td>
    <td><div class="content-preview"><b>${esc(x.topic||'Murojaat')}</b><br>${esc(x.description||(x.audioSize?'Ovozli murojaat':'—'))}</div></td>
    <td><span class="badge ${esc(x.status)}">${esc(labels[x.status]||x.status)}</span>${x.needHelp?'<div class="status-note">⚠ Yordam</div>':''}</td>
    <td>${new Date(x.createdAt).toLocaleString('uz-UZ')}</td><td><button class="link-btn" data-id="${esc(x.id)}">Batafsil</button></td>
  </tr>`).join('')||'<tr><td colspan="9">Murojaatlar topilmadi.</td></tr>';
  $('#rows').querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>openDetail(b.dataset.id));
}
function renderAnalytics(){
  const dirs=(analytics.byDirection||[]).slice(0,7),max=Math.max(1,...dirs.map(x=>x.count));
  $('#directionBars').innerHTML=dirs.map(x=>`<div class="bar-row"><span>${esc(x.name)}</span><div><i style="width:${Math.max(4,x.count/max*100)}%"></i></div><b>${x.count}</b></div>`).join('')||'<p class="muted">Ma’lumot yetarli emas.</p>';
  $('#institutionRanking').innerHTML=(analytics.institutions||[]).map(x=>`<div class="ranking-row"><b>${x.rank}</b><span>${esc(x.name)}</span><small>${x.done}/${x.total} hal qilingan</small><strong>${x.resolutionRate}%</strong><em>${x.avgResolutionHours} soat</em></div>`).join('')||'<p class="muted">Ma’lumot yetarli emas.</p>';
}
function renderInstitutions(){
  $('#institutionAdminList').innerHTML=institutions.map(i=>{
    const count=doctors.filter(d=>d.institutionId===i.id).length;
    return `<div class="institution-row"><span><b>${esc(i.name)}</b><br><small>${count} ta faol shifokor</small></span><span class="institution-actions"><button class="link-btn" data-kiosk="${esc(i.id)}">QR/Kiosk</button><button class="link-btn" data-cred="${esc(i.id)}">Login yaratish</button><button class="link-btn" data-inst="${esc(i.id)}">O‘chirish</button></span></div>`;
  }).join('')||'<p class="muted">Muassasalar yo‘q.</p>';
  $('#institutionAdminList').querySelectorAll('[data-kiosk]').forEach(b=>b.onclick=()=>showKiosk(b.dataset.kiosk));
  $('#institutionAdminList').querySelectorAll('[data-cred]').forEach(b=>b.onclick=()=>credentials('institution',b.dataset.cred));
  $('#institutionAdminList').querySelectorAll('[data-inst]').forEach(b=>b.onclick=async()=>{if(!confirm('Muassasa ro‘yxatdan chiqarilsinmi?'))return;try{await api('/api/institutions/'+b.dataset.inst,{method:'DELETE'});await loadAll()}catch(e){alert(e.message)}});
}
function renderDoctors(){
  $('#doctorAdminList').innerHTML=doctors.map(d=>`<div class="doctor-row"><span><b>${esc(d.name)}</b><br><small>${esc(d.specialty)} · ${esc(d.institutionName)}</small></span><span class="institution-actions"><button class="link-btn" data-doccred="${esc(d.id)}">Login yaratish</button><button class="link-btn" data-doc="${esc(d.id)}">O‘chirish</button></span></div>`).join('')||'<p class="muted">Shifokorlar yo‘q.</p>';
  $('#doctorAdminList').querySelectorAll('[data-doccred]').forEach(b=>b.onclick=()=>credentials('doctor',b.dataset.doccred));
  $('#doctorAdminList').querySelectorAll('[data-doc]').forEach(b=>b.onclick=async()=>{if(!confirm('Shifokorni ro‘yxatdan chiqarilsinmi?'))return;try{await api('/api/doctors/'+b.dataset.doc,{method:'DELETE'});await loadAll()}catch(e){alert(e.message)}});
}
function render(){renderStats();renderInstitutionOptions();renderTable();renderAnalytics();renderInstitutions();renderDoctors()}
async function credentials(role,targetId){
  try{
    const {credentials:c}=await api('/api/credentials',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role,targetId})});
    $('#credentialBody').innerHTML=`<h2>Login-parol tayyor</h2><p><b>${esc(c.targetName)}</b></p><div class="credential-box"><span>Login</span><strong>${esc(c.username)}</strong><span>Vaqtinchalik parol</span><strong>${esc(c.password)}</strong></div><p class="muted">Parol bir marta ko‘rsatiladi. Foydalanuvchiga xavfsiz usulda bering.</p><button id="copyCred" class="btn primary">Nusxalash</button>`;
    $('#credentialModal').classList.add('show');
    $('#copyCred').onclick=async()=>{await navigator.clipboard.writeText(`Login: ${c.username}\nParol: ${c.password}`);$('#copyCred').textContent='Nusxalandi'};
  }catch(e){alert(e.message)}
}
function showKiosk(id){
  const inst=institutions.find(x=>x.id===id);const url=`${location.origin}/kiosk/?institution=${encodeURIComponent(id)}`;
  $('#credentialBody').innerHTML=`<h2>${esc(inst?.name||'Muassasa')} — Kiosk</h2><img class="success-qr" src="/api/qr?kiosk=${encodeURIComponent(id)}" alt="Kiosk QR"><p class="muted">${esc(url)}</p><div class="quick-actions"><button id="copyKiosk" class="btn secondary">Havolani nusxalash</button><a class="btn primary" href="${esc(url)}" target="_blank">Kioskni ochish</a></div>`;
  $('#credentialModal').classList.add('show');$('#copyKiosk').onclick=()=>navigator.clipboard.writeText(url);
}
async function loadEvents(id){
  try{const {events}=await api('/api/appointments/'+id+'/events');$('#timeline').innerHTML=events.map(e=>`<div class="timeline-item"><b>${esc(eventLabels[e.eventType]||e.eventType)}</b>${e.oldStatus&&e.newStatus&&e.oldStatus!==e.newStatus?`<div>${esc(labels[e.oldStatus]||e.oldStatus)} → ${esc(labels[e.newStatus]||e.newStatus)}</div>`:''}${e.note?`<div>${esc(e.note)}</div>`:''}<small>${new Date(e.createdAt).toLocaleString('uz-UZ')}</small></div>`).join('')||'<div class="muted">Tarix mavjud emas.</div>'}catch{$('#timeline').innerHTML='<div class="muted">Tarixni yuklab bo‘lmadi.</div>'}
}
async function loadAudio(id){
  try{const r=await fetch('/api/appointments/'+id+'/audio',{headers:{authorization:'Bearer '+token}});if(!r.ok)throw new Error('Ovozni yuklab bo‘lmadi.');const blob=await r.blob();if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=URL.createObjectURL(blob);const a=$('#audioPlayer');a.src=audioUrl;a.hidden=false;a.play().catch(()=>{})}catch(e){alert(e.message)}
}
async function downloadAttachment(id,name){
  try{const r=await fetch('/api/appointments/'+id+'/attachment',{headers:{authorization:'Bearer '+token}});if(!r.ok)throw new Error('Faylni yuklab bo‘lmadi.');const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name||'biriktirma';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){alert(e.message)}
}
function closeModal(){if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl='';$('#detailModal').classList.remove('show')}
function openDetail(id){
  const x=appointments.find(a=>a.id===id);if(!x)return;
  const options=doctors.filter(d=>d.institutionId===x.institutionId).map(d=>`<option value="${esc(d.id)}">${esc(d.name)} — ${esc(d.specialty)}</option>`).join('');
  $('#detailBody').innerHTML=`<h2>${esc(x.fullName)}</h2><p><b>${esc(x.reference)}</b> · <span class="badge ${esc(x.status)}">${esc(labels[x.status]||x.status)}</span> ${slaBadge(x)}</p>
  <div class="detail-content"><b>Muassasa</b><p>${esc(x.institutionName||'—')}</p><b>Yo‘nalish</b><p>${esc(x.direction||'—')}</p><b>Murojaat turi</b><p>${esc(x.topic||'—')}</p><b>Murojaat mazmuni</b><p>${x.description?esc(x.description).replaceAll('\n','<br>'):'Matn kiritilmagan.'}</p></div>
  ${x.audioSize?'<div class="audio-box"><b>🎙 Ovozli murojaat</b><br><button id="audioBtn" class="btn secondary">Tinglash</button><audio id="audioPlayer" controls hidden></audio></div>':''}
  ${x.attachmentSize?`<div class="audio-box"><b>📎 Biriktirilgan fayl</b><p>${esc(x.attachmentName)} · ${Math.round(x.attachmentSize/1024)} KB</p><button id="fileBtn" class="btn secondary">Faylni yuklash</button></div>`:''}
  ${x.latitude!=null?`<div class="detail-content"><b>📍 Joylashuv</b><p><a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${encodeURIComponent(x.latitude+','+x.longitude)}">Xaritada ochish</a></p></div>`:''}
  <div class="detail-grid"><div class="detail-item"><span>Telefon</span><b><a href="tel:${esc(x.phone)}">${esc(x.phone)}</a></b></div><div class="detail-item"><span>Shifokor</span><b>${esc(x.doctorName||'—')}</b></div><div class="detail-item"><span>Yuborilgan</span><b>${new Date(x.createdAt).toLocaleString('uz-UZ')}</b></div><div class="detail-item"><span>Yoshi</span><b>${x.ageHours} soat</b></div></div>
  <div class="detail-form"><label>Shifokor<select id="detailDoctor">${options}</select></label><label>Holat<select id="detailStatus"><option value="yangi">Yangi</option><option value="jarayonda">Jarayonda</option><option value="hal_qilindi">Hal qilingan</option><option value="rad_etildi">Rad etilgan</option></select></label><label>Bemorga javob<textarea id="detailResponse" rows="5">${esc(x.response||'')}</textarea></label><div class="quick-actions"><button id="takeWork" class="btn secondary">Jarayonga olish</button><button id="markDone" class="btn secondary">Hal qilindi</button><button id="saveDetail" class="btn primary">Saqlash</button></div></div>
  <div class="detail-content"><b>Harakatlar tarixi</b><div id="timeline" class="timeline">Yuklanmoqda…</div></div>`;
  $('#detailStatus').value=x.status;$('#detailDoctor').value=x.doctorId;
  $('#audioBtn')?.addEventListener('click',()=>loadAudio(id));$('#fileBtn')?.addEventListener('click',()=>downloadAttachment(id,x.attachmentName));
  $('#takeWork').onclick=()=>$('#detailStatus').value='jarayonda';$('#markDone').onclick=()=>$('#detailStatus').value='hal_qilindi';
  $('#saveDetail').onclick=async()=>{const b=$('#saveDetail');b.disabled=true;try{await api('/api/appointments/'+id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({status:$('#detailStatus').value,response:$('#detailResponse').value,doctorId:$('#detailDoctor').value})});closeModal();await loadAll()}catch(e){alert(e.message)}finally{b.disabled=false}};
  $('#detailModal').classList.add('show');loadEvents(id);
}
async function downloadReport(kind){
  let url='/api/reports/'+kind;const p=new URLSearchParams();if($('#institutionFilter').value)p.set('institutionId',$('#institutionFilter').value);if(p.toString())url+='?'+p;
  try{const r=await fetch(url,{headers:{authorization:'Bearer '+token}});if(!r.ok)throw new Error('Hisobotni yuklab bo‘lmadi.');const blob=await r.blob(),obj=URL.createObjectURL(blob),a=document.createElement('a');a.href=obj;a.download=kind==='excel'?'murojaatlar-hisobot.xlsx':'murojaatlar-hisobot.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(obj),1000)}catch(e){alert(e.message)}
}
function startAutoRefresh(){stopAutoRefresh();refreshTimer=setInterval(()=>{if($('#autoRefresh')?.checked&&!document.hidden)loadAll()},30000)}
function stopAutoRefresh(){if(refreshTimer)clearInterval(refreshTimer);refreshTimer=null}

$('#loginForm').addEventListener('submit',loginSubmit);$('#logout').onclick=()=>{token='';sessionStorage.removeItem('buxoro-admin-token');showLogin()};$('#refresh').onclick=loadAll;
$('#search').oninput=renderTable;$('#filter').onchange=renderTable;$('#institutionFilter').onchange=renderTable;
$('#excelReport').onclick=()=>downloadReport('excel');$('#pdfReport').onclick=()=>downloadReport('pdf');
$('#closeModal').onclick=closeModal;$('#detailModal').onclick=e=>{if(e.target===$('#detailModal'))closeModal()};
$('#closeCredential').onclick=()=>$('#credentialModal').classList.remove('show');$('#credentialModal').onclick=e=>{if(e.target===$('#credentialModal'))$('#credentialModal').classList.remove('show')};
$('#institutionForm').onsubmit=async e=>{e.preventDefault();try{const j=await api('/api/institutions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:$('#institutionName').value})});e.target.reset();await loadAll();if(j.credentials){$('#credentialBody').innerHTML=`<h2>Muassasa yaratildi</h2><div class="credential-box"><span>Login</span><strong>${esc(j.credentials.username)}</strong><span>Parol</span><strong>${esc(j.credentials.password)}</strong></div>`;$('#credentialModal').classList.add('show')}}catch(e){alert(e.message)}};
$('#doctorForm').onsubmit=async e=>{e.preventDefault();try{const j=await api('/api/doctors',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({institutionId:$('#doctorInstitution').value,name:$('#doctorName').value,specialty:$('#doctorSpecialty').value})});e.target.reset();await loadAll();if(j.credentials){$('#credentialBody').innerHTML=`<h2>Shifokor yaratildi</h2><div class="credential-box"><span>Login</span><strong>${esc(j.credentials.username)}</strong><span>Parol</span><strong>${esc(j.credentials.password)}</strong></div>`;$('#credentialModal').classList.add('show')}}catch(e){alert(e.message)}};
if(token){showDash();loadAll()}else showLogin();
