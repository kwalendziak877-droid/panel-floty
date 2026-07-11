const LOCAL = location.protocol === 'file:' || new URLSearchParams(location.search).has('preview');
const KEYS = { vehicles: 'panelFloty.cloudPreview.vehicles', settings: 'panelFloty.cloudPreview.settings' };
const $ = id => document.getElementById(id);
let vehicles = [];
let settings = { email:'', email_enabled:1, push_enabled:1, reminder_days:[30,14,7] };
let filter = 'all';
let installPrompt = null;
let oneSignal = null;
let remoteConfig = null;

function localRead(key, fallback){ try{return JSON.parse(localStorage.getItem(key)) ?? fallback}catch{return fallback} }
function localWrite(key, value){ localStorage.setItem(key, JSON.stringify(value)); }
function esc(value=''){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function norm(value=''){return String(value).toLocaleLowerCase('pl').replace(/\s+/g,' ').trim()}
function parseDate(value){if(!value)return null;const [y,m,d]=value.split('-').map(Number);return new Date(y,m-1,d)}
function daysLeft(value){const date=parseDate(value);if(!date)return null;const now=new Date();const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());return Math.round((date-today)/86400000)}
function status(value){const d=daysLeft(value);if(d===null)return{level:0,cls:'',label:'Nie dotyczy'};if(d<0)return{level:3,cls:'danger',label:`${Math.abs(d)} dni po terminie`};if(d===0)return{level:3,cls:'danger',label:'Termin dzisiaj'};if(d<=30)return{level:2,cls:'soon',label:`${d} dni`};return{level:1,cls:'ok',label:`${d} dni`}}
function fmt(value){const date=parseDate(value);return date?date.toLocaleDateString('pl-PL',{day:'2-digit',month:'2-digit',year:'numeric'}):'—'}
function dates(v){return[v.inspection,v.tachograph,v.oc,v.ac].filter(Boolean)}
function worst(v){return Math.max(0,...dates(v).map(d=>status(d).level))}
function dateCell(label,value){const s=status(value);return `<div class="date"><span class="cell-label">${label}</span>${value?fmt(value):'—'}<br><span class="badge ${s.cls}">${s.label}</span></div>`}
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2400)}

async function api(path, options={}){
  if(LOCAL)return localApi(path,options);
  const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(body.error||'Błąd połączenia');error.status=response.status;throw error}
  return body;
}

async function localApi(path,options){
  const method=options.method||'GET';
  if(path==='/api/session')return{authenticated:true};
  if(path==='/api/config')return{oneSignalAppId:'',ownerAlias:'fleet-owner'};
  if(path==='/api/vehicles'&&method==='GET')return{vehicles:localRead(KEYS.vehicles,[])};
  if(path==='/api/vehicles'&&method==='PUT'){
    const item=JSON.parse(options.body);const list=localRead(KEYS.vehicles,[]);const next=list.some(v=>v.id===item.id)?list.map(v=>v.id===item.id?item:v):[...list,item];localWrite(KEYS.vehicles,next);return{vehicle:item};
  }
  if(path.startsWith('/api/vehicles/')&&method==='DELETE'){const id=decodeURIComponent(path.split('/').pop());localWrite(KEYS.vehicles,localRead(KEYS.vehicles,[]).filter(v=>v.id!==id));return{ok:true}}
  if(path==='/api/settings'&&method==='GET')return{settings:localRead(KEYS.settings,settings)};
  if(path==='/api/settings'&&method==='PUT'){const value=JSON.parse(options.body);localWrite(KEYS.settings,value);return{settings:value}}
  return{ok:true};
}

