const $=(s)=>document.querySelector(s);
const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const role=document.body.dataset.role;
const tokenKey='buxoro-'+role+'-token';
let token=sessionStorage.getItem(tokenKey)||'',appointments=[],doctors=[],analytics={},audioUrl='',refreshTimer=null;
const labels={yangi:'Yangi',jarayonda:'Jarayonda',hal_qilindi:'Hal qilingan',rad_etildi:'Rad etilgan'};
const eventLabels={created:'Murojaat yuborildi',status_changed:'Holat o‘zgartirildi',response_updated:'Javob yangilandi',reassigned:'Shifokor almashtirildi'};

async function api(url,opts={}){
  const h={accept:'application/json',...(opts.headers||{})};if(token)h.authorization='Bearer '+token;
  const r=await fetch(url,{...opts,headers:h});let j={};try{j=await r.json()}catch{}
  if(!r.ok)throw new Error(j.error||'So‘rov bajarilmadi.');return j;
}
function showLogin(){$('#loginView').hidden=false;$('#dashView').hidden=true;stopRefresh()}
function showDash(){$('#loginView').hidden=true;$('#dashView').hidden=false;startRefresh()}
async function loginSubmit(e){
  e.preventDefault();$('#loginError').textContent='';
  try{
    const j=await api('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login:$('#login').value,password:$('#password').value})});
    if(j.role!==role)throw new Error(role==='institution'?'Bu login muassasa kabinetiga tegishli emas.':'Bu login shifokor kabinetiga tegishli emas.');
    token=j.token;sessionStorage.setItem(tokenKey,token);$('#profileName').textContent=j.displayName||'';showDash();await loadAll();
    if(j.mustChangePassword)setTimeout(()=>alert('Xavfsizlik uchun vaqtinchalik parolni almashtirish tavsiya etiladi.'),250);
  }catch(e){$('#loginError').textContent=e.message}
}
async function loadAll(){
  try{
    const j=await api('/api/portal/dashboard');
    appointments=j.appointments||[];doctors=j.doctors||[];analytics=j.analytics||{};render();
  }catch(e){
    if(/Avtorizatsiya|ruxsat/i.test(e.message)){token='';sessionStorage.removeItem(tokenKey);showLogin()}
    else console.error(e);
  }
}
function renderStats(){
  $('#sAll').textContent=analytics.total||0;$('#sNew').textContent=analytics.newCount||0;$('#sProgress').textContent=analytics.inProgress||0;
  $('#sDone').textContent=analytics.done||0;$('#sOverdue').textContent=analytics.overdue24||0;$('#sAvg').textContent=(analytics.avgResolutionHours||0)+' soat';
}
function filtered(){
  const q=$('#search').value.trim().toLowerCase(),f=$('#filter').value;
  return appointments.filter(x=>{
    const hay=`${x.reference} ${x.fullName} ${x.phone} ${x.direction} ${x.topic} ${x.description}`.toLowerCase();
    const fm=!f||x.status===f||(f==='overdue'&&['yellow','red'].includes(x.slaLevel))||(f==='audio'&&x.audioSize>0)||(f==='file'&&x.attachmentSize>0);
    return fm&&(!q||hay.includes(q));
  });
}
function slaBadge(x){if(x.slaLevel==='red')return '<span class="sla red-sla">48+ soat</span>';if(x.slaLevel==='yellow')return '<span class="sla yellow-sla">24+ soat</span>';return ''}
function renderTable(){
  $('#rows').innerHTML=filtered().map(x=>`<tr class="${x.slaLevel==='red'?'overdue-red':x.slaLevel==='yellow'?'overdue-yellow':''}">
    <td><b>${esc(x.reference)}</b><br>${slaBadge(x)}</td>
    <td>${esc(x.fullName)}<br><small>${esc(x.phone)}</small></td>
    <td>${esc(x.direction||'—')}</td>
    ${role==='institution'?`<td>${esc(x.doctorName||'—')}</td>`:''}
    <td><div class="content-preview"><b>${esc(x.topic||'Murojaat')}</b><br>${esc(x.description||(x.audioSize?'Ovozli murojaat':'—'))}</div></td>
    <td><span class="badge ${esc(x.status)}">${esc(labels[x.status]||x.status)}</span></td>
    <td>${new Date(x.createdAt).toLocaleString('uz-UZ')}</td>
    <td><button class="link-btn" data-id="${esc(x.id)}">Batafsil</button></td>
  </tr>`).join('')||`<tr><td colspan="${role==='institution'?8:7}">Murojaatlar topilmadi.</td></tr>`;
  $('#rows').querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>openDetail(b.dataset.id));
}
function renderCharts(){
  const top=(analytics.byDirection||[]).slice(0,6),max=Math.max(1,...top.map(x=>x.count));
  $('#directionBars').innerHTML=top.map(x=>`<div class="bar-row"><span>${esc(x.name)}</span><div><i style="width:${Math.max(5,x.count/max*100)}%"></i></div><b>${x.count}</b></div>`).join('')||'<p class="muted">Ma’lumot yetarli emas.</p>';
}
function render(){renderStats();renderTable();renderCharts()}

