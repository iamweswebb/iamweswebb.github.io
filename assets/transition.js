/* Page transitions: pink wipe out on internal nav, reveal on load */
(function(){
const D=document;
const style=D.createElement('style');
style.textContent='#pt-wipe{position:fixed;inset:0;z-index:9999;background:#e2007a;transform:translateY(101%);pointer-events:none;display:flex;align-items:center;justify-content:center}#pt-wipe.out{transition:transform .45s cubic-bezier(.76,0,.24,1);transform:translateY(0)}#pt-wipe.in{transform:translateY(0);animation:ptUp .55s cubic-bezier(.76,0,.24,1) .05s both}@keyframes ptUp{to{transform:translateY(-101%)}}#pt-wipe svg{opacity:0}#pt-wipe.out svg{opacity:1;transition:opacity .2s .15s}';
D.head.appendChild(style);
const wipe=D.createElement('div');
wipe.id='pt-wipe';
wipe.innerHTML='<svg width="56" height="37" viewBox="0 0 240 160" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="26" height="160" fill="#fff"></rect><rect x="42" y="75" width="26" height="85" fill="#fff"></rect><rect x="84" y="0" width="26" height="160" fill="#fff"></rect><rect x="126" y="0" width="26" height="160" fill="#fff"></rect><rect x="168" y="75" width="26" height="85" fill="#fff"></rect><rect x="210" y="0" width="26" height="160" fill="#fff"></rect></svg>';
function mount(){D.body.appendChild(wipe);
if(sessionStorage.getItem('pt-nav')==='1'){sessionStorage.removeItem('pt-nav');wipe.classList.add('in');wipe.addEventListener('animationend',()=>wipe.classList.remove('in'),{once:true});}
D.addEventListener('click',e=>{
  const a=e.target.closest('a');
  if(!a)return;
  const href=a.getAttribute('href')||'';
  if(a.target==='_blank'||href.startsWith('#')||href.startsWith('mailto:')||href.startsWith('http'))return;
  if(e.metaKey||e.ctrlKey||e.shiftKey)return;
  e.preventDefault();
  sessionStorage.setItem('pt-nav','1');
  wipe.classList.add('out');
  setTimeout(()=>{location.href=href;},460);
});
window.addEventListener('pageshow',ev=>{if(ev.persisted){wipe.classList.remove('out','in');}});}
D.body?mount():D.addEventListener('DOMContentLoaded',mount);
})();