async function boot(){
  $('todayText').textContent=new Date().toLocaleDateString('pl-PL',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  if(LOCAL){$('setupBanner').hidden=false;showApp();return}
  try{await api('/api/session');showApp()}catch(error){if(error.status===401)$('loginDialog').showModal();else fatal(error.message)}
}

async function showApp(){
  $('app').hidden=false;
  try{
    const [v,s,c]=await Promise.all([api('/api/vehicles'),api('/api/settings'),api('/api/config')]);
    vehicles=v.vehicles||[];settings=s.settings||settings;remoteConfig=c;render();fillSettings();
    if(!LOCAL)initOneSignal(false);
  }catch(error){fatal(error.message)}
}
function fatal(message){$('setupBanner').hidden=false;$('setupBanner').textContent=`Nie udało się uruchomić aplikacji: ${message}`}

function render(){
  const query=norm($('search').value);
  const list=vehicles.filter(v=>{
    if(query&&!norm([v.registration,v.brand,v.model,v.vin].join(' ')).includes(query))return false;
    if(filter==='truck'||filter==='trailer')return v.type===filter;
    if(filter==='alerts')return worst(v)>=2;
    return true;
  }).sort((a,b)=>Math.min(...dates(a).map(daysLeft))-Math.min(...dates(b).map(daysLeft)));
  const late=vehicles.filter(v=>dates(v).some(d=>daysLeft(d)<0)).length;
  const soon=vehicles.filter(v=>!dates(v).some(d=>daysLeft(d)<0)&&dates(v).some(d=>daysLeft(d)>=0&&daysLeft(d)<=30)).length;
  const ok=vehicles.filter(v=>dates(v).length&&dates(v).every(d=>daysLeft(d)>30)).length;
  $('statAll').textContent=vehicles.length;$('statOk').textContent=ok;$('statSoon').textContent=soon;$('statLate').textContent=late;
  $('resultCount').textContent=`${list.length} ${list.length===1?'pozycja':list.length>1&&list.length<5?'pozycje':'pozycji'}`;
  if(!list.length){
    const empty=!vehicles.length;
    $('vehicleList').innerHTML=`<div class="empty"><i>${empty?'🚛':'⌕'}</i><h3>${empty?'Dodaj pierwszy pojazd':'Nic nie znaleziono'}</h3><p>${empty?'Wpisz dane ciągnika lub naczepy, a aplikacja zacznie pilnować terminów.':'Zmień wyszukiwaną frazę albo filtr.'}</p>${empty?'<button class="btn primary" id="emptyAdd">＋ Dodaj pojazd</button>':''}</div>`;
    if(empty)$('emptyAdd').onclick=openAdd;return;
  }
  $('vehicleList').innerHTML=list.map(v=>`<article class="vehicle-row">
    <div class="vehicle-main"><div class="vehicle-icon">${v.type==='truck'?'🚚':'▰'}</div><div><div class="plate">${esc(v.registration)}</div><div class="muted">${esc([v.brand,v.model].filter(Boolean).join(' ')||v.vin||'Brak dodatkowych danych')}</div></div></div>
    <div><span class="cell-label">Rodzaj</span>${v.type==='truck'?'Ciągnik':'Naczepa'}</div>
    ${dateCell('Przegląd',v.inspection)}${dateCell('Tachograf',v.tachograph)}${dateCell('OC',v.oc)}${dateCell('AC',v.ac)}
    <div class="actions"><button class="icon-btn" data-edit="${esc(v.id)}" title="Edytuj">✎</button><button class="icon-btn" data-delete="${esc(v.id)}" title="Usuń">🗑</button></div>
  </article>`).join('');
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEdit(b.dataset.edit));
  document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>removeVehicle(b.dataset.delete));
}

function openAdd(){$('vehicleForm').reset();$('vehicleId').value='';$('vehicleTitle').textContent='Dodaj pojazd';$('vehicleDialog').showModal()}
function openEdit(id){const v=vehicles.find(x=>x.id===id);if(!v)return;$('vehicleTitle').textContent='Edytuj pojazd';['registration','type','brand','model','vin','inspection','tachograph','oc','ac','notes'].forEach(k=>$(k).value=v[k]||'');$('vehicleId').value=v.id;$('vehicleDialog').showModal()}
async function removeVehicle(id){const v=vehicles.find(x=>x.id===id);if(!v||!confirm(`Usunąć pojazd ${v.registration}?`))return;await api(`/api/vehicles/${encodeURIComponent(id)}`,{method:'DELETE'});vehicles=vehicles.filter(x=>x.id!==id);render();toast('Pojazd został usunięty')}

$('vehicleForm').addEventListener('submit',async event=>{
  event.preventDefault();const id=$('vehicleId').value||crypto.randomUUID();const registration=$('registration').value.toUpperCase().replace(/\s+/g,' ').trim();
  if(vehicles.some(v=>norm(v.registration)===norm(registration)&&v.id!==id)){toast('Ten numer rejestracyjny już istnieje');return}
  const item={id,registration,type:$('type').value,brand:$('brand').value.trim(),model:$('model').value.trim(),vin:$('vin').value.toUpperCase().trim(),inspection:$('inspection').value,tachograph:$('tachograph').value,oc:$('oc').value,ac:$('ac').value,notes:$('notes').value.trim()};
  try{await api('/api/vehicles',{method:'PUT',body:JSON.stringify(item)});vehicles=vehicles.some(v=>v.id===id)?vehicles.map(v=>v.id===id?item:v):[...vehicles,item];$('vehicleDialog').close();render();toast('Pojazd został zapisany')}catch(error){toast(error.message)}
});

