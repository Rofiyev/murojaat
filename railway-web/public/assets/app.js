const $=(s)=>document.querySelector(s);
const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const params=new URLSearchParams(location.search);
const KIOSK=location.pathname.startsWith('/kiosk')||params.get('kiosk')==='1';
const AUTO_PRINT=KIOSK&&params.get('autoprint')==='1';
const LOCKED_INSTITUTION=KIOSK?(params.get('institution')||''):'';
let institutions=[],doctors=[],voiceBlob=null,voiceUrl='',recorder=null,stream=null,timerId=null,startedAt=0,deferredPrompt=null;
let successTimer=null,idleTimer=null,idleSeconds=0,currentReference='',currentPhone='',pushConfig=null;

async function api(url,opts={}){
  const r=await fetch(url,{...opts,headers:{accept:'application/json',...(opts.headers||{})}});
  let j={};try{j=await r.json()}catch{}
  if(!r.ok)throw new Error(j.error||'So‘rov bajarilmadi.');
  return j;
}
function notice(msg,type='ok'){
  const n=$('#formNotice');if(!n)return;
  n.textContent=msg;n.className='notice show '+type;
  n.scrollIntoView({behavior:'smooth',block:'center'});
}
function fmt(sec){return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0')}
function urlBase64ToUint8Array(base64String){
  const padding='='.repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(base64);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}
function resetVoice(){
  if(recorder&&recorder.state!=='inactive')try{recorder.stop()}catch{}
  if(stream)stream.getTracks().forEach(t=>t.stop());
  stream=null;recorder=null;clearInterval(timerId);timerId=null;voiceBlob=null;
  if(voiceUrl)URL.revokeObjectURL(voiceUrl);voiceUrl='';
  const p=$('#voicePreview');if(p){p.hidden=true;p.removeAttribute('src')}
  if($('#voiceStatus'))$('#voiceStatus').textContent='Ovoz yozilmagan.';
  if($('#startVoice'))$('#startVoice').hidden=false;
  if($('#stopVoice'))$('#stopVoice').hidden=true;
  if($('#deleteVoice'))$('#deleteVoice').hidden=true;
  if($('#voiceTimer'))$('#voiceTimer').textContent='00:00';
}
function showVoice(blob){
  voiceBlob=blob;if(voiceUrl)URL.revokeObjectURL(voiceUrl);voiceUrl=URL.createObjectURL(blob);
  $('#voicePreview').src=voiceUrl;$('#voicePreview').hidden=false;$('#deleteVoice').hidden=false;$('#startVoice').hidden=false;$('#stopVoice').hidden=true;
  $('#voiceStatus').textContent=`Ovoz tayyor — ${Math.max(1,Math.round(blob.size/1024))} KB`;
}
async function startVoice(){
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){
    $('#voiceFallback').hidden=false;$('#voiceStatus').textContent='Brauzerda ovoz yozish mavjud emas. Audio fayl tanlang.';return;
  }
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
    const preferred=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t=>MediaRecorder.isTypeSupported?.(t));
    recorder=new MediaRecorder(stream,preferred?{mimeType:preferred}:undefined);
    const chunks=[];
    recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
    recorder.onstop=()=>{
      const type=recorder?.mimeType||chunks[0]?.type||'audio/webm';
      if(chunks.length)showVoice(new Blob(chunks,{type}));
      stream?.getTracks().forEach(t=>t.stop());stream=null;
    };
    recorder.start(500);startedAt=Date.now();$('#startVoice').hidden=true;$('#stopVoice').hidden=false;$('#deleteVoice').hidden=true;$('#voiceStatus').textContent='Ovoz yozilmoqda…';
    timerId=setInterval(()=>{const s=Math.min(180,Math.floor((Date.now()-startedAt)/1000));$('#voiceTimer').textContent=fmt(s);if(s>=180)stopVoice()},500);
  }catch(e){
    $('#voiceFallback').hidden=false;
    $('#voiceStatus').textContent=e?.name==='NotAllowedError'?'Mikrofonga ruxsat berilmadi. Brauzer sozlamasidan mikrofon ruxsatini yoqing.':'Mikrofonni ishga tushirib bo‘lmadi. Audio fayl tanlashingiz mumkin.';
  }
}
function stopVoice(){if(recorder&&recorder.state!=='inactive')recorder.stop();clearInterval(timerId);timerId=null;$('#stopVoice').hidden=true}

