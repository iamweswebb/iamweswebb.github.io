(()=>{
const $=id=>document.getElementById(id);
// knob spec: [input id, label, formatter]
const L=[['reverbMix','MIX',v=>Math.round(v*100)],['reverbSize','SIZE',v=>(+v).toFixed(1)+'s'],['reverbBloom','BLOOM',v=>Math.round(v*100)]];
const R=[['delayMix','MIX',v=>Math.round(v*100)],['delayFb','FDBK',v=>Math.round(v*100)],['delayRatioRaw','TIME',v=>['1/2','1/3','1/4','1/6','3/4'][+v]]];
function buildKnob(col,[id,label,fmt]){
  const input=$(id);
  const min=+input.min,max=+input.max,step=+input.step||0.01;
  const el=document.createElement('div');el.className='knob';
  el.innerHTML=`<div class="knob-face"><div class="knob-ind"></div></div><span class="knob-label">${label}</span><span class="knob-val"></span>`;
  col.appendChild(el);
  const ind=el.querySelector('.knob-ind'),val=el.querySelector('.knob-val');
  function render(){
    const frac=(+input.value-min)/(max-min);
    ind.style.transform=`rotate(${-135+frac*270}deg)`;
    val.textContent=fmt(input.value);
  }
  let startY=0,startV=0,dragging=false;
  el.addEventListener('pointerdown',e=>{
    dragging=true;startY=e.clientY;startV=+input.value;
    el.classList.add('drag');el.setPointerCapture(e.pointerId);e.preventDefault();
  });
  el.addEventListener('pointermove',e=>{
    if(!dragging)return;
    const range=max-min;
    let v=startV+(startY-e.clientY)/140*range;
    v=Math.round(v/step)*step;
    v=Math.max(min,Math.min(max,v));
    if(v!==+input.value){input.value=v;input.dispatchEvent(new Event('input'));render();}
  });
  el.addEventListener('pointerup',()=>{dragging=false;el.classList.remove('drag');});
  el.addEventListener('dblclick',()=>{input.value=input.defaultValue;input.dispatchEvent(new Event('input'));render();});
  input.addEventListener('input',render);
  render();
}
L.forEach(k=>buildKnob($('knobsL'),k));
R.forEach(k=>buildKnob($('knobsR'),k));
// ── pads: show only first until sounds added ──
const pads=[...document.querySelectorAll('.pad')];
let visible=1;
function sync(){
  pads.forEach((p,i)=>{p.style.display=i<visible?'':'none';});
  $('addSound').style.display=visible>=pads.length?'none':'';
}
$('addSound').addEventListener('click',()=>{visible=Math.min(pads.length,visible+1);sync();});
// reveal a pad automatically when a file loads into it (drop / ring-tap can hit hidden slots)
new MutationObserver(()=>{
  pads.forEach((p,i)=>{if(p.classList.contains('loaded')&&i>=visible)visible=i+1;});
  sync();
}).observe($('pads'),{subtree:true,attributes:true,attributeFilter:['class']});
sync();
})();