function fillSettings(){
  $('email').value=settings.email||'';$('emailEnabled').checked=!!Number(settings.email_enabled);$('pushEnabled').checked=!!Number(settings.push_enabled);
  const days=Array.isArray(settings.reminder_days)?settings.reminder_days:JSON.parse(settings.reminder_days||'[]');document.querySelectorAll('[name="day"]').forEach(x=>x.checked=days.includes(Number(x.value)));
}
$('settingsForm').addEventListener('submit',async event=>{
  event.preventDefault();settings={email:$('email').value.trim(),email_enabled:$('emailEnabled').checked?1:0,push_enabled:$('pushEnabled').checked?1:0,reminder_days:[...document.querySelectorAll('[name="day"]:checked')].map(x=>Number(x.value)).sort((a,b)=>b-a)};
  try{await api('/api/settings',{method:'PUT',body:JSON.stringify(settings)});$('settingsDialog').close();toast('Ustawienia zostały zapisane')}catch(error){toast(error.message)}
});

async function initOneSignal(askPermission){
  if(LOCAL){$('notifyStatus').textContent='Powiadomienia włączysz po opublikowaniu aplikacji.';return}
  try{
    remoteConfig=remoteConfig||await api('/api/config');
    if(!remoteConfig.oneSignalAppId){$('notifyStatus').textContent='Najpierw trzeba wpisać identyfikator OneSignal podczas publikacji.';return}
    if(!oneSignal){
      await new Promise((resolve,reject)=>{
        window.OneSignalDeferred=window.OneSignalDeferred||[];
        window.OneSignalDeferred.push(async OneSignal=>{try{await OneSignal.init({appId:remoteConfig.oneSignalAppId,serviceWorkerPath:'OneSignalSDKWorker.js',serviceWorkerParam:{scope:'/'},allowLocalhostAsSecureOrigin:true});await OneSignal.login(remoteConfig.ownerAlias);oneSignal=OneSignal;resolve()}catch(e){reject(e)}});
      });
    }
    if(askPermission){await oneSignal.Notifications.requestPermission();await oneSignal.User.PushSubscription.optIn()}
    const enabled=oneSignal.Notifications.permission&&oneSignal.User.PushSubscription.optedIn;
    $('notifyStatus').textContent=enabled?'Powiadomienia są włączone na tym urządzeniu.':'Dotknij przycisku i zezwól na powiadomienia.';
  }catch(error){$('notifyStatus').textContent=`Nie udało się włączyć: ${error.message}`}
}

$('notifyBtn').onclick=()=>initOneSignal(true);
$('settingsBtn').onclick=()=>{fillSettings();$('settingsDialog').showModal()};
$('addBtn').onclick=openAdd;
$('search').oninput=render;
$('filters').onclick=event=>{const b=event.target.closest('[data-filter]');if(!b)return;filter=b.dataset.filter;document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x===b));render()};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());

$('loginForm').addEventListener('submit',async event=>{
  event.preventDefault();$('loginError').textContent='';
  try{await api('/api/login',{method:'POST',body:JSON.stringify({password:$('password').value})});$('loginDialog').close();showApp()}catch(error){$('loginError').textContent=error.status===401?'Nieprawidłowe hasło.':error.message}
});
$('logoutBtn').onclick=async()=>{if(LOCAL)return toast('Tryb podglądu nie wymaga logowania');await api('/api/logout',{method:'POST'});location.reload()};

window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('installBtn').hidden=false});
$('installBtn').onclick=async()=>{if(!installPrompt){toast('Na iPhonie: Udostępnij → Do ekranu początkowego');return}await installPrompt.prompt();installPrompt=null;$('installBtn').hidden=true};
window.addEventListener('appinstalled',()=>toast('Aplikacja została zainstalowana'));
if('serviceWorker'in navigator&&!LOCAL)navigator.serviceWorker.register('/OneSignalSDKWorker.js',{scope:'/'}).catch(()=>{});

boot();
