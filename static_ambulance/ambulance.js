const $=id=>document.getElementById(id);let currentFrame=0;let autoTimer=null;let routeData=null;
function fmt(s){s=Number(s||0);if(s<60)return `${Math.round(s)}s`;return `${Math.floor(s/60)}m ${Math.round(s%60)}s`}
function msg(text,ok=false){$('form-message').textContent=text;$('form-message').style.color=ok?'#19d38a':'#ff9bd1'}
async function api(url,opts={}){const isForm=opts.body instanceof FormData;const headers={...(isForm?{}:{'Content-Type':'application/json'}),...(opts.headers||{})};const r=await fetch(url,{...opts,headers,cache:'no-store'});let d={};try{d=await r.json()}catch(_e){throw new Error('Server returned an invalid response. Check Render logs.')}if(!r.ok||d.status==='error')throw new Error(d.message||'Request failed');return d}
async function refreshTraffic(){try{const d=await api(`/api/traffic?frame=${currentFrame}`);$('db-status').textContent='LIVE';renderTraffic(d)}catch(e){$('db-status').textContent='ERROR';console.error(e)}}
function renderTraffic(d){currentFrame=Number(d.frame_index||0);$('traffic-grid').innerHTML=[1,2,3,4].map(j=>{const v=d.junctions[j]||d.junctions[String(j)];return `<div class="traffic-card"><h4>J${j}</h4><div class="metric-line"><span>DB record</span><b>#${v.source_id}</b></div><div class="metric-line"><span>Vehicles</span><b>${v.vehicle_count}</b></div><div class="metric-line"><span>Speed</span><b>${Number(v.average_speed).toFixed(1)} km/h</b></div><div class="metric-line"><span>Occupancy</span><b>${Number(v.lane_occupancy).toFixed(1)}%</b></div><div class="metric-line"><span>Waiting</span><b>${Number(v.waiting_time).toFixed(1)}s</b></div><div class="metric-line"><span>Congestion</span><b>${Number(v.congestion).toFixed(1)}%</b></div></div>`}).join('')}
async function plan(){try{const d=await api('/api/plan',{method:'POST',body:JSON.stringify({current_junction:Number($('current-junction').value),destination:Number($('destination').value),frame:currentFrame})});routeData=d;$('route-empty').classList.add('hidden');$('route-result').classList.remove('hidden');$('route-text').textContent=d.route.map(x=>`J${x}`).join(' → ');$('route-time').textContent=fmt(d.estimated_time_seconds);$('route-frame').textContent=`${d.frame_index+1}`;$('route-segments').innerHTML=d.segments.map(s=>`<div class="segment"><strong>J${s.from} → J${s.to}</strong><span>${s.direction} • ${Number(s.congestion_at_destination).toFixed(0)}% congestion</span><b>${fmt(s.seconds)}</b></div>`).join('');msg('A* route calculated from the current database frame.',true)}catch(e){msg(e.message)}}
let challengeToken=null,challengeCode=null,cameraStream=null,capturedBlob=null,capturedAt=null,phoneLocation=null;
function setCameraNote(text,isError=false){$('camera-note').textContent=text;$('camera-note').style.color=isError?'#ff8da8':'#91a6c8'}
function stopCamera(){if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}const v=$('verification-video');if(v)v.srcObject=null}
function openVerificationModal(){
  if(Number($('current-junction').value)===Number($('destination').value)){msg('Current junction and destination must be different.');return}
  startVerificationFlow();
}
async function startVerificationFlow(){
  const modal=$('verification-modal');modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');
  $('capture-preview').classList.add('hidden');$('verification-video').classList.remove('hidden');$('capture-photo-btn').disabled=true;$('submit-evidence-btn').disabled=true;$('retake-photo-btn').classList.add('hidden');capturedBlob=null;capturedAt=null;phoneLocation=null;
  $('challenge-code').textContent='Requesting…';setCameraNote('Requesting a one-time challenge from the server…');
  try{const d=await api('/api/verification/challenge',{method:'POST',body:JSON.stringify({ambulance_id:$('ambulance-id').value.trim()})});challengeToken=d.challenge_token;challengeCode=d.code;$('challenge-code').textContent=d.code;setCameraNote(`Challenge ready. Capture a fresh photo within ${d.expires_in_seconds} seconds.`)}catch(e){setCameraNote(e.message,true);msg(`Verification could not start: ${e.message}`)}
}
async function startCamera(){
  try{
    if(!challengeToken)throw new Error('A verification challenge has not been issued. Close this window and click Activate Corridor again.');
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access is not available in this browser. Open this site over HTTPS on a supported phone/browser.');
    stopCamera();cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
    const v=$('verification-video');v.srcObject=cameraStream;await v.play();$('capture-photo-btn').disabled=false;setCameraNote('Camera is on. Frame the ambulance patient compartment / relevant evidence, avoid unnecessary patient-identifying details, then capture.');
  }catch(e){setCameraNote(e.message||'Could not start camera. Allow camera permission and try again.',true)}
}
function getOptionalLocation(){return new Promise(resolve=>{if(!navigator.geolocation){phoneLocation=null;return resolve()}navigator.geolocation.getCurrentPosition(pos=>{phoneLocation={latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracy:pos.coords.accuracy};$('location-note').textContent=`Phone location captured (accuracy about ${Math.round(pos.coords.accuracy)} m).`;resolve()},()=>{phoneLocation=null;$('location-note').textContent='Phone location not shared; photo is still required.'},{enableHighAccuracy:true,timeout:8000,maximumAge:0})})}
async function capturePhoto(){
  try{
    const v=$('verification-video');if(!cameraStream||!v.videoWidth)throw new Error('Start the camera and wait for the preview before capturing.');
    const canvas=$('verification-canvas');const scale=Math.min(1,1280/v.videoWidth);canvas.width=Math.round(v.videoWidth*scale);canvas.height=Math.round(v.videoHeight*scale);const ctx=canvas.getContext('2d');ctx.drawImage(v,0,0,canvas.width,canvas.height);
    const stamp=new Date();capturedAt=stamp.toISOString();const label=`LIVE CAPTURE • ${challengeCode} • ${stamp.toLocaleString()}`;const h=Math.max(48,Math.round(canvas.height*.09));ctx.fillStyle='rgba(5,12,28,.78)';ctx.fillRect(0,canvas.height-h,canvas.width,h);ctx.fillStyle='#ffffff';ctx.font=`bold ${Math.max(17,Math.round(h*.30))}px Arial`;ctx.fillText(label,Math.round(canvas.width*.025),canvas.height-Math.round(h*.40));
    capturedBlob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not encode the photo. Try again.')),'image/jpeg',.82));
    $('capture-preview').src=URL.createObjectURL(capturedBlob);$('capture-preview').classList.remove('hidden');v.classList.add('hidden');$('retake-photo-btn').classList.remove('hidden');$('submit-evidence-btn').disabled=false;setCameraNote(`Photo captured (${(capturedBlob.size/1024).toFixed(0)} KB). The challenge code and capture time are watermarked on the image.`);
    await getOptionalLocation();
  }catch(e){setCameraNote(e.message,true)}
}
async function submitEvidenceAndActivate(){
  const submit=$('submit-evidence-btn');submit.disabled=true;submit.textContent='Submitting evidence…';
  try{
    if(!capturedBlob||!challengeToken||!capturedAt)throw new Error('A fresh camera photo is required before activation.');
    if(!$('privacy-ack').checked)throw new Error('Please confirm you are authorized to submit this photo and will avoid unnecessary patient-identifying details.');
    const fd=new FormData();fd.append('ambulance_id',$('ambulance-id').value.trim());fd.append('current_junction',$('current-junction').value);fd.append('destination',$('destination').value);fd.append('emergency_level',$('level').value);fd.append('frame',String(currentFrame));fd.append('challenge_token',challengeToken);fd.append('challenge_code',challengeCode);fd.append('captured_at',capturedAt);fd.append('privacy_ack','yes');fd.append('photo',capturedBlob,'emergency-evidence.jpg');if(phoneLocation){fd.append('latitude',String(phoneLocation.latitude));fd.append('longitude',String(phoneLocation.longitude));fd.append('location_accuracy',String(phoneLocation.accuracy))}
    const d=await api('/api/activate',{method:'POST',body:fd});routeData=d;closeVerificationModal();msg('Evidence submitted. Waiting for the main Traffic Control Center to review the photo and approve the corridor. No green corridor is active yet.',true);$('trip-badge').textContent='PENDING REVIEW';$('trip-badge').style.borderColor='#f0b429';await refreshStatus();
  }catch(e){setCameraNote(e.message,true);msg(`Activation blocked: ${e.message}`);submit.disabled=false}
  finally{submit.innerHTML='<i class="fa-solid fa-shield-check"></i> Submit Evidence & Request Review'}
}
function closeVerificationModal(){stopCamera();const m=$('verification-modal');m.classList.add('hidden');m.setAttribute('aria-hidden','true')}

