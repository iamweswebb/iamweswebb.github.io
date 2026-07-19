(()=>{
const PAD_COUNT=6;
const COLORS=['--s0','--s1','--s2','--s3','--s4','--s5'];
const $=id=>document.getElementById(id);
const css=v=>getComputedStyle(document.body).getPropertyValue(v).trim();

// ===== state =====
let ctx=null,playing=false,loopLen=12,transportStart=0,boundaryTimer=null;
const state={layers:Array.from({length:PAD_COUNT},(_,i)=>({index:i,buffer:null,gainNode:null,panNode:null,gain:0.9,pan:0,pitch:0,mute:false,filename:'',hasMarker:false,startOffset:0,currentSrc:null})),
delayRatio:1/3,delayMix:0.25,delayFb:0.45,reverbMix:0.45,reverbSize:4,reverbBloom:0.4,hicut:12000};
let dryBus,delayNode,delayFeedbackGain,delayFilter,wetDelayGain,convolver,wetVerbGain,hicutFilter,shimmerLFO,shimmerDepth;

// ===== audio =====
function ensureContext(){
  if(ctx)return;
  const C=window.AudioContext||window.webkitAudioContext;if(!C)return;
  ctx=new C();
  dryBus=ctx.createGain();
  hicutFilter=ctx.createBiquadFilter();hicutFilter.type='lowpass';hicutFilter.frequency.value=state.hicut;hicutFilter.Q.value=0.707;
  const out=ctx.createGain();
  dryBus.connect(hicutFilter);hicutFilter.connect(out);out.connect(ctx.destination);
  // delay: filtered feedback loop so repeats darken like tape
  delayNode=ctx.createDelay(179);
  delayFilter=ctx.createBiquadFilter();delayFilter.type='lowpass';delayFilter.frequency.value=5200;
  delayFeedbackGain=ctx.createGain();delayFeedbackGain.gain.value=state.delayFb;
  wetDelayGain=ctx.createGain();wetDelayGain.gain.value=state.delayMix;
  hicutFilter.connect(delayNode);delayNode.connect(delayFilter);delayFilter.connect(delayFeedbackGain);delayFeedbackGain.connect(delayNode);
  delayNode.connect(wetDelayGain);wetDelayGain.connect(out);
  // reverb: long lush IR + slow pitch-drift on the tail (supermassive-ish bloom)
  convolver=ctx.createConvolver();convolver.buffer=makeIR();
  wetVerbGain=ctx.createGain();wetVerbGain.gain.value=state.reverbMix;
  const verbDelay=ctx.createDelay(1);verbDelay.delayTime.value=0.02;
  shimmerLFO=ctx.createOscillator();shimmerLFO.frequency.value=0.13;
  shimmerDepth=ctx.createGain();shimmerDepth.gain.value=state.reverbBloom*0.006;
  shimmerLFO.connect(shimmerDepth);shimmerDepth.connect(verbDelay.delayTime);shimmerLFO.start();
  hicutFilter.connect(convolver);convolver.connect(verbDelay);verbDelay.connect(wetVerbGain);wetVerbGain.connect(out);
  // feed a bit of reverb back into the delay for wash
  wetVerbGain.connect(delayNode);
  recalcDelay();startRAF();
}
function makeIR(){
  const rate=ctx.sampleRate,secs=state.reverbSize,len=Math.max(1,Math.floor(rate*secs));
  const b=ctx.createBuffer(2,len,rate);
  for(let ch=0;ch<2;ch++){const d=b.getChannelData(ch);
    for(let i=0;i<len;i++){const t=i/len;
      // slow bloom attack then long decay — the "supermassive" swell
      const attack=Math.min(1,t/(0.04+state.reverbBloom*0.25));
      d[i]=(Math.random()*2-1)*attack*Math.pow(1-t,1.6+ (1-state.reverbBloom))*0.6;}}
  return b;
}
function getPhase(){if(!ctx)return 0;const t=ctx.currentTime-transportStart;return((t%loopLen)+loopLen)%loopLen;}
function clearLayer(l){try{if(l.currentSrc){l.currentSrc.stop();l.currentSrc.disconnect();}}catch(e){}l.currentSrc=null;}
function wireLayer(l){
  if(!l.gainNode){l.gainNode=ctx.createGain();l.gainNode.gain.value=l.gain;}
  if(ctx.createStereoPanner&&!l.panNode){l.panNode=ctx.createStereoPanner();l.panNode.pan.value=l.pan;}
  try{l.gainNode.disconnect();}catch(e){}
  try{if(l.panNode)l.panNode.disconnect();}catch(e){}
  if(l.panNode){l.gainNode.connect(l.panNode);l.panNode.connect(dryBus);}else{l.gainNode.connect(dryBus);}
}
function rateOf(l){return Math.pow(2,l.pitch/12);}
function durOf(l){return l.buffer?l.buffer.duration/rateOf(l):0;}
function scheduleCycle(idx){
  if(!ctx)return;
  const cycleStart=transportStart+idx*loopLen,now=ctx.currentTime;
  state.layers.forEach(l=>{
    if(!l.buffer||l.mute||!l.hasMarker)return;
    const offset=Math.max(0,Math.min(loopLen,l.startOffset)),startAt=cycleStart+offset;
    if(startAt<cycleStart||startAt>=cycleStart+loopLen)return;
    wireLayer(l);
    const src=ctx.createBufferSource();src.buffer=l.buffer;src.playbackRate.value=rateOf(l);src.connect(l.gainNode);
    const dur=durOf(l);
    if(startAt>now+0.005){try{src.start(startAt,0);src.stop(startAt+dur);}catch(e){}}
    else{const late=now-startAt;if(late<dur-0.002){try{src.start(now,Math.min(dur-0.001,late));src.stop(now+dur-late);}catch(e){}}else return;}
    l.currentSrc=src;
  });
}
function scheduleLoop(){
  if(boundaryTimer)clearTimeout(boundaryTimer);
  if(!ctx)return;
  const now=ctx.currentTime,idx=Math.floor((now-transportStart)/loopLen);
  scheduleCycle(idx);
  const next=transportStart+(idx+1)*loopLen;
  boundaryTimer=setTimeout(()=>{if(!playing)return;scheduleCycle(idx+1);scheduleLoop();},Math.max(10,(next-now)*1000-4));
}
function rescheduleAll(){state.layers.forEach(clearLayer);if(playing)scheduleLoop();}

// ===== geometry =====
const svg=$('loopSvg'),markersG=$('markers'),arcsG=$('arcs'),ripplesG=$('ripples');
const R=192,CX=250,CY=250;
function polar(rad,r=R){return{x:CX+Math.cos(rad)*r,y:CY+Math.sin(rad)*r};}
function offsetToAngle(off){return(off/loopLen)*Math.PI*2-Math.PI/2;}
function angleToOffset(rad){let a=rad+Math.PI/2;a=((a%(Math.PI*2))+Math.PI*2)%(Math.PI*2);return(a/(Math.PI*2))*loopLen;}
function clientToAngle(x,y){const rect=svg.getBoundingClientRect();const ux=x-(rect.left+CX*(rect.width/500));const uy=y-(rect.top+CY*(rect.height/500));return Math.atan2(uy,ux);}
// ticks: quarter-second minors, 1s mids, 5s majors — re-rendered when loop length changes
function renderTicks(){
  const g=$('ticks');g.innerHTML='';
  const total=Math.round(loopLen*4);
  for(let i=0;i<total;i++){const t=i/4;const a=(t/loopLen)*Math.PI*2-Math.PI/2;
    const major=t%5===0,mid=!major&&t%1===0;
    const p1=polar(a,R+7),p2=polar(a,R+(major?19:mid?14:10));
    const l=document.createElementNS('http://www.w3.org/2000/svg','line');
    l.setAttribute('class','tick'+(major?' major':mid?' mid':''));
    l.setAttribute('x1',p1.x);l.setAttribute('y1',p1.y);l.setAttribute('x2',p2.x);l.setAttribute('y2',p2.y);g.appendChild(l);}
}
renderTicks();

// ===== markers & arcs =====
let selected=null;
function colorOf(i){return css(COLORS[i]);}
function arcPath(a0,a1,r=R){
  if(a1-a0>=Math.PI*2-0.01)a1=a0+Math.PI*2-0.01;
  const p0=polar(a0,r),p1=polar(a1,r),large=(a1-a0)%(Math.PI*2)>Math.PI?1:0;
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`;
}
function updateArc(i){
  const l=state.layers[i];let el=arcsG.querySelector(`[data-arc="${i}"]`);
  if(!l.hasMarker||!l.buffer){if(el)el.remove();return;}
  if(!el){el=document.createElementNS('http://www.w3.org/2000/svg','path');el.setAttribute('data-arc',i);el.setAttribute('class','arc');arcsG.appendChild(el);}
  const a0=offsetToAngle(l.startOffset),span=Math.min(1,durOf(l)/loopLen)*Math.PI*2;
  el.setAttribute('d',arcPath(a0,a0+span));el.setAttribute('stroke',colorOf(i));
}
function updateAllArcs(){for(let i=0;i<PAD_COUNT;i++)updateArc(i);}
function ripple(i){
  const l=state.layers[i];if(!l.hasMarker)return;
  const p=polar(offsetToAngle(l.startOffset));
  const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
  c.setAttribute('class','ripple');c.setAttribute('cx',p.x);c.setAttribute('cy',p.y);c.setAttribute('r',12);c.setAttribute('stroke',colorOf(i));
  c.animate([{opacity:0.9,r:12},{opacity:0,r:44}],{duration:900,easing:'ease-out'});
  ripplesG.appendChild(c);setTimeout(()=>c.remove(),950);
}
function createOrMoveMarker(i,rad){
  const l=state.layers[i];l.hasMarker=true;l.startOffset=angleToOffset(rad);
  document.body.classList.add('has-markers');
  const p=polar(rad);let el=markersG.querySelector(`[data-pad="${i}"]`);
  if(!el){
    el=document.createElementNS('http://www.w3.org/2000/svg','g');el.setAttribute('class','marker');el.setAttribute('data-pad',i);
    const hit=document.createElementNS('http://www.w3.org/2000/svg','circle');hit.setAttribute('class','hit');hit.setAttribute('r',26);
    const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('class','dot');dot.setAttribute('r',13);dot.setAttribute('stroke',colorOf(i));
    const t=document.createElementNS('http://www.w3.org/2000/svg','text');t.textContent=i+1;t.setAttribute('fill',colorOf(i));
    el.appendChild(hit);el.appendChild(dot);el.appendChild(t);markersG.appendChild(el);
    let dragging=false,moved=false;
    el.addEventListener('pointerdown',e=>{dragging=true;moved=false;el.setPointerCapture(e.pointerId);e.stopPropagation();});
    el.addEventListener('pointermove',e=>{if(!dragging)return;moved=true;createOrMoveMarker(i,clientToAngle(e.clientX,e.clientY));if(playing)rescheduleAll();});
    el.addEventListener('pointerup',e=>{dragging=false;if(!moved)toggleSelect(i,el);});
  }
  el.setAttribute('transform',`translate(${p.x},${p.y})`);
  updateArc(i);highlightPad(i,true,600);
}
function removeMarker(i){
  const l=state.layers[i];l.hasMarker=false;l.startOffset=0;
  const el=markersG.querySelector(`[data-pad="${i}"]`);if(el)el.remove();
  updateArc(i);deselect();
  if(!state.layers.some(x=>x.hasMarker))document.body.classList.remove('has-markers');
  if(playing)rescheduleAll();
}
function toggleSelect(i,el){
  if(selected&&selected.i===i){removeMarker(i);return;}// second tap deletes
  deselect();selected={i,el};el.classList.add('sel');highlightPad(i,true,1200);
  setTimeout(()=>{if(selected&&selected.i===i)deselect();},1400);
}
function deselect(){if(selected){selected.el.classList.remove('sel');selected=null;}}
svg.addEventListener('pointerdown',e=>{if(!e.target.closest('.marker'))ensureContext();});

// ===== playhead + trigger flashes =====
const playhead=$('playhead');
let lastPhase=0,raf=null;
function startRAF(){
  const tick=()=>{
    if(playing){
      const ph=getPhase(),rad=offsetToAngle(ph);
      const p1=polar(rad,R+7),p2=polar(rad,R+19);
      playhead.setAttribute('x1',p1.x);playhead.setAttribute('y1',p1.y);
      playhead.setAttribute('x2',p2.x);playhead.setAttribute('y2',p2.y);
      playhead.setAttribute('visibility','visible');
      state.layers.forEach(l=>{
        if(!l.hasMarker||!l.buffer||l.mute)return;
        const crossed=lastPhase<=l.startOffset&&ph>l.startOffset||(lastPhase>ph&&(l.startOffset>lastPhase||l.startOffset<=ph));
        if(crossed)ripple(l.index);
        // arc live while sample audible
        const el=arcsG.querySelector(`[data-arc="${l.index}"]`);
        if(el){const end=l.startOffset+durOf(l);
          const active=ph>=l.startOffset&&ph<end||(end>loopLen&&ph<end-loopLen);
          el.classList.toggle('live',active);}
      });
      lastPhase=ph;
    }else{playhead.setAttribute('visibility','hidden');
      arcsG.querySelectorAll('.arc').forEach(a=>a.classList.remove('live'));}
    raf=requestAnimationFrame(tick);
  };
  if(raf)cancelAnimationFrame(raf);raf=requestAnimationFrame(tick);
}

// ===== transport =====
const playToggle=$('playToggle'),iconPlay=$('iconPlay'),iconPause=$('iconPause');
playToggle.addEventListener('click',async()=>{
  ensureContext();if(ctx.state==='suspended')await ctx.resume();
  playing=!playing;
  iconPlay.style.display=playing?'none':'block';iconPause.style.display=playing?'block':'none';
  document.body.classList.toggle('playing',playing);
  if(playing){transportStart=ctx.currentTime;lastPhase=0;scheduleLoop();}
  else{if(boundaryTimer)clearTimeout(boundaryTimer);state.layers.forEach(clearLayer);}
});
// loop length
const timeBadge=$('timeBadge');
function formatLen(s){const m=Math.floor(s/60),ss=Math.floor(s%60),c=Math.floor(s*100%100);return`${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}:${String(c).padStart(2,'0')}`;}
timeBadge.value=formatLen(loopLen);
function setLoopLen(v,reschedule=true){
  loopLen=Math.min(60,Math.max(2,v));
  timeBadge.value=formatLen(loopLen);
  renderTicks();recalcDelay();updateAllArcs();
  state.layers.forEach(l=>{if(l.hasMarker){l.startOffset=Math.min(l.startOffset,loopLen-0.01);createOrMoveMarker(l.index,offsetToAngle(l.startOffset));}});
  if(reschedule&&playing){state.layers.forEach(clearLayer);scheduleLoop();}
}
// wind the ring like a tape reel to stretch/shrink the loop
const ringHit=$('ringHit');
let windLast=null,windLen=0;
ringHit.addEventListener('pointerdown',e=>{
  ensureContext();windLast=clientToAngle(e.clientX,e.clientY);windLen=loopLen;
  document.body.classList.add('winding');ringHit.setPointerCapture(e.pointerId);e.stopPropagation();
});
ringHit.addEventListener('pointermove',e=>{
  if(windLast===null)return;
  const a=clientToAngle(e.clientX,e.clientY);
  let d=a-windLast;
  if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;
  windLast=a;
  windLen=Math.min(60,Math.max(2,windLen+d/(Math.PI*2)*windLen));
  setLoopLen(windLen,false);
});
function endWind(){if(windLast===null)return;windLast=null;document.body.classList.remove('winding');if(playing){state.layers.forEach(clearLayer);scheduleLoop();}}
ringHit.addEventListener('pointerup',endWind);
ringHit.addEventListener('pointercancel',endWind);
timeBadge.addEventListener('keydown',e=>{if(e.key==='Enter')timeBadge.blur();});
timeBadge.addEventListener('blur',()=>{
  const m=timeBadge.value.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if(m)setLoopLen(+m[1]*60+ +m[2]+ +m[3]/100);
  else timeBadge.value=formatLen(loopLen);
});

// ===== pads =====
const padsEl=$('pads');
function fmtDur(s){return s<10?s.toFixed(1)+'s':Math.round(s)+'s';}
for(let i=0;i<PAD_COUNT;i++){
  const div=document.createElement('div');div.className='pad';div.id='pad'+i;div.style.setProperty('--sc',`var(${COLORS[i]})`);
  div.innerHTML=`<div class="pad-id"><span class="pad-swatch"></span><div><div class="pad-name empty" id="fn${i}">LOAD SOUND</div><div class="pad-dur" id="dur${i}"></div></div></div>
  <div class="pad-ctrls"><span class="slab">VOL</span><input id="gain${i}" type="range" min="0" max="1.5" step="0.01" value="0.9"><span class="slab">PAN</span><input id="pan${i}" type="range" min="-1" max="1" step="0.01" value="0"><span class="slab" id="pitl${i}">PIT 0</span><input id="pitch${i}" type="range" min="-12" max="12" step="1" value="0"></div>
  <button class="mute-btn" id="mute${i}">MUTE</button>
  <input id="file${i}" type="file" accept="audio/*" style="display:none">`;
  padsEl.appendChild(div);
  const file=$('file'+i);
  $('fn'+i).addEventListener('click',()=>{ensureContext();file.click();});
  file.addEventListener('change',e=>{if(e.target.files&&e.target.files[0])loadFile(i,e.target.files[0]);});
  $('mute'+i).addEventListener('click',()=>{const l=state.layers[i];l.mute=!l.mute;$('mute'+i).classList.toggle('muted',l.mute);$('mute'+i).textContent=l.mute?'MUTED':'MUTE';if(playing)rescheduleAll();});
  $('gain'+i).addEventListener('input',e=>{const l=state.layers[i];l.gain=+e.target.value;if(l.gainNode)l.gainNode.gain.value=l.gain;});
  $('pan'+i).addEventListener('input',e=>{const l=state.layers[i];l.pan=+e.target.value;if(l.panNode)l.panNode.pan.value=l.pan;});
  $('pitch'+i).addEventListener('input',e=>{const l=state.layers[i];l.pitch=+e.target.value;
    $('pitl'+i).textContent='PIT '+(l.pitch>0?'+':'')+l.pitch;
    if(l.currentSrc)try{l.currentSrc.playbackRate.value=rateOf(l);}catch(_){}
    if(l.buffer){$('dur'+i).textContent=fmtDur(durOf(l));updateArc(i);}});
  div.addEventListener('pointerenter',()=>{const el=markersG.querySelector(`[data-pad="${i}"]`);if(el)el.querySelector('.dot').setAttribute('r',17);});
  div.addEventListener('pointerleave',()=>{const el=markersG.querySelector(`[data-pad="${i}"]`);if(el)el.querySelector('.dot').setAttribute('r',13);});
}
function highlightPad(i,on,ms){const p=$('pad'+i);if(!p)return;p.classList.toggle('hl',on);if(on&&ms)setTimeout(()=>p.classList.remove('hl'),ms);}
async function loadFile(i,f){
  ensureContext();
  const arr=await f.arrayBuffer();let buf;
  try{buf=await ctx.decodeAudioData(arr);}catch(e){alert('Could not decode '+f.name);return;}
  const l=state.layers[i];l.buffer=buf;l.filename=f.name;
  const fn=$('fn'+i);fn.textContent=f.name.replace(/\.[^.]+$/,'').toUpperCase();fn.classList.remove('empty');
  $('dur'+i).textContent=fmtDur(durOf(l));
  $('pad'+i).classList.add('loaded');
  wireLayer(l);
  // auto-place a marker if none yet: even spacing
  if(!l.hasMarker){const used=state.layers.filter(x=>x.hasMarker).length;createOrMoveMarker(i,offsetToAngle((used*loopLen/PAD_COUNT)%loopLen));}
  if(playing)rescheduleAll();
}
// drag & drop anywhere
let dragDepth=0;
window.addEventListener('dragenter',e=>{e.preventDefault();dragDepth++;document.body.classList.add('dragover');});
window.addEventListener('dragleave',e=>{e.preventDefault();if(--dragDepth<=0){dragDepth=0;document.body.classList.remove('dragover');}});
window.addEventListener('dragover',e=>e.preventDefault());
window.addEventListener('drop',e=>{
  e.preventDefault();dragDepth=0;document.body.classList.remove('dragover');
  const files=[...e.dataTransfer.files].filter(f=>f.type.startsWith('audio')||/\.(wav|mp3|ogg|m4a|aif+)$/i.test(f.name));
  files.forEach(f=>{const slot=state.layers.find(l=>!l.buffer);if(slot)loadFile(slot.index,f);});
});

// ===== fx =====
const ratios=[[0.5,'1/2'],[0.3333,'1/3'],[0.25,'1/4'],[0.1667,'1/6'],[0.75,'3/4']];
function recalcDelay(){if(!ctx)return;const t=Math.max(0.005,loopLen*state.delayRatio);delayNode.delayTime.setTargetAtTime(t,ctx.currentTime,0.02);}
$('delayRatioRaw').addEventListener('input',e=>{const[v,l]=ratios[+e.target.value];state.delayRatio=v;$('delayRatioV').textContent=l;recalcDelay();});
$('delayMix').addEventListener('input',e=>{state.delayMix=+e.target.value;$('delayMixV').textContent=Math.round(state.delayMix*100);if(wetDelayGain)wetDelayGain.gain.value=state.delayMix;});
$('delayFb').addEventListener('input',e=>{state.delayFb=+e.target.value;$('delayFbV').textContent=Math.round(state.delayFb*100);if(delayFeedbackGain)delayFeedbackGain.gain.value=state.delayFb;});
$('reverbMix').addEventListener('input',e=>{state.reverbMix=+e.target.value;$('reverbMixV').textContent=Math.round(state.reverbMix*100);if(wetVerbGain)wetVerbGain.gain.value=state.reverbMix;});
let irTimer=null;
function refreshIR(){if(!ctx)return;clearTimeout(irTimer);irTimer=setTimeout(()=>{convolver.buffer=makeIR();},180);}
$('reverbSize').addEventListener('input',e=>{state.reverbSize=+e.target.value;$('reverbSizeV').textContent=state.reverbSize.toFixed(1)+'s';refreshIR();});
$('reverbBloom').addEventListener('input',e=>{state.reverbBloom=+e.target.value;$('reverbBloomV').textContent=Math.round(state.reverbBloom*100);if(shimmerDepth)shimmerDepth.gain.value=state.reverbBloom*0.006;refreshIR();});

window.addEventListener('pointerdown',()=>{ensureContext();if(ctx&&ctx.state==='suspended')ctx.resume();},{once:true});
})();
