const $=(s)=>document.querySelector(s);
const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let token=sessionStorage.getItem('buxoro-admin-token')||'',appointments=[],doctors=[],institutions=[],audioUrl='',refreshTimer=null;
const labels={yangi:'Yangi',jarayonda:'Jarayonda',hal_qilindi:'Hal qilingan',rad_etildi:'Rad etilgan'};
const eventLabels={created:'Murojaat yuborildi',status_changed:'Holat o‘zgartirildi',response_updated:'Javob yangilandi'};

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
    token=j.token;sessionStorage.setItem('buxoro-admin-token',token);showDash();await loadAll();
  }catch(err){$('#loginError').textContent=err.message}
}
async function loadAll(){
  try{
    const j=await api('/api/dashboard');
    appointments=j.appointments||[];doctors=j.doctors||[];institutions=j.institutions||[];
    render();
  }catch(e){
    if(/Avtorizatsiya/.test(e.message)){token='';sessionStorage.removeItem('buxoro-admin-token');showLogin()}
    else console.error(e);
  }
}
function renderStats(){
  $('#sAll').textContent=appointments.length;
  $('#sNew').textContent=appointments.filter(x=>x.status==='yangi').length;
  $('#sProgress').textContent=appointments.filter(x=>x.status==='jarayonda').length;
  $('#sDone').textContent=appointments.filter(x=>x.status==='hal_qilindi').length;
  $('#sHelp').textContent=appointments.filter(x=>x.needHelp).length;
}
function renderInstitutionOptions(){
  const filter=$('#institutionFilter'),docSel=$('#doctorInstitution');
  const oldFilter=filter.value,oldDoc=docSel.value;
  const opts=institutions.map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('');
  filter.innerHTML='<option value="">Barcha muassasalar</option>'+opts;
  docSel.innerHTML='<option value="">Muassasani tanlang</option>'+opts;
  if(institutions.some(i=>i.id===oldFilter))filter.value=oldFilter;
  if(institutions.some(i=>i.id===oldDoc))docSel.value=oldDoc;
}
function filtered(){
  const q=$('#search').value.trim().toLowerCase(),f=$('#filter').value,inst=$('#institutionFilter').value;
  return appointments.filter(x=>{
    const hay=`${x.reference} ${x.fullName} ${x.phone} ${x.institutionName} ${x.doctorName} ${x.topic} ${x.description}`.toLowerCase();
    const fm=!f||x.status===f||(f==='audio'&&x.audioSize>0)||(f==='help'&&x.needHelp);
    return fm&&(!inst||x.institutionId===inst)&&(!q||hay.includes(q));
  });
}
function renderTable(){
  const list=filtered();
  $('#rows').innerHTML=list.map(x=>`<tr class="${x.needHelp?'help-row':''}">
    <td><b>${esc(x.reference)}</b>${x.audioSize?'<br><small>🎙 Ovozli</small>':''}</td>
    <td>${esc(x.fullName)}<br><small>${esc(x.phone)}</small></td>
    <td>${esc(x.institutionName||'—')}</td>
    <td>${esc(x.doctorName)}</td>
    <td><div class="content-preview"><b>${esc(x.topic||'Murojaat')}</b><br>${esc(x.description||(x.audioSize?'Ovozli murojaat':'—'))}</div></td>
    <td><span class="badge ${esc(x.status)}">${esc(labels[x.status]||x.status)}</span>${x.needHelp?'<div class="status-note">⚠ Qo‘shimcha yordam</div>':''}</td>
    <td>${new Date(x.createdAt).toLocaleString('uz-UZ')}</td>
    <td><button class="link-btn" data-id="${esc(x.id)}">Batafsil</button></td>
  </tr>`).join('')||'<tr><td colspan="8">Murojaatlar topilmadi.</td></tr>';
  $('#rows').querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>openDetail(b.dataset.id));
}
function renderInstitutions(){
  $('#institutionAdminList').innerHTML=institutions.map(i=>{
    const count=doctors.filter(d=>d.institutionId===i.id).length;
    return `<div class="institution-row"><span><b>${esc(i.name)}</b><br><small>${count} ta faol shifokor</small></span><button class="link-btn" data-inst="${esc(i.id)}">O‘chirish</button></div>`;
  }).join('')||'<p class="muted">Muassasalar yo‘q.</p>';
  $('#institutionAdminList').querySelectorAll('[data-inst]').forEach(b=>b.onclick=async()=>{
    if(!confirm('Muassasa ro‘yxatdan chiqarilsinmi?'))return;
    try{await api('/api/institutions/'+b.dataset.inst,{method:'DELETE'});await loadAll()}catch(e){alert(e.message)}
  });
}
function renderDoctors(){
  $('#doctorAdminList').innerHTML=doctors.map(d=>`<div class="doctor-row"><span><b>${esc(d.name)}</b><br><small>${esc(d.specialty)} · ${esc(d.institutionName)}</small></span><button class="link-btn" data-doc="${esc(d.id)}">O‘chirish</button></div>`).join('')||'<p class="muted">Shifokorlar yo‘q.</p>';
  $('#doctorAdminList').querySelectorAll('[data-doc]').forEach(b=>b.onclick=async()=>{
    if(!confirm('Shifokorni ro‘yxatdan chiqarilsinmi?'))return;
    try{await api('/api/doctors/'+b.dataset.doc,{method:'DELETE'});await loadAll()}catch(e){alert(e.message)}
  });
}
function render(){renderStats();renderInstitutionOptions();renderTable();renderInstitutions();renderDoctors()}

