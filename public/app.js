const $=s=>document.querySelector(s);
let state=null,mode='login',refreshTask=null,lastRender='',locationWatch=null,sessionEpoch=0,mutating=false;
const drafts=new Map();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(n,currency)=>currency?new Intl.NumberFormat(undefined,{style:'currency',currency}).format(Number(n)):Number(n).toLocaleString(undefined,{maximumFractionDigits:2});
let currencies=['USD','EUR','GBP','INR','LKR','CAD','AUD','JPY'];
function toast(message,error=false){const n=$('#notice');n.textContent=message;n.className=error?'error':'';n.style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>n.style.display='none',6000)}
async function api(path,data){const r=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const j=await r.json();if(!r.ok){const e=new Error(j.error||'Request failed');e.status=r.status;throw e}return j}
function values(form){return Object.fromEntries(new FormData(form))}
function auth(){sessionEpoch++;stopLocation();drafts.clear();state=null;lastRender='';$('#account').innerHTML='';$('#app').innerHTML=`<div class="hero"><section><span class="pill">A BETTER WAY TO GET THERE</span><h1>Your next ride.<br>Your kind of fare.</h1><p>Set your destination. Agree on a price.<br>Pay your driver in cash when you arrive.</p><div class="hero-art"><span class="eyebrow">LESS HASSLE. MORE GOING.</span><strong>Good rides.<br>Fair fares.</strong><div class="road"><span>●</span><span>→</span><span>◆</span></div></div></section><section class="card auth"><div class="tabs"><button data-mode="login" class="${mode==='login'?'selected':''}">Sign in</button><button data-mode="register" class="${mode==='register'?'selected':''}">Create account</button></div><h2>${mode==='login'?'Welcome back.':'Let’s get you moving.'}</h2><p>${mode==='login'?'Your next journey starts here.':'One account. Your choice of the road.'}</p><form id="auth-form">${mode==='register'?'<label for="name">Full name</label><input id="name" name="name" autocomplete="name" required maxlength="80"><label for="role">I want to</label><select id="role" name="role"><option value="customer">Book a ride</option><option value="driver">Drive with Jawa Ride</option></select><div id="driver-fields" hidden><label for="vehicle">Vehicle model & colour</label><input id="vehicle" name="vehicle" maxlength="80"><label for="plate">Registration plate</label><input id="plate" name="plate" maxlength="30"></div>':''}<label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="${mode==='login'?'current-password':'new-password'}" minlength="${mode==='register'?10:1}" maxlength="200" required><button class="wide primary">${mode==='login'?'Sign in →':'Create account →'}</button><p class="hint">Cash only. No card or bank details needed. This deployment uses email and password; phone verification is not connected.</p><div id="auth-error" class="error-box" role="alert"></div></form></section></div>`;
 document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;auth()});if($('#role'))$('#role').onchange=e=>{$('#driver-fields').hidden=e.target.value!=='driver';$('#vehicle').required=$('#plate').required=e.target.value==='driver'};
 $('#auth-form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{await api(mode,values(e.target));await refresh(true)}catch(err){$('#auth-error').textContent=err.message}finally{b.disabled=false}}}
function rideForm(){return `<section class="card"><span class="eyebrow">LET'S GO SOMEWHERE</span><h2>Where to today?</h2><form id="ride-form"><label for="pickup">Pickup location</label><input id="pickup" name="pickup" placeholder="Street address or landmark" required maxlength="200"><div class="cols"><div><label for="plat">Pickup latitude</label><input id="plat" name="plat" type="number" step="any" min="-90" max="90" required placeholder="e.g. 6.9271"></div><div><label for="plng">Pickup longitude</label><input id="plng" name="plng" type="number" step="any" min="-180" max="180" required placeholder="e.g. 79.8612"></div></div><button type="button" id="pickup-gps" class="small ghost wide">◎ Use my current location</button><label for="destination">Destination</label><input id="destination" name="destination" placeholder="Where are you heading?" required maxlength="200"><div class="cols"><div><label for="dlat">Destination latitude</label><input id="dlat" name="dlat" type="number" step="any" min="-90" max="90" required></div><div><label for="dlng">Destination longitude</label><input id="dlng" name="dlng" type="number" step="any" min="-180" max="180" required></div></div><label for="currency">Ride currency</label><select id="currency" name="currency">${currencies.map(c=>`<option value="${c}" ${c==='USD'?'selected':''}>${c}</option>`).join('')}</select><label for="budget">Your cash offer</label><input id="budget" name="budget" type="number" min="1" max="100000" step="0.01" placeholder="Enter your fare" required><p class="hint">Coordinates are required until an address search provider is connected. Distances are straight-line estimates, not driving distances. All offers use your selected currency.</p><button class="primary wide">Find a driver →</button></form></section>`}
function route(r){return `<div class="route"><div><small>Pickup</small>${esc(r.pickup)}</div><div><small>Destination</small>${esc(r.destination)}</div></div>`}
function trip(r){const customer=state.user.role==='customer',mine=r.driver_id===state.user.id,active=!['completed','cancelled'].includes(r.status);return `<article class="card"><div class="ride-head"><span class="eyebrow">RIDE #${r.id}</span><span class="status">${esc(r.status.replaceAll('_',' '))}</span></div>${route(r)}<div class="metrics"><div><strong>${r.distance} km</strong><small>STRAIGHT-LINE TRIP</small></div><div><strong>${money(r.fare??r.budget,r.currency)}</strong><small>${r.fare?'AGREED CASH FARE':'CUSTOMER CASH OFFER'}</small></div>${r.pickup_distance!==null?`<div><strong>${r.pickup_distance} km</strong><small>TO PICKUP · DIRECT</small></div>`:''}</div>${r.driver?(customer?`<p><b>${esc(r.driver.name)}</b> · ${esc(r.driver.vehicle)} · ${esc(r.driver.plate)}</p>`:`<p>Customer: <b>${esc(r.customer_name)}</b></p>`):`<p>${customer?'Your request is available to online drivers. Choose an offer below.':`Requested by ${esc(r.customer_name)}. Review the route and send your fare.`}</p>`}${!customer?`<p class="hint">Pickup: ${r.plat}, ${r.plng} · Destination: ${r.dlat}, ${r.dlng}</p>`:''}${r.status==='requested'?(customer?`<h3>Driver offers ${r.offers.length?`(${r.offers.length})`:''}</h3>${r.offers.length?r.offers.map(o=>`<div class="offer"><div><b>${esc(o.name)}</b><small>${esc(o.vehicle)} · ${esc(o.plate)}</small><small>${o.eta} min · Driver estimate</small></div><div><b>${money(o.fare,r.currency)}</b><br><button class="small primary" data-accept="${r.id}" data-offer="${o.id}" data-version="${o.version}" ${o.available?'':'disabled'}>${o.available?'Accept':'Unavailable'}</button></div></div>`).join(''):'<p class="hint">Waiting for offers. This page updates automatically.</p>'}`:`<form data-offer-form="${r.id}"><div class="cols"><div><label>Cash fare<input aria-label="Cash fare" name="fare" type="number" min="1" max="100000" step=".01" value="${r.offers[0]?.fare??r.budget}" required></label></div><div><label>Arrival · minutes<input aria-label="Arrival minutes" name="eta" type="number" min="1" max="180" value="${r.offers[0]?.eta??5}" required></label></div></div><button class="wide primary">${r.offers.length?'Update offer':'Send offer'} →</button></form>`):''}${customer&&r.pickup_pin?`<section class="pickup-code"><span class="eyebrow">YOUR PICKUP CODE</span><strong data-pickup-code>${esc(r.pickup_pin)}</strong><p class="hint">Share this code with your driver only when you are together at pickup.</p></section>`:''}${mine&&active?`<div class="actions">${r.status==='accepted'?`<button class="primary" data-status="arrived" data-ride="${r.id}">I’ve arrived at pickup</button>`:r.status==='arrived'?`<form data-start="${r.id}"><label>Customer pickup code<input aria-label="Customer pickup code" name="pickup_pin" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="off" placeholder="6-digit code" required></label><button class="primary">Start trip</button></form>`:r.status==='in_progress'?`<form data-complete="${r.id}"><label class="check"><input type="checkbox" name="cash" required> I received ${money(r.fare,r.currency)} in cash</label><button class="primary">Complete trip</button></form>`:''}</div>`:''}${active&&(customer||mine)&&r.status!=='in_progress'?`<div class="actions"><button class="small danger" data-status="cancelled" data-ride="${r.id}">Cancel ride</button></div>`:''}${r.cash_confirmed?`<p class="pill">✓ Cash received · Trip completed</p><div class="actions"><button class="ghost small" data-receipt="${r.id}">Download cash receipt</button></div>`:''}${r.driver_id&&(customer||mine)?chat(r,active):''}${customer&&r.status==='completed'?(r.rating?`<p>Your rating: ${'★'.repeat(r.rating)}</p>`:`<form data-rating="${r.id}" class="actions"><select aria-label="Rate trip" name="stars"><option value="5">★★★★★ · Excellent</option><option value="4">★★★★ · Good</option><option value="3">★★★ · Okay</option><option value="2">★★ · Poor</option><option value="1">★ · Bad</option></select><button class="small">Rate trip</button></form>`):''}</article>`}
function chat(r,active){return `<div class="chat"><h3>Trip chat</h3><div class="messages" aria-live="polite">${r.messages.length?r.messages.map(m=>`<div class="bubble ${m.user_id===state.user.id?'mine':''}"><small>${esc(m.name)} · ${new Date(m.created*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</small>${esc(m.body)}</div>`).join(''):'<p class="hint">Send pickup instructions or a quick hello.</p>'}</div>${active?`<form data-chat="${r.id}"><input name="body" aria-label="Message" placeholder="Write a message…" maxlength="1000" required><button>Send</button></form>`:'<p class="hint">This trip chat is closed.</p>'}</div>`}
function render(){const focus=rememberFocus();const scrollY=window.scrollY;const u=state.user,customer=u.role==='customer';$('#account').innerHTML=`<span>${esc(u.name)}</span><button id="logout" class="ghost small">Sign out</button>`;$('#logout').onclick=async()=>{try{await api('logout',{});if(locationWatch!==null)navigator.geolocation.clearWatch(locationWatch);locationWatch=null;auth()}catch(e){toast(e.message,true)}};
 const active=state.rides.filter(r=>!['completed','cancelled'].includes(r.status)),history=state.rides.filter(r=>['completed','cancelled'].includes(r.status));const busy=!customer&&active.some(r=>r.driver_id===u.id);
 $('#app').innerHTML=`<div class="intro"><div><span class="eyebrow">${customer?'YOUR EVERYDAY, MADE EASIER':'THE ROAD IS YOURS'}</span><h1>${customer?'Let’s get you there.':'Ready for your next ride?'}</h1><p>${customer?'A fair fare. A friendly driver. Cash in hand.':'See the route. Set your fare. Choose your next trip.'}</p></div><span class="pill">● CASH RIDES ONLY</span></div><div class="workspace ${active.length?'has-trip':''}"><aside class="stack">${customer?(!active.length?rideForm():`<section class="card"><h2>You’re on your way.</h2><p>Track your ride status and chat with your driver here.</p><span class="pill">Pay the agreed fare in cash</span></section>`):`<section class="card"><span class="eyebrow">DRIVER WORKSPACE</span><h2>${busy?'You’re on a trip.':u.online?'You’re online.':'Take the wheel.'}</h2><p>${busy?'Finish your current trip to receive new requests.':u.online?'New customer requests appear in your inbox.':'Go online to receive customer requests and send offers.'}</p><button id="availability" class="${u.online?'ghost':'primary'} wide">${u.online?'Go offline':'Go online →'}</button><button id="share-location" class="ghost wide">◎ Share live location</button><p class="hint" id="location-state">${u.lat!==null?'Last location saved.':'Enable location to estimate distance to pickup.'} Location sharing needs browser permission and HTTPS outside localhost.</p><p class="hint">${esc(u.vehicle)} · ${esc(u.plate)}</p></section>`}<section class="map" aria-label="Illustrative route graphic"><span class="map-caption">THE CITY IS YOURS TO EXPLORE</span><i class="map-dot"></i><i class="map-dot end"></i><span class="map-note">Route illustration · live road maps not connected</span></section><section class="card"><h3>Cash. Clear. Simple.</h3><p class="hint">Agree on the fare before you leave. Pay your driver directly at the destination. No in-app payment charges.</p><p class="hint">For emergencies, contact local emergency services. Jawa Ride does not currently provide emergency dispatch.</p></section></aside><section class="stack"><div class="section-title"><h2>${customer?'Your current ride':'Ride inbox'}</h2><span class="pill">${active.length} ACTIVE</span></div>${active.length?active.map(trip).join(''):`<div class="card empty"><span class="icon">→</span><h2>${customer?'Your next journey awaits.':u.online?'Waiting for your next request.':'You’re offline.'}</h2><p>${customer?'Choose your locations and offer a fare to get started.':u.online?'Customer requests will appear here automatically.':'Go online when you’re ready to drive.'}</p></div>`}${history.length?`<div class="section-title"><h2>Past journeys</h2><span class="hint">Most recent 100 rides</span></div>${history.map(trip).join('')}`:''}</section></div>`;
 bind();restoreDrafts(focus);window.scrollTo({top:scrollY,behavior:'instant'});}
function formKey(form){
 if(!form||form.id==='auth-form')return null;
 return form.id||Array.from(form.attributes).filter(a=>a.name.startsWith('data-')).map(a=>`${a.name}:${a.value}`).join('|');
}
function rememberFocus(){
 const el=document.activeElement;
 if(!el?.form||!el.name)return null;
 return {form:formKey(el.form),name:el.name,start:el.selectionStart,end:el.selectionEnd};
}
function restoreDrafts(focus){
 const present=new Set();
 document.querySelectorAll('#app form').forEach(form=>{
  const key=formKey(form);present.add(key);
  for(const [name,value] of Object.entries(drafts.get(key)||{})){
   const input=form.elements.namedItem(name);if(!input)continue;
   if(input.type==='checkbox')input.checked=value;else input.value=value;
  }
  if(focus?.form===key){
   const el=form.elements.namedItem(focus.name);
   if(el){el.focus({preventScroll:true});if(typeof focus.start==='number'&&typeof el.setSelectionRange==='function')el.setSelectionRange(focus.start,focus.end);}
  }
 });
 for(const key of drafts.keys())if(!present.has(key))drafts.delete(key);
}
function saveDraft(event){
 const form=event.target.form,key=formKey(form);if(!key)return;
 const data={};for(const el of form.elements)if(el.name)data[el.name]=el.type==='checkbox'?el.checked:el.value;
 drafts.set(key,data);
}
$('#app').addEventListener('input',saveDraft);$('#app').addEventListener('change',saveDraft);
function busyButtons(busy){
 document.querySelectorAll('#app button, #app input, #app select, #app textarea').forEach(b=>{
  if(busy&&!b.disabled){b.dataset.pending='1';b.disabled=true;}
  else if(!busy&&b.dataset.pending){delete b.dataset.pending;b.disabled=false;}
 });
}
async function perform(path,data,message,form=null){
 if(mutating)return;
 mutating=true;busyButtons(true);
 try{
  await api(path,data);
  if(form){drafts.delete(formKey(form));form.reset();}
  lastRender='';await refresh(true);if(message)toast(message);
 }catch(e){
  if(e.status===409)await refresh(true);
  if(e.status===401)auth();
  toast(e.message,true);
 }finally{mutating=false;busyButtons(false);}
}
function stopLocation(){
 if(locationWatch!==null&&navigator.geolocation)navigator.geolocation.clearWatch(locationWatch);
 locationWatch=null;
}
function locationText(){
 const label=$('#location-state'),button=$('#share-location');
 if(label)label.textContent=locationWatch!==null?'Live location sharing is active while this page is open.':'Location sharing is stopped. Enable it to update distance to pickup.';
 if(button)button.textContent=locationWatch!==null?'Stop sharing location':'Share live location';
}
function toggleLocation(){
 if(!navigator.geolocation)return toast('Location unavailable.',true);
 if(locationWatch!==null){stopLocation();locationText();return toast('Live location sharing stopped.');}
 const epoch=sessionEpoch;
 locationWatch=navigator.geolocation.watchPosition(p=>{
  if(epoch!==sessionEpoch||locationWatch===null)return;
  api('location',{lat:p.coords.latitude,lng:p.coords.longitude}).catch(e=>{
   if(e.status===401){stopLocation();locationText();}toast(e.message,true);
  });
  locationText();
 },e=>{if(epoch!==sessionEpoch)return;stopLocation();locationText();toast(e.message,true);},{enableHighAccuracy:true,maximumAge:10000,timeout:15000});
 locationText();toast('Requesting live location permission…');
}
function gps(success){if(!navigator.geolocation)return toast('Geolocation is not supported by this browser.',true);navigator.geolocation.getCurrentPosition(success,e=>toast(e.message||'Location permission is required.',true),{enableHighAccuracy:true,timeout:15000,maximumAge:10000})}
async function downloadReceipt(id){
 try{
  const {receipt:r}=await api(`rides/${id}/receipt`);
  const content=['JAWA RIDE · CASH RECEIPT',r.number,`Completed: ${new Date(r.completed_at*1000).toISOString()}`,`Customer: ${r.customer}`,`Driver: ${r.driver}`,`Pickup: ${r.pickup}`,`Destination: ${r.destination}`,`Cash fare: ${money(r.amount,r.currency)}`,r.confirmation].join('\n');
  const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`${r.number}.txt`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(e){toast(e.message,true)}
}
function bind(){
 document.querySelectorAll('[data-receipt]').forEach(b=>b.onclick=()=>downloadReceipt(b.dataset.receipt));
 document.querySelectorAll('[data-start]').forEach(f=>f.onsubmit=e=>{e.preventDefault();perform(`rides/${f.dataset.start}/status`,{status:'in_progress',pickup_pin:values(f).pickup_pin},'Pickup confirmed. Trip started.',f)});
if($('#ride-form'))$('#ride-form').onsubmit=e=>{e.preventDefault();perform('rides',values(e.target),'Ride request sent to online drivers.',e.target)};if($('#pickup-gps'))$('#pickup-gps').onclick=()=>gps(p=>{if(!$('#plat')||!$('#plng'))return;$('#plat').value=p.coords.latitude;$('#plng').value=p.coords.longitude;saveDraft({target:$('#plng')});toast('Pickup coordinates updated. Add your street or landmark.')});if($('#availability'))$('#availability').onclick=()=>perform('availability',{online:!state.user.online});if($('#share-location'))$('#share-location').onclick=toggleLocation;locationText();
 document.querySelectorAll('[data-offer-form]').forEach(f=>f.onsubmit=e=>{e.preventDefault();perform(`rides/${f.dataset.offerForm}/offer`,values(f),'Offer sent.',f)});document.querySelectorAll('[data-accept]').forEach(b=>b.onclick=()=>perform(`rides/${b.dataset.accept}/accept`,{offer_id:Number(b.dataset.offer),offer_version:Number(b.dataset.version)},'Driver booked. Your cash fare is agreed.'));
 document.querySelectorAll('[data-status]').forEach(b=>b.onclick=()=>{if(b.dataset.status==='cancelled'&&!confirm('Cancel this ride?'))return;perform(`rides/${b.dataset.ride}/status`,{status:b.dataset.status})});document.querySelectorAll('[data-complete]').forEach(f=>f.onsubmit=e=>{e.preventDefault();perform(`rides/${f.dataset.complete}/status`,{status:'completed',cash_received:f.elements.cash.checked},'Trip completed. Cash payment recorded.',f)});document.querySelectorAll('[data-chat]').forEach(f=>f.onsubmit=e=>{e.preventDefault();perform(`rides/${f.dataset.chat}/chat`,values(f),null,f)});document.querySelectorAll('[data-rating]').forEach(f=>f.onsubmit=e=>{e.preventDefault();perform(`rides/${f.dataset.rating}/rate`,values(f),'Thanks for your feedback.',f)});busyButtons(mutating);}
async function refresh(force=false){
 while(refreshTask){await refreshTask;if(!force)return;}
 const epoch=sessionEpoch;
 const task=(async()=>{
  try{
   const next=await api('state');if(epoch!==sessionEpoch)return;
   const fingerprint=JSON.stringify(next);state=next;
   if(force||fingerprint!==lastRender){render();lastRender=fingerprint;}
  }catch(e){
   if(epoch!==sessionEpoch)return;
   if(e.status===401){if(state||!$('#auth-form'))auth();}
   else if(force)toast(e.message,true);
  }
 })();
 refreshTask=task;
 try{await task;}finally{if(refreshTask===task)refreshTask=null;}
}
api('config').then(config=>{currencies=config.currencies}).catch(()=>{}).finally(()=>refresh(true));setInterval(()=>{if(state)refresh()},3000);