async function loadDirectory(){
  try{
    const [instRes,docRes]=await Promise.all([api('/api/institutions'),api('/api/doctors')]);
    institutions=instRes.institutions||[];doctors=docRes.doctors||[];
    const inst=$('#institutionSelect');
    inst.innerHTML='<option value="">Muassasani tanlang</option>'+institutions.map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('');
    if(LOCKED_INSTITUTION&&institutions.some(i=>i.id===LOCKED_INSTITUTION)){
      inst.value=LOCKED_INSTITUTION;inst.disabled=true;
      inst.insertAdjacentHTML('afterend','<div class="locked-institution">📍 Ushbu kiosk muassasaga biriktirilgan</div>');
      await loadDirections(LOCKED_INSTITUTION);
    }else resetDirections();
    $('#doctorList').innerHTML=doctors.map(d=>`<article class="doctor"><div class="avatar">DR</div><h3>${esc(d.name)}</h3><p>${esc(d.specialty)}</p><small>${esc(d.institutionName)}</small></article>`).join('')||'<p>Hozircha shifokorlar ro‘yxati bo‘sh.</p>';
  }catch(e){
    $('#doctorList').innerHTML='<p>Ma’lumotlarni yuklab bo‘lmadi.</p>';notice('Muassasa va shifokorlar ro‘yxatini yuklab bo‘lmadi. Sahifani yangilang.','err');
  }
}
function resetDirections(){
  const s=$('#directionSelect');s.disabled=true;s.innerHTML='<option value="">Avval muassasani tanlang</option>';
}
async function loadDirections(institutionId){
  const s=$('#directionSelect');
  if(!institutionId){resetDirections();return}
  s.disabled=true;s.innerHTML='<option value="">Yuklanmoqda…</option>';
  try{
    const {directions}=await api('/api/directions?institutionId='+encodeURIComponent(institutionId));
    s.disabled=false;s.innerHTML='<option value="">Yo‘nalishni tanlang</option>'+directions.map(d=>`<option value="${esc(d.name)}">${esc(d.name)} (${d.doctorCount} shifokor)</option>`).join('');
    if(!directions.length){s.disabled=true;s.innerHTML='<option value="">Faol yo‘nalish topilmadi</option>'}
  }catch{resetDirections()}
}