async function loadEvents(id){
  try{
    const {events}=await api('/api/appointments/'+id+'/events');
    $('#timeline').innerHTML=events.map(e=>`<div class="timeline-item"><b>${esc(eventLabels[e.eventType]||e.eventType)}</b>${e.oldStatus&&e.newStatus&&e.oldStatus!==e.newStatus?`<div>${esc(labels[e.oldStatus]||e.oldStatus)} → ${esc(labels[e.newStatus]||e.newStatus)}</div>`:''}${e.note?`<div>${esc(e.note)}</div>`:''}<small>${new Date(e.createdAt).toLocaleString('uz-UZ')}</small></div>`).join('')||'<div class="muted">Tarix mavjud emas.</div>';
  }catch{$('#timeline').innerHTML='<div class="muted">Tarixni yuklab bo‘lmadi.</div>'}
}
async function loadAudio(id){
  try{
    const r=await fetch('/api/appointments/'+id+'/audio',{headers:{authorization:'Bearer '+token}});if(!r.ok)throw new Error('Ovozni yuklab bo‘lmadi.');
    const blob=await r.blob();if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=URL.createObjectURL(blob);const a=$('#audioPlayer');a.src=audioUrl;a.hidden=false;a.play().catch(()=>{});
  }catch(e){alert(e.message)}
}
async function downloadAttachment(id,name){
  try{
    const r=await fetch('/api/appointments/'+id+'/attachment',{headers:{authorization:'Bearer '+token}});if(!r.ok)throw new Error('Faylni yuklab bo‘lmadi.');
    const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name||'biriktirma';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){alert(e.message)}
}
function closeModal(){if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl='';$('#detailModal').classList.remove('show')}
function openDetail(id){
  const x=appointments.find(a=>a.id===id);if(!x)return;
  const doctorSelect=role==='institution'?`<label>Shifokor<select id="detailDoctor">${doctors.map(d=>`<option value="${esc(d.id)}">${esc(d.name)} — ${esc(d.specialty)}</option>`).join('')}</select></label>`:'';
  $('#detailBody').innerHTML=`<h2>${esc(x.fullName)}</h2><p><b>${esc(x.reference)}</b> · <span class="badge ${esc(x.status)}">${esc(labels[x.status]||x.status)}</span> ${slaBadge(x)}</p>
  <div class="detail-content"><b>Yo‘nalish</b><p>${esc(x.direction||'—')}</p><b>Murojaat turi</b><p>${esc(x.topic||'—')}</p><b>Murojaat mazmuni</b><p>${x.description?esc(x.description).replaceAll('\n','<br>'):'Matn kiritilmagan.'}</p></div>
  ${x.audioSize?'<div class="audio-box"><b>🎙 Ovozli murojaat</b><br><button id="audioBtn" class="btn secondary">Tinglash</button><audio id="audioPlayer" controls hidden></audio></div>':''}
  ${x.attachmentSize?`<div class="audio-box"><b>📎 Biriktirilgan fayl</b><p>${esc(x.attachmentName)} · ${Math.round(x.attachmentSize/1024)} KB</p><button id="fileBtn" class="btn secondary">Faylni yuklash</button></div>`:''}
  ${x.latitude!=null?`<div class="detail-content"><b>📍 Joylashuv</b><p><a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${encodeURIComponent(x.latitude+','+x.longitude)}">Xaritada ochish</a></p></div>`:''}
  <div class="detail-grid"><div class="detail-item"><span>Telefon</span><b><a href="tel:${esc(x.phone)}">${esc(x.phone)}</a></b></div><div class="detail-item"><span>Shifokor</span><b>${esc(x.doctorName||'—')}</b></div><div class="detail-item"><span>Yuborilgan</span><b>${new Date(x.createdAt).toLocaleString('uz-UZ')}</b></div><div class="detail-item"><span>Yoshi</span><b>${x.ageHours} soat</b></div></div>
  <div class="detail-form">${doctorSelect}<label>Holat<select id="detailStatus"><option value="yangi">Yangi</option><option value="jarayonda">Jarayonda</option><option value="hal_qilindi">Hal qilingan</option><option value="rad_etildi">Rad etilgan</option></select></label><label>Bemorga javob<textarea id="detailResponse" rows="5">${esc(x.response||'')}</textarea></label><div class="quick-actions"><button id="takeWork" class="btn secondary">Jarayonga olish</button><button id="markDone" class="btn secondary">Hal qilindi</button><button id="saveDetail" class="btn primary">Saqlash</button></div></div>
  <div class="detail-content"><b>Harakatlar tarixi</b><div id="timeline" class="timeline">Yuklanmoqda…</div></div>`;
  $('#detailStatus').value=x.status;if($('#detailDoctor'))$('#detailDoctor').value=x.doctorId;
  $('#audioBtn')?.addEventListener('click',()=>loadAudio(id));$('#fileBtn')?.addEventListener('click',()=>downloadAttachment(id,x.attachmentName));
  $('#takeWork').onclick=()=>$('#detailStatus').value='jarayonda';$('#markDone').onclick=()=>$('#detailStatus').value='hal_qilindi';
  $('#saveDetail').onclick=async()=>{const b=$('#saveDetail');b.disabled=true;try{await api('/api/appointments/'+id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({status:$('#detailStatus').value,response:$('#detailResponse').value,doctorId:$('#detailDoctor')?.value||''})});closeModal();await loadAll()}catch(e){alert(e.message)}finally{b.disabled=false}};
  $('#detailModal').classList.add('show');loadEvents(id);
}
async function downloadReport(kind){
  try{
    const r=await fetch('/api/reports/'+kind,{headers:{authorization:'Bearer '+token}});if(!r.ok)throw new Error('Hisobotni yuklab bo‘lmadi.');
    const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=kind==='excel'?'murojaatlar-hisobot.xlsx':'murojaatlar-hisobot.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){alert(e.message)}
}
async function changePassword(){
  const current=prompt('Amaldagi parolni kiriting:');if(!current)return;
  const next=prompt('Yangi parol (kamida 8 belgi):');if(!next)return;
  try{await api('/api/account/password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({currentPassword:current,newPassword:next})});alert('Parol yangilandi.')}catch(e){alert(e.message)}
}
function startRefresh(){stopRefresh();refreshTimer=setInterval(()=>{if(!document.hidden)loadAll()},30000)}
function stopRefresh(){if(refreshTimer)clearInterval(refreshTimer);refreshTimer=null}

$('#loginForm').addEventListener('submit',loginSubmit);
$('#logout').onclick=()=>{token='';sessionStorage.removeItem(tokenKey);showLogin()};
$('#refresh').onclick=loadAll;$('#search').oninput=renderTable;$('#filter').onchange=renderTable;
$('#closeModal').onclick=closeModal;$('#detailModal').onclick=e=>{if(e.target===$('#detailModal'))closeModal()};
$('#changePassword').onclick=changePassword;
$('#excelReport')?.addEventListener('click',()=>downloadReport('excel'));$('#pdfReport')?.addEventListener('click',()=>downloadReport('pdf'));
if(role==='doctor')document.querySelectorAll('[data-institution-only]').forEach(x=>x.hidden=true);
if(token){showDash();loadAll()}else showLogin();