function locationBlock(x){
  if(x.latitude==null||x.longitude==null)return '';
  const u=`https://www.google.com/maps?q=${encodeURIComponent(x.latitude+','+x.longitude)}`;
  return `<div class="detail-content"><b>📍 Joylashuv</b><p><a href="${u}" target="_blank" rel="noopener">Xaritada ochish</a> · aniqlik ~${Math.round(x.locationAccuracy||0)} m</p></div>`;
}
async function loadAudio(id){
  const b=$('#audioBtn');b.disabled=true;
  try{
    const r=await fetch('/api/appointments/'+id+'/audio',{headers:{authorization:'Bearer '+token}});
    if(!r.ok)throw new Error('Ovozni yuklab bo‘lmadi.');
    const blob=await r.blob();if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=URL.createObjectURL(blob);
    const a=$('#audioPlayer');a.src=audioUrl;a.hidden=false;a.play().catch(()=>{});
  }catch(e){alert(e.message)}finally{b.disabled=false}
}
async function loadTimeline(id){
  const box=$('#timeline');
  try{
    const {events}=await api('/api/appointments/'+id+'/events');
    box.innerHTML=events.map(e=>`<div class="timeline-item"><b>${esc(eventLabels[e.eventType]||e.eventType)}</b>${e.oldStatus&&e.newStatus&&e.oldStatus!==e.newStatus?`<div>${esc(labels[e.oldStatus]||e.oldStatus)} → ${esc(labels[e.newStatus]||e.newStatus)}</div>`:''}${e.note?`<div>${esc(e.note)}</div>`:''}<small>${new Date(e.createdAt).toLocaleString('uz-UZ')}</small></div>`).join('')||'<div class="muted">Tarix mavjud emas.</div>';
  }catch{box.innerHTML='<div class="muted">Tarixni yuklab bo‘lmadi.</div>'}
}
function closeModal(){
  if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl='';$('#detailModal').classList.remove('show');
}
async function saveAppointment(id,status,response){
  await api('/api/appointments/'+id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({status,response})});
  await loadAll();
}
function openDetail(id){
  const x=appointments.find(a=>a.id===id);if(!x)return;
  $('#detailBody').innerHTML=`<h2>${esc(x.fullName)}</h2>
  <p><b>${esc(x.reference)}</b> · <span class="badge ${esc(x.status)}">${esc(labels[x.status]||x.status)}</span></p>
  <div class="detail-content"><b>Murojaat mavzusi</b><p>${esc(x.topic||'Umumiy murojaat')}</p><b>Murojaat mazmuni</b><p>${x.description?esc(x.description).replaceAll('\n','<br>'):'Matn kiritilmagan.'}</p></div>
  ${x.audioSize?`<div class="audio-box"><b>🎙 Ovozli murojaat</b><br><button id="audioBtn" class="btn secondary" type="button">Ovozni tinglash</button><audio id="audioPlayer" controls hidden></audio></div>`:''}
  ${locationBlock(x)}
  <div class="detail-grid">
    <div class="detail-item"><span>Telefon</span><b><a href="tel:${esc(x.phone)}">${esc(x.phone)}</a></b></div>
    <div class="detail-item"><span>Muassasa</span><b>${esc(x.institutionName||'—')}</b></div>
    <div class="detail-item"><span>Shifokor</span><b>${esc(x.doctorName)}</b></div>
    <div class="detail-item"><span>Qabul</span><b>${esc(x.date||'—')} ${esc(x.time||'')}</b></div>
    <div class="detail-item"><span>Yuborilgan</span><b>${new Date(x.createdAt).toLocaleString('uz-UZ')}</b></div>
    <div class="detail-item"><span>Yangilangan</span><b>${new Date(x.updatedAt).toLocaleString('uz-UZ')}</b></div>
  </div>
  <div class="detail-form">
    <div class="quick-actions"><button id="takeWork" class="btn secondary" type="button">Jarayonga olish</button><button id="markDone" class="btn secondary" type="button">Hal qilindi</button></div>
    <label>Holat<select id="detailStatus"><option value="yangi">Yangi</option><option value="jarayonda">Jarayonda</option><option value="hal_qilindi">Hal qilingan</option><option value="rad_etildi">Rad etilgan</option></select></label>
    <label>Bemorga javob<textarea id="detailResponse" rows="5" placeholder="Murojaat bo‘yicha javob...">${esc(x.response||'')}</textarea></label>
    <button id="saveDetail" class="btn primary">Saqlash</button>
  </div>
  <div class="detail-content"><b>Harakatlar tarixi</b><div id="timeline" class="timeline"><div class="muted">Yuklanmoqda…</div></div></div>`;
  $('#detailStatus').value=x.status;
  $('#audioBtn')?.addEventListener('click',()=>loadAudio(id));
  $('#takeWork').onclick=()=>{$('#detailStatus').value='jarayonda'};
  $('#markDone').onclick=()=>{$('#detailStatus').value='hal_qilindi'};
  $('#saveDetail').onclick=async()=>{
    const b=$('#saveDetail');b.disabled=true;
    try{await saveAppointment(id,$('#detailStatus').value,$('#detailResponse').value);closeModal()}catch(e){alert(e.message)}finally{b.disabled=false}
  };
  $('#detailModal').classList.add('show');loadTimeline(id);
}
function csvExport(){
  const data=[['Nazorat','F.I.Sh.','Telefon','Muassasa','Shifokor','Mavzu','Mazmun','Holat','Yordam','Sana'],...filtered().map(x=>[x.reference,x.fullName,x.phone,x.institutionName,x.doctorName,x.topic,x.description,labels[x.status]||x.status,x.needHelp?'Ha':'Yo‘q',x.createdAt])];
  const csv=data.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.download='murojaatlar.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
}
function startAutoRefresh(){
  stopAutoRefresh();
  refreshTimer=setInterval(()=>{if($('#autoRefresh')?.checked&&!document.hidden)loadAll()},30000);
}
function stopAutoRefresh(){if(refreshTimer)clearInterval(refreshTimer);refreshTimer=null}

$('#loginForm').addEventListener('submit',loginSubmit);
$('#logout').onclick=()=>{token='';sessionStorage.removeItem('buxoro-admin-token');showLogin()};
$('#refresh').onclick=loadAll;
$('#search').oninput=renderTable;
$('#filter').onchange=renderTable;
$('#institutionFilter').onchange=renderTable;
$('#csv').onclick=csvExport;
$('#closeModal').onclick=closeModal;
$('#detailModal').onclick=e=>{if(e.target===$('#detailModal'))closeModal()};
$('#institutionForm').onsubmit=async e=>{
  e.preventDefault();
  try{
    await api('/api/institutions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:$('#institutionName').value})});
    e.target.reset();await loadAll();
  }catch(err){alert(err.message)}
};
$('#doctorForm').onsubmit=async e=>{
  e.preventDefault();
  try{
    await api('/api/doctors',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({institutionId:$('#doctorInstitution').value,name:$('#doctorName').value,specialty:$('#doctorSpecialty').value})});
    e.target.reset();await loadAll();
  }catch(err){alert(err.message)}
};
if(token){showDash();loadAll()}else showLogin();