function saveRecent(ref,phone){
  if(KIOSK)return;
  localStorage.setItem('buxoro-last-ref',ref);localStorage.setItem('buxoro-last-phone',phone);showRecent();
}
function showRecent(){
  if(KIOSK)return;
  const ref=localStorage.getItem('buxoro-last-ref'),phone=localStorage.getItem('buxoro-last-phone');
  if(!ref)return;
  const x=$('#recentReference');x.hidden=false;
  x.innerHTML=`Oxirgi murojaat: <b>${esc(ref)}</b> <button class="link-btn" type="button" id="useRecent">Tekshirish</button>`;
  $('#useRecent').onclick=()=>{$('#statusReference').value=ref;$('#statusPhone').value=phone||'';$('#statusForm').requestSubmit()};
}
function clearPatientData(){
  $('#appointmentForm')?.reset();resetVoice();
  if(LOCKED_INSTITUTION&&institutions.some(i=>i.id===LOCKED_INSTITUTION)){
    $('#institutionSelect').value=LOCKED_INSTITUTION;$('#institutionSelect').disabled=true;loadDirections(LOCKED_INSTITUTION);
  }else{$('#institutionSelect').value='';$('#institutionSelect').disabled=false;resetDirections()}
  $('#locationBox').hidden=true;$('#locationStatus').textContent='Joylashuv yuborilmagan.';
  $('#counter').textContent='0 / 2000';$('#formNotice').className='notice';
  $('#statusReference').value='';$('#statusPhone').value='';$('#statusResult').innerHTML='';
  $('#attachmentStatus').textContent='Fayl biriktirilmagan.';
  currentReference='';currentPhone='';
}
function showSuccess(out,phone){
  currentReference=out.reference;currentPhone=phone;
  $('#successReference').textContent=out.reference;
  $('#successQr').src='/api/qr?reference='+encodeURIComponent(out.reference);
  $('#successMeta').innerHTML=`<b>${esc(out.institutionName||'')}</b><br>${esc(out.direction||'')} · ${esc(out.doctorName||'')}`;
  $('#successModal').classList.add('show');$('#successModal').setAttribute('aria-hidden','false');
  $('#pushStatus').textContent='';
  if(AUTO_PRINT)setTimeout(()=>window.print(),700);
  let left=KIOSK?90:0;clearInterval(successTimer);
  if(KIOSK){
    $('#kioskCountdown').textContent='90 soniyadan keyin ekran avtomatik tozalanadi.';
    successTimer=setInterval(()=>{left--;$('#kioskCountdown').textContent=`${left} soniyadan keyin ekran avtomatik tozalanadi.`;if(left<=0){hideSuccess();clearPatientData()}},1000);
  }else $('#kioskCountdown').textContent='';
}
function hideSuccess(){clearInterval(successTimer);successTimer=null;$('#successModal').classList.remove('show');$('#successModal').setAttribute('aria-hidden','true')}

async function submitAppeal(e){
  e.preventDefault();const btn=e.currentTarget.querySelector('.submit');btn.disabled=true;
  try{
    if(!$('#consent').checked)throw new Error('Maxfiylik siyosatiga rozilikni belgilang.');
    const fd=new FormData(e.currentTarget);
    if(LOCKED_INSTITUTION)fd.set('institutionId',LOCKED_INSTITUTION);
    const attachment=$('#attachment').files[0];
    if(attachment&&attachment.size>10*1024*1024)throw new Error('Biriktirilgan fayl 10 MB dan oshmasligi kerak.');
    if(!fd.get('description')?.trim()&&!voiceBlob&&!$('#voiceFile').files[0]&&!attachment)throw new Error('Murojaat mazmunini yozing, ovoz yuboring yoki fayl biriktiring.');
    const audio=voiceBlob||$('#voiceFile').files[0];
    if(audio){
      if(audio.size>3*1024*1024)throw new Error('Ovozli murojaat 3 MB dan oshmasligi kerak.');
      fd.set('audio',audio,audio.name||`murojaat-${Date.now()}.webm`);
      fd.set('audioDurationSec',Math.min(180,Math.round((Date.now()-startedAt)/1000)||0));
    }
    if(!$('#needHelp').checked){fd.delete('latitude');fd.delete('longitude');fd.delete('locationAccuracy');fd.set('needHelp','false')}
    const phone=String(fd.get('phone')||'');
    const out=await api('/api/appointments',{method:'POST',body:fd});
    saveRecent(out.reference,phone);showSuccess(out,phone);
    e.currentTarget.reset();resetVoice();$('#locationBox').hidden=true;$('#counter').textContent='0 / 2000';$('#attachmentStatus').textContent='Fayl biriktirilmagan.';
    if(LOCKED_INSTITUTION){$('#institutionSelect').value=LOCKED_INSTITUTION;$('#institutionSelect').disabled=true;await loadDirections(LOCKED_INSTITUTION)}else resetDirections();
  }catch(err){notice(err.message,'err')}finally{btn.disabled=false}
}

