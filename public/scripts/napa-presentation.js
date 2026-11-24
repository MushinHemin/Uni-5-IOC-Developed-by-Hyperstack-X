/* Scoped home/notification pilot. Apple sources define purpose and hierarchy;
   duration, scale and CSS treatment here are explicitly Uni Web choices. */
(() => {
  'use strict';
  const root=document.documentElement, modal=document.getElementById('notificationModal');
  const card=modal.querySelector('.confirm-card'),trigger=document.getElementById('notificationOpen');
  const reduced=matchMedia('(prefers-reduced-motion:reduce)');
  const transparency=matchMedia('(prefers-reduced-transparency:reduce)');
  const select=document.getElementById('transparencyMode');
  let choice='auto',generation=0,animations=[],returnTo=null,blocked=[],phase='closed',finishClose=null;
  // Existing navigation/resize handlers can change a background view's inert
  // state. Keep dialog isolation authoritative only while this dialog is open.
  const isolation=new MutationObserver(records=>{
    if(modal.hidden)return;
    for(const {target} of records)
      if(!target.inert&&blocked.some(([el])=>el===target))target.inert=true;
  });
  try { if(localStorage.getItem('uni-transparency-mode')==='reduced')choice='reduced'; } catch {}
  function syncTransparency(){
    root.dataset.transparency=choice==='reduced'||transparency.matches?'reduced':'auto';
    if(select)select.value=choice;
  }
  function setTransparency(value){
    choice=value==='reduced'?'reduced':'auto';
    try{localStorage.setItem('uni-transparency-mode',choice);}catch{}
    syncTransparency();
  }
  transparency.addEventListener('change',syncTransparency);
  select?.addEventListener('change',()=>setTransparency(select.value));syncTransparency();
  trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-controls',modal.id);trigger.setAttribute('aria-expanded','false');
  function cancel(){generation++;for(const a of animations)a.cancel();animations=[];}
  function release(){
    isolation.disconnect();
    for(const [el,inert] of blocked)if(el.isConnected)el.inert=inert;
    blocked=[];
    // Authentication/navigation may change the active page while a dialog closes.
    // Keep the existing decorative-chat focus rule in sync with the current view.
    const app=document.querySelector('.app');
    if(app)app.inert=!document.body.classList.contains('view-chat');
  }
  function constrain(){
    if(blocked.length)return;
    for(const el of document.body.children){
      if(el===modal||['SCRIPT','STYLE','LINK'].includes(el.tagName)||el.id==='napaPreviewControls')continue;
      blocked.push([el,el.inert]);el.inert=true;
      isolation.observe(el,{attributes:true,attributeFilter:['inert']});
    }
  }
  function sourceGeometry(source){
    const from=source?.getBoundingClientRect(),to=card.getBoundingClientRect();
    const x=from?Math.max(0,Math.min(to.width,from.left+from.width/2-to.left)):to.width/2;
    const y=from?Math.max(0,Math.min(to.height,from.top+from.height/2-to.top)):0;
    card.style.setProperty('--uni-origin-x',x+'px');card.style.setProperty('--uni-origin-y',y+'px');
  }
  function animate(open,done){
    const id=generation;
    if(reduced.matches||!card.animate){done();return;}
    const start={opacity:0,transform:'translateY(-8px) scale(.94)'},end={opacity:1,transform:'translateY(0) scale(1)'};
    const duration=open?240:180;
    const a=card.animate(open?[start,end]:[end,start],{duration,easing:'cubic-bezier(.2,.7,.2,1)',fill:'both'});
    const b=modal.animate([{backgroundColor:open?'rgba(6,16,34,0)':'rgba(6,16,34,.22)'},{backgroundColor:open?'rgba(6,16,34,.22)':'rgba(6,16,34,0)'}],{duration,fill:'both'});
    animations=[a,b];
    a.finished.then(()=>{if(id!==generation)return;done();for(const item of animations)item.cancel();animations=[];}).catch(()=>{});
  }
  function openNotifications(source){
    const wasClosed=modal.hidden;
    cancel();finishClose=null;phase='opening';modal.classList.remove('is-closing');modal.hidden=false;
    if(wasClosed||!returnTo)returnTo=source instanceof HTMLElement?source:document.activeElement;
    sourceGeometry(returnTo?.getClientRects().length?returnTo:trigger);
    trigger.setAttribute('aria-expanded','true');constrain();
    document.getElementById('notificationClose').focus({preventScroll:true});
    animate(true,()=>{phase='open';});
  }
  function closeNotifications({restoreFocus=true,immediate=false}={}){
    if(modal.hidden)return;
    cancel();phase='closing';trigger.setAttribute('aria-expanded','false');
    const finish=()=>{
      // Clicking the non-focusable backdrop can move focus to body before its
      // click closes the dialog. That still belongs to this dismissal; restore
      // the source, while allowing explicit target navigation to opt out.
      const ownedFocus=modal.contains(document.activeElement)||document.activeElement===document.body;
      phase='closed';finishClose=null;modal.hidden=true;release();
      if(restoreFocus&&ownedFocus&&returnTo?.isConnected&&!returnTo.closest('[hidden],[inert]'))returnTo.focus({preventScroll:true});
      returnTo=null;
    };
    finishClose=finish;
    if(immediate)finish();else animate(false,finish);
  }
  modal.addEventListener('keydown',event=>{
    if(event.key!=='Tab'||modal.hidden)return;
    const items=[...modal.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select,textarea,[tabindex="0"]')].filter(el=>el.getClientRects().length&&!el.closest('[hidden],[inert]'));
    if(!items.length){event.preventDefault();return;}
    const first=items[0],last=items.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
  document.addEventListener('focusin',event=>{
    if(!modal.hidden&&!modal.contains(event.target)&&!event.target.closest('#napaPreviewControls'))
      document.getElementById('notificationClose').focus({preventScroll:true});
  });
  // Existing authentication cleanup can hide dialogs without invoking close.
  new MutationObserver(()=>{if(modal.hidden){cancel();release();phase='closed';finishClose=null;trigger.setAttribute('aria-expanded','false');returnTo=null;}}).observe(modal,{attributes:true,attributeFilter:['hidden']});
  reduced.addEventListener('change',()=>{
    if(modal.hidden)return;
    cancel();
    if(phase==='closing')finishClose?.();else phase='open';
  });
  window.NapaPresentation={openNotifications,closeNotifications,setTransparency};
})();
