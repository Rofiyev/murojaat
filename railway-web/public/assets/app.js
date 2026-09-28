const $=(s)=>document.querySelector(s);
const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let voiceBlob=null,voiceUrl='',recorder=null,stream=null,timerId=null,startedAt=0,deferredPrompt=null;

async function api(url,opts={}){const r=await fetch(url,{...opts,headers:{accept:'application/json',...(opts.headers||{})}});let j={};try{j=await r.json()}catch{}if(!r.ok)throw new Error(j.error||'So‘rov bajarilmadi.');return j}
function notice(msg,type='ok'){const n=$('#formNotice');n.textContent=msg;n.className='notice show '+type;n.scrollIntoView({behavior:'smooth',block:'center'})}
function resetVoice(){if(recorder&&recorder.state!=='inactive')try{recorder.stop()}catch{}if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;recorder=null;clearInterval(timerId);timerId=null;voiceBlob=null;if(voiceUrl)URL.revokeObjectURL(voiceUrl);voiceUrl='';$('#voicePreview').hidden=true;$('#voicePreview').removeAttribute('src');$('#voiceStatus').textContent='Ovoz yozilmagan.';$('#startVoice').hidden=false;$('#stopVoice').hidden=true;$('#deleteVoice').hidden=true;$('#voiceTimer').textContent='00:00'}
function showVoice(blob){voiceBlob=blob;if(voiceUrl)URL.revokeObjectURL(voiceUrl);voiceUrl=URL.createObjectURL(blob);$('#voicePreview').src=voiceUrl;$('#voicePreview').hidden=false;$('#deleteVoice').hidden=false;$('#startVoice').hidden=false;$('#stopVoice').hidden=true;$('#voiceStatus').textContent=`Ovoz tayyor — ${Math.max(1,Math.round(blob.size/1024))} KB`}
function fmt(sec){return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0')}
async function startVoice(){
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){$('#voiceFallback').hidden=false;$('#voiceStatus').textContent='Brauzerda to‘g‘ridan-to‘g‘ri ovoz yozish mavjud emas. Audio fayl tanlang.';return}
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
    const preferred=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t=>MediaRecorder.isTypeSupported?.(t));
    recorder=new MediaRecorder(stream,preferred?{mimeType:preferred}:undefined);
    const chunks=[];
    recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
    recorder.onstop=()=>{const type=recorder?.mimeType||chunks[0]?.type||'audio/webm';if(chunks.length)showVoice(new Blob(chunks,{type}));stream?.getTracks().forEach(t=>t.stop());stream=null};
    recorder.start(500);startedAt=Date.now();$('#startVoice').hidden=true;$('#stopVoice').hidden=false;$('#deleteVoice').hidden=true;$('#voiceStatus').textContent='Ovoz yozilmoqda…';
    timerId=setInterval(()=>{const s=Math.min(180,Math.floor((Date.now()-startedAt)/1000));$('#voiceTimer').textContent=fmt(s);if(s>=180)stopVoice()},500);
  }catch(e){$('#voiceFallback').hidden=false;$('#voiceStatus').textContent=e?.name==='NotAllowedError'?'Mikrofonga ruxsat berilmadi. Brauzer sozlamasidan mikrofon ruxsatini yoqing.':'Mikrofonni ishga tushirib bo‘lmadi. Audio fayl tanlashingiz mumkin.'}
}
function stopVoice(){if(recorder&&recorder.state!=='inactive')recorder.stop();clearInterval(timerId);timerId=null;$('#stopVoice').hidden=true}
async function loadDoctors(){try{const {doctors}=await api('/api/doctors');const sel=$('#doctorSelect');sel.innerHTML='<option value="">Mutaxassisni tanlang</option>'+doctors.map(d=>`<option value="${esc(d.id)}">${esc(d.name)} — ${esc(d.specialty)}</option>`).join('');$('#doctorList').innerHTML=doctors.map(d=>`<article class="doctor"><div class="avatar">DR</div><h3>${esc(d.name)}</h3><p>${esc(d.specialty)}</p></article>`).join('')||'<p>Hozircha shifokorlar ro‘yxati bo‘sh.</p>'}catch(e){$('#doctorList').innerHTML='<p>Shifokorlar ro‘yxatini yuklab bo‘lmadi.</p>'}}
function saveRecent(ref,phone){localStorage.setItem('buxoro-last-ref',ref);localStorage.setItem('buxoro-last-phone',phone);showRecent()}
function showRecent(){const ref=localStorage.getItem('buxoro-last-ref'),phone=localStorage.getItem('buxoro-last-phone');if(!ref)return;const x=$('#recentReference');x.hidden=false;x.innerHTML=`Oxirgi murojaat: <b>${esc(ref)}</b> <button class="link-btn" type="button" id="useRecent">Tekshirish</button>`;$('#useRecent').onclick=()=>{$('#statusReference').value=ref;$('#statusPhone').value=phone||'';$('#statusForm').requestSubmit()}}
async function submitAppeal(e){e.preventDefault();const btn=e.currentTarget.querySelector('.submit');btn.disabled=true;try{if(!$('#consent').checked)throw new Error('Maxfiylik siyosatiga rozilikni belgilang.');const fd=new FormData(e.currentTarget);if(!fd.get('description')?.trim()&&!voiceBlob&&!$('#voiceFile').files[0])throw new Error('Murojaat mazmunini yozing yoki ovoz yuboring.');const audio=voiceBlob||$('#voiceFile').files[0];if(audio){fd.set('audio',audio, audio.name||`murojaat-${Date.now()}.webm`);fd.set('audioDurationSec',Math.min(180,Math.round((Date.now()-startedAt)/1000)||0))}if(!$('#needHelp').checked){fd.delete('latitude');fd.delete('longitude');fd.delete('locationAccuracy');fd.set('needHelp','false')}const out=await api('/api/appointments',{method:'POST',body:fd});notice(`Murojaatingiz qabul qilindi. Nazorat raqami: ${out.reference}`,'ok');saveRecent(out.reference,fd.get('phone'));e.currentTarget.reset();resetVoice();$('#locationBox').hidden=true;$('#counter').textContent='0 / 2000'}catch(err){notice(err.message,'err')}finally{btn.disabled=false}}
async function checkStatus(e){e.preventDefault();const box=$('#statusResult');box.innerHTML='<div class="status-box">Tekshirilmoqda…</div>';try{const ref=$('#statusReference').value.trim(),phone=$('#statusPhone').value.trim();const {appointment:a}=await api(`/api/status?reference=${encodeURIComponent(ref)}&phone=${encodeURIComponent(phone)}`);const labels={yangi:'Yangi',jarayonda:'Jarayonda',hal_qilindi:'Hal qilingan',rad_etildi:'Rad etilgan'};box.innerHTML=`<div class="status-box"><span class="badge ${esc(a.status)}">${esc(labels[a.status]||a.status)}</span><h3>${esc(a.reference)}</h3><p><b>Shifokor:</b> ${esc(a.doctorName||'—')}</p>${a.response?`<p><b>Javob:</b> ${esc(a.response)}</p>`:''}<p class="muted">Yangilangan: ${new Date(a.updatedAt).toLocaleString('uz-UZ')}</p></div>`;saveRecent(ref,phone)}catch(err){box.innerHTML=`<div class="status-box">${esc(err.message)}</div>`}}
function shareLocation(){const s=$('#locationStatus');if(!navigator.geolocation){s.textContent='Qurilmada geolokatsiya qo‘llab-quvvatlanmaydi.';return}s.textContent='Joylashuv aniqlanmoqda…';navigator.geolocation.getCurrentPosition(p=>{$('#latitude').value=p.coords.latitude;$('#longitude').value=p.coords.longitude;$('#locationAccuracy').value=Math.round(p.coords.accuracy||0);s.textContent='Joylashuv qo‘shildi.'},()=>s.textContent='Joylashuvga ruxsat berilmadi.',{enableHighAccuracy:true,timeout:12000,maximumAge:30000})}

$('#menuToggle')?.addEventListener('click',()=>{$('#navLinks').classList.toggle('open')});
$('#description')?.addEventListener('input',e=>$('#counter').textContent=`${e.target.value.length} / 2000`);
$('#startVoice')?.addEventListener('click',startVoice);$('#stopVoice')?.addEventListener('click',stopVoice);$('#deleteVoice')?.addEventListener('click',resetVoice);
$('#voiceFile')?.addEventListener('change',e=>{const f=e.target.files[0];if(f)showVoice(f)});
$('#needHelp')?.addEventListener('change',e=>$('#locationBox').hidden=!e.target.checked);
$('#shareLocation')?.addEventListener('click',shareLocation);
$('#appointmentForm')?.addEventListener('submit',submitAppeal);
$('#statusForm')?.addEventListener('submit',checkStatus);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;const b=$('#installPwa');b.hidden=false;b.onclick=async()=>{await deferredPrompt.prompt();deferredPrompt=null;b.hidden=true}});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
loadDoctors();showRecent();