async function checkStatus(e){
  e.preventDefault();const box=$('#statusResult');box.innerHTML='<div class="status-box">Tekshirilmoqda…</div>';
  try{
    const ref=$('#statusReference').value.trim(),phone=$('#statusPhone').value.trim();
    const {appointment:a}=await api(`/api/status?reference=${encodeURIComponent(ref)}&phone=${encodeURIComponent(phone)}`);
    const labels={yangi:'Yangi',jarayonda:'Jarayonda',hal_qilindi:'Hal qilingan',rad_etildi:'Rad etilgan'};
    box.innerHTML=`<div class="status-box"><span class="badge ${esc(a.status)}">${esc(labels[a.status]||a.status)}</span><h3>${esc(a.reference)}</h3><p><b>Muassasa:</b> ${esc(a.institutionName||'—')}</p><p><b>Yo‘nalish:</b> ${esc(a.direction||'—')}</p><p><b>Shifokor:</b> ${esc(a.doctorName||'—')}</p>${a.response?`<p><b>Javob:</b> ${esc(a.response)}</p>`:''}${KIOSK?'':'<div class="status-actions"><button id="statusPush" class="btn secondary" type="button">🔔 Bildirishnomani yoqish</button></div>'}<p class="muted">Yangilangan: ${new Date(a.updatedAt).toLocaleString('uz-UZ')}</p></div>`;
    currentReference=ref;currentPhone=phone;if($('#statusPush'))$('#statusPush').onclick=enablePush;saveRecent(ref,phone);
  }catch(err){box.innerHTML=`<div class="status-box">${esc(err.message)}</div>`}
}
function shareLocation(){
  const s=$('#locationStatus');
  if(!navigator.geolocation){s.textContent='Qurilmada geolokatsiya qo‘llab-quvvatlanmaydi.';return}
  s.textContent='Joylashuv aniqlanmoqda…';
  navigator.geolocation.getCurrentPosition(p=>{
    $('#latitude').value=p.coords.latitude;$('#longitude').value=p.coords.longitude;$('#locationAccuracy').value=Math.round(p.coords.accuracy||0);s.textContent='Joylashuv qo‘shildi.';
  },()=>s.textContent='Joylashuvga ruxsat berilmadi.',{enableHighAccuracy:true,timeout:12000,maximumAge:30000});
}
async function enablePush(){
  const status=$('#pushStatus');
  try{
    if(!currentReference||!currentPhone)throw new Error('Avval murojaatni yuboring yoki holatini tekshiring.');
    pushConfig=pushConfig||await api('/api/push/config');
    if(!pushConfig.enabled)throw new Error('Push bildirishnomalar serverda yoqilmagan.');
    if(!('serviceWorker'in navigator)||!('PushManager'in window))throw new Error('Bu brauzer push bildirishnomani qo‘llab-quvvatlamaydi.');
    const permission=await Notification.requestPermission();
    if(permission!=='granted')throw new Error('Bildirishnomaga ruxsat berilmadi.');
    const reg=await navigator.serviceWorker.ready;
    let sub=await reg.pushManager.getSubscription();
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(pushConfig.publicKey)});
    await api('/api/push/subscribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reference:currentReference,phone:currentPhone,subscription:sub.toJSON()})});
    if(status)status.textContent='Bildirishnomalar yoqildi.';
    const b=$('#enablePush');if(b)b.textContent='✓ Bildirishnoma yoqildi';
  }catch(e){if(status)status.textContent=e.message;else alert(e.message)}
}