async function refreshStatus(){try{const id=encodeURIComponent($('ambulance-id').value.trim());const d=await api(`/api/status?frame=${currentFrame}&ambulance_id=${id}`);renderTrip(d.emergency)}catch(e){console.error(e)}}
function renderTrip(e){
  if(!e){$('trip-empty').classList.remove('hidden');$('trip-active').classList.add('hidden');$('trip-badge').textContent='READY';return}
  const status=String(e.request_status||e.status||'');
  if(!e.active && !['PENDING_REVIEW','REJECTED','CLEARED'].includes(status)){$('trip-empty').classList.remove('hidden');$('trip-active').classList.add('hidden');$('trip-badge').textContent='READY';return}
  $('trip-empty').classList.add('hidden');$('trip-active').classList.remove('hidden');
  $('trip-ambulance').textContent=e.ambulance_id||$('ambulance-id').value.trim();
  $('trip-current').textContent=e.current_junction?`J${e.current_junction}`:'—';
  $('trip-next').textContent=e.next_junction?`J${e.next_junction}`:(status==='PENDING_REVIEW'?'Waiting for approval':'—');
  $('trip-destination').textContent=e.destination?`J${e.destination}`:'—';
  $('trip-eta').textContent=e.active?fmt(e.estimated_time_seconds):'Pending review';
  const visibleStatus=status==='PENDING_REVIEW'?'PENDING REVIEW':status;
  $('trip-status').textContent=visibleStatus;
  $('trip-badge').textContent=visibleStatus;
  $('trip-badge').style.borderColor=status==='PENDING_REVIEW'?'#f0b429':(e.active?'#ff3ea5':'#d9534f');
  const idx=Number(e.route_index||0), route=Array.isArray(e.route)?e.route:[];
  const pct=e.active?((idx+Number(e.segment_progress||0))/Math.max(1,route.length-1))*100:0;
  $('trip-progress-text').textContent=Math.round(Math.min(100,pct))+'%';$('trip-progress-fill').style.width=`${Math.min(100,pct)}%`;
  $('trip-timeline').innerHTML=route.map((j,i)=>`${i>0?'<div class="tl-line"></div>':''}<div class="tl-node ${i<idx?'done':''} ${i===idx?'active':''}"><div class="tl-circle">J${j}</div></div>`).join('');
  $('advance-btn').disabled=!e.active;$('auto-btn').disabled=!e.active;
  if(status==='PENDING_REVIEW') msg('Request is waiting for review in the main Traffic Control Center.');
  if(status==='REJECTED') msg('The Traffic Control Center rejected this request. Normal traffic control remains active.');
}
async function advance(){try{const d=await api('/api/advance',{method:'POST',body:JSON.stringify({frame:currentFrame})});renderTrip(d.emergency);if(d.emergency.status==='AT DESTINATION')stopAuto()}catch(e){msg(e.message)}}
function stopAuto(){if(autoTimer){clearInterval(autoTimer);autoTimer=null}$('auto-btn').innerHTML='<i class="fa-solid fa-play"></i> Auto Dispatch'}
function startAuto(){stopAuto();$('auto-btn').innerHTML='<i class="fa-solid fa-pause"></i> Pause Auto';autoTimer=setInterval(async()=>{try{const d=await api(`/api/status?frame=${currentFrame}`);if(!d.emergency?.active){stopAuto();return}const p=Number(d.emergency.segment_progress||0);if(p>=.985)await advance();else refreshStatus()}catch(e){console.error(e)}},1000)}
$('plan-btn').onclick=plan;$('activate-btn').onclick=openVerificationModal;$('start-camera-btn').onclick=startCamera;$('capture-photo-btn').onclick=capturePhoto;$('retake-photo-btn').onclick=()=>{capturedBlob=null;capturedAt=null;$('capture-preview').classList.add('hidden');$('verification-video').classList.remove('hidden');$('submit-evidence-btn').disabled=true;$('capture-photo-btn').disabled=!cameraStream;setCameraNote('Retake a fresh photo using the camera.')};$('submit-evidence-btn').onclick=submitEvidenceAndActivate;$('close-verification-btn').onclick=closeVerificationModal;$('cancel-verification-btn').onclick=closeVerificationModal;$('advance-btn').onclick=advance;$('auto-btn').onclick=()=>autoTimer?stopAuto():startAuto();$('clear-btn').onclick=async()=>{try{await api('/api/clear',{method:'POST'});stopAuto();await refreshStatus();msg('Emergency cleared.',true)}catch(e){msg(e.message)}};setInterval(()=>{currentFrame++;refreshTraffic();refreshStatus()},2500);refreshTraffic();refreshStatus();
