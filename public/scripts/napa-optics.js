/* Beta 2 Crystal Glass presentation enhancement. No session, request, draft or message state is owned here. */
(() => {
  'use strict';
  const root=document.documentElement;
  const nav=document.getElementById('mobileNav');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const pointer=matchMedia('(hover:hover) and (pointer:fine)');
  const structural='.shell,.home-shell,.lobby-shell,.forum-shell,.workspace-shell,.admin-shell';
  const content='.home-card,.login-panel,.confirm-card';
  const controls='.composer,.mobile-nav,.engagement-tools,.message-menu,.reaction-picker';
  // Settings uses ::after for its visible label; reserve that business pseudo-element.
  const compact='.composer .icon-btn,.composer .send-btn,.login-panel .join-btn,.home-toolbar>button:not(.settings-toggle-btn),.engagement-tools>button';
  const surfaces=[structural,content,controls,compact].join(',');
  function prepareMaterial(el){
    el.classList.add('napa-glass');
    el.dataset.napaMaterial=el.matches(structural)?'structural':el.matches(content)?'content':'control';
    if(el.matches(compact)){el.dataset.napaCompact='';return;}
    for(const name of ['napa-material-core','napa-material-transition']) {
      if(el.querySelector(':scope > .'+name))continue;
      const layer=document.createElement('span');layer.className=name;
      layer.setAttribute('aria-hidden','true');el.prepend(layer);
    }
  }
  document.querySelectorAll(surfaces).forEach(prepareMaterial);
  // Menus replace their children when opened; their inert material layer can be recreated safely.
  for(const el of document.querySelectorAll('.message-menu,.reaction-picker'))
    new MutationObserver(()=>prepareMaterial(el)).observe(el,{childList:true});
  const lens=document.createElement('span');
  lens.className='napa-nav-lens';lens.setAttribute('aria-hidden','true');
  nav.prepend(lens);nav.classList.add('napa-ready');
  let navFrame=0;
  function syncNav(){
    navFrame=0;
    const active=nav.querySelector('button.is-active');
    nav.style.setProperty('--napa-lens-visible',active?'1':'0');
    for(const button of nav.querySelectorAll('button')) {
      if(button===active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
    }
    if(active && nav.getClientRects().length) {
      nav.style.setProperty('--napa-lens-x',active.offsetLeft+'px');
      nav.style.setProperty('--napa-lens-width',active.offsetWidth+'px');
    }
    // The background chat is decorative during login and cannot receive Tab focus.
    document.querySelector('.app').inert=!document.body.classList.contains('view-chat');
  }
  function scheduleNav(){if(!navFrame)navFrame=requestAnimationFrame(syncNav);}
  new MutationObserver(scheduleNav).observe(nav,{subtree:true,attributes:true,attributeFilter:['class']});
  new MutationObserver(scheduleNav).observe(document.body,{attributes:true,attributeFilter:['class']});
  if(window.ResizeObserver)new ResizeObserver(scheduleNav).observe(nav);
  window.addEventListener('resize',scheduleNav,{passive:true});
  window.visualViewport?.addEventListener('resize',scheduleNav,{passive:true});
  // A rounded-rectangle perimeter, measured once on entry. Interpolating arc length
  // keeps the light on the curved rim even while it moves around a corner.
  function outline(rect,radius){
    const w=rect.width,h=rect.height,r=Math.min(radius,w/2,h/2),segments=[];
    let length=0;
    const line=(x,y,dx,dy,nx,ny)=>{const len=Math.hypot(dx,dy);segments.push({start:length,len,x,y,dx,dy,nx,ny});length+=len;};
    const arc=(x,y,angle)=>{const len=r*Math.PI/2;segments.push({start:length,len,x,y,r,angle});length+=len;};
    line(r,0,w-2*r,0,0,-1);arc(w-r,r,-Math.PI/2);
    line(w,r,0,h-2*r,1,0);arc(w-r,h-r,0);
    line(w-r,h,-w+2*r,0,0,1);arc(r,h-r,Math.PI/2);
    line(0,h-r,0,-h+2*r,-1,0);arc(r,r,Math.PI);
    return {segments,length,ambient:Math.max(0,w*.26-r)};
  }
  function onSegment(s,t){
    if(s.r!==undefined){const a=s.angle+t*Math.PI/2;return{x:s.x+s.r*Math.cos(a),y:s.y+s.r*Math.sin(a),nx:Math.cos(a),ny:Math.sin(a)};}
    return{x:s.x+s.dx*t,y:s.y+s.dy*t,nx:s.nx,ny:s.ny};
  }
  function pointAt(o,distance){
    const d=((distance%o.length)+o.length)%o.length;
    const s=o.segments.find(s=>s.len>0&&d<=s.start+s.len)||o.segments[0];
    return onSegment(s,s.len?(d-s.start)/s.len:0);
  }
  function project(o,x,y){
    let best={distance:Infinity,s:0};
    for(const s of o.segments){
      let t;
      if(s.r!==undefined){
        let angle=Math.atan2(y-s.y,x-s.x);
        if(angle<s.angle)angle+=2*Math.PI;
        // All arc endpoints are candidates too, including the atan2 wrap boundary.
        t=(angle-s.angle)/(Math.PI/2);
      }else t=s.len?((x-s.x)*s.dx+(y-s.y)*s.dy)/(s.len*s.len):0;
      for(const v of [0,Math.max(0,Math.min(1,t)),1]){
        const p=onSegment(s,v),distance=Math.hypot(p.x-x,p.y-y);
        if(distance<best.distance)best={distance,s:s.start+s.len*v};
      }
    }
    return best;
  }
  // One finite shared scheduler: one active surface plus at most two returning lights.
  const lights=new Map();
  let active=null,lightFrame=0,lastTime=0,pressed=null;
  const writeLight=(el,l)=>{
    const p=pointAt(l.outline,l.s);
    el.style.setProperty('--napa-light-x',p.x.toFixed(1)+'px');
    el.style.setProperty('--napa-light-y',p.y.toFixed(1)+'px');
    // The local surface normal controls the ellipse; the mask removes its entire center.
    el.style.setProperty('--napa-light-rx',(l.depth+l.span*Math.abs(p.ny)).toFixed(1)+'px');
    el.style.setProperty('--napa-light-ry',(l.depth+l.span*Math.abs(p.nx)).toFixed(1)+'px');
    el.style.setProperty('--napa-light-gain',l.gain.toFixed(3));
  };
  function clearLight(el){for(const k of ['x','y','rx','ry','gain'])el.style.removeProperty('--napa-light-'+k);lights.delete(el);}
  function stopLight(){
    cancelAnimationFrame(lightFrame);lightFrame=0;lastTime=0;active=null;
    for(const el of lights.keys())clearLight(el);
  }
  function kick(){if(!lightFrame){lastTime=performance.now();lightFrame=requestAnimationFrame(tick);}}
  function returnAmbient(){
    if(!active)return;
    const l=lights.get(active);
    if(l){l.ts=l.outline.ambient;l.targetGain=.34;l.returning=true;l.deadline=performance.now()+800;}
    active=null;kick();
  }
  function tick(now){
    lightFrame=0;
    if(document.hidden||reduced.matches||!pointer.matches){stopLight();return;}
    const k=1-Math.exp(-Math.min(64,Math.max(8,now-lastTime))/115);lastTime=now;
    let moving=false;
    for(const [el,l] of lights){
      const perimeter=l.outline.length;
      const current=((l.s%perimeter)+perimeter)%perimeter;
      const delta=((l.ts-current+perimeter*1.5)%perimeter)-perimeter*.5;
      l.s=current;
      l.s+=delta*k;l.gain+=(l.targetGain-l.gain)*k;
      const settled=now>=l.deadline||Math.abs(delta)+Math.abs(l.targetGain-l.gain)*30<.3;
      if(settled){l.s=l.ts;l.gain=l.targetGain;}
      writeLight(el,l);
      if(settled&&l.returning)clearLight(el);else if(!settled)moving=true;
    }
    if(moving)lightFrame=requestAnimationFrame(tick);
  }
  document.addEventListener('pointermove',event=>{
    if(reduced.matches||!pointer.matches||event.pointerType==='touch')return;
    const next=event.target.closest(surfaces);
    if(!next||next.closest('[inert]')||next.closest('[hidden]')){returnAmbient();return;}
    if(next!==active){
      returnAmbient();active=next;
      if(!lights.has(next)){
        if(lights.size>=3)clearLight(lights.keys().next().value);
        const rect=next.getBoundingClientRect(),o=outline(rect,parseFloat(getComputedStyle(next).borderTopLeftRadius)||0);
        const small=next.hasAttribute('data-napa-compact');
        lights.set(next,{rect,outline:o,s:o.ambient,gain:.34,depth:small?10:20,span:small?34:96});
      }
    }
    const l=lights.get(next),r=l.rect;
    l.pointerX=event.clientX;l.pointerY=event.clientY;
    const p=project(l.outline,event.clientX-r.left,event.clientY-r.top);
    // Deep inside a surface: keep environmental light, no floating white spot.
    const proximity=Math.max(0,1-p.distance/80);
    l.ts=proximity?p.s:l.outline.ambient;l.targetGain=.34+.5*proximity;
    l.returning=false;l.deadline=performance.now()+800;kick();
  },{passive:true});
  document.addEventListener('pointerleave',returnAmbient);
  document.addEventListener('transitionend',event=>{
    const l=lights.get(event.target);
    if(event.propertyName!=='transform'||!l)return;
    const rect=event.target.getBoundingClientRect(),o=outline(rect,parseFloat(getComputedStyle(event.target).borderTopLeftRadius)||0);
    l.s=l.s/l.outline.length*o.length;l.rect=rect;l.outline=o;
    if(l.returning)l.ts=o.ambient;
    else {const p=project(o,l.pointerX-rect.left,l.pointerY-rect.top);l.ts=p.distance<80?p.s:o.ambient;}
    l.deadline=performance.now()+800;kick();
  });
  document.addEventListener('pointerdown',event=>{
    const control=event.target.closest('button,input,textarea');
    if(!control||control.disabled)return;
    pressed=control.closest(surfaces);pressed?.classList.add('napa-pressed');
  },{passive:true});
  const release=()=>{pressed?.classList.remove('napa-pressed');pressed=null;};
  window.addEventListener('pointerup',release,{passive:true});window.addEventListener('pointercancel',release,{passive:true});
  document.addEventListener('scroll',stopLight,{capture:true,passive:true});
  window.addEventListener('resize',stopLight,{passive:true});
  window.visualViewport?.addEventListener('resize',stopLight,{passive:true});
  window.addEventListener('blur',()=>{stopLight();release();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopLight();release();}});
  reduced.addEventListener('change',stopLight);pointer.addEventListener('change',stopLight);
  // Follow existing theme state. Local light response only; finite and cancellable.
  let themeTimer=0;
  new MutationObserver(()=>{
    if(reduced.matches)return;
    clearTimeout(themeTimer);
    const elements=[...document.querySelectorAll(surfaces)];
    elements.forEach(el=>el.classList.add('napa-theme-response'));
    themeTimer=setTimeout(()=>elements.forEach(el=>el.classList.remove('napa-theme-response')),400);
  }).observe(root,{attributes:true,attributeFilter:['data-theme']});
  scheduleNav();
})();