function enableKiosk(){
  document.body.classList.add('kiosk-mode');document.title='Murojaat kioski — Buxoro Tibbiyot Tizimi';if($('#enablePush'))$('#enablePush').hidden=true;
  localStorage.removeItem('buxoro-last-ref');localStorage.removeItem('buxoro-last-phone');
  document.querySelectorAll('input,textarea').forEach(x=>x.setAttribute('autocomplete','off'));
  const bar=document.createElement('div');bar.className='kiosk-bar';bar.innerHTML='<b>Infokiosk / planshet rejimi</b><span>Foydalanish tugagach ma’lumotlar avtomatik tozalanadi.</span><button id="fullScreenBtn" class="btn secondary" type="button">To‘liq ekran</button>';document.body.prepend(bar);
  $('#fullScreenBtn').onclick=async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen()}catch{}};

  const main=document.querySelector('main');
  const home=document.createElement('section');home.className='kiosk-home shell';home.innerHTML=`
    <div class="kiosk-title"><img src="/assets/icon_app.png" alt=""><div><span class="eyebrow dark">ELEKTRON MUROJAAT</span><h1>Qanday xizmat kerak?</h1></div></div>
    <div class="kiosk-actions">
      <button id="kioskText" class="kiosk-action" type="button"><span>📝</span><b>Murojaat yuborish</b><small>Matn yozib yuborish</small></button>
      <button id="kioskVoice" class="kiosk-action" type="button"><span>🎙</span><b>Ovozli murojaat</b><small>Gapirib murojaat qoldirish</small></button>
      <button id="kioskStatus" class="kiosk-action" type="button"><span>🔎</span><b>Holatini tekshirish</b><small>Nazorat raqami orqali</small></button>
    </div>`;
  main.prepend(home);
  $('#kioskText').onclick=()=>document.querySelector('#murojaat').scrollIntoView({behavior:'smooth'});
  $('#kioskVoice').onclick=()=>{document.querySelector('#voiceSection').scrollIntoView({behavior:'smooth'});setTimeout(startVoice,500)};
  $('#kioskStatus').onclick=()=>document.querySelector('#holat').scrollIntoView({behavior:'smooth'});
  const resetIdle=()=>{idleSeconds=0};['pointerdown','keydown','touchstart'].forEach(ev=>addEventListener(ev,resetIdle,{passive:true}));
  idleTimer=setInterval(()=>{idleSeconds++;if(idleSeconds>=120&&!recorder){hideSuccess();clearPatientData();scrollTo({top:0,behavior:'smooth'});idleSeconds=0}},1000);
}

$('#menuToggle')?.addEventListener('click',()=>$('#navLinks').classList.toggle('open'));
$('#description')?.addEventListener('input',e=>$('#counter').textContent=`${e.target.value.length} / 2000`);
$('#institutionSelect')?.addEventListener('change',e=>{if(LOCKED_INSTITUTION){e.target.value=LOCKED_INSTITUTION;loadDirections(LOCKED_INSTITUTION);return}loadDirections(e.target.value)});
$('#startVoice')?.addEventListener('click',startVoice);$('#stopVoice')?.addEventListener('click',stopVoice);$('#deleteVoice')?.addEventListener('click',resetVoice);
$('#voiceFile')?.addEventListener('change',e=>{const f=e.target.files[0];if(f)showVoice(f)});
$('#attachment')?.addEventListener('change',e=>{const f=e.target.files[0];$('#attachmentStatus').textContent=f?`${f.name} — ${Math.max(1,Math.round(f.size/1024))} KB`:'Fayl biriktirilmagan.'});
$('#needHelp')?.addEventListener('change',e=>$('#locationBox').hidden=!e.target.checked);
$('#shareLocation')?.addEventListener('click',shareLocation);
$('#appointmentForm')?.addEventListener('submit',submitAppeal);
$('#statusForm')?.addEventListener('submit',checkStatus);
$('#copyReference')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(currentReference);$('#copyReference').textContent='Nusxalandi';setTimeout(()=>$('#copyReference').textContent='Nusxalash',1500)}catch{}});
$('#enablePush')?.addEventListener('click',enablePush);
$('#printReference')?.addEventListener('click',()=>window.print());
$('#newAppeal')?.addEventListener('click',()=>{hideSuccess();clearPatientData();location.hash='murojaat'});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;const b=$('#installPwa');b.hidden=false;b.onclick=async()=>{await deferredPrompt.prompt();deferredPrompt=null;b.hidden=true}});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));

const refFromUrl=params.get('ref');
if(refFromUrl){$('#statusReference').value=refFromUrl;setTimeout(()=>document.querySelector('#holat')?.scrollIntoView({behavior:'smooth'}),350)}
if(KIOSK)enableKiosk();else showRecent();
loadDirectory();
