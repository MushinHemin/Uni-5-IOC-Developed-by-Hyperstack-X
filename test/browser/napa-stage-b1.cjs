/* Material-only verification; use existing Playwright. All fixtures are synthetic. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.UNI_PLAYWRIGHT_MODULE||'playwright');
const {server}=require('../../scripts/preview-napa.cjs');
const out=process.env.UNI_VISUAL_OUTPUT||'/tmp/uni-napa-b1';
const resume=process.env.UNI_VISUAL_RESUME==='1';
const result={checks:[],screenshots:[],errors:[],measurements:{},scope:'Stage B.1 synthetic Chromium; not Safari or hardware performance certification'};
(async()=>{let browser;try{
 fs.mkdirSync(out,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({executablePath:process.env.UNI_BROWSER_EXECUTABLE,headless:true});result.browser=browser.version();
 const page=await browser.newPage({viewport:{width:1440,height:960}});page.on('pageerror',e=>result.errors.push(e.message));page.setDefaultTimeout(5000);
 const base='http://127.0.0.1:'+server.address().port;
 if(resume){const previous=JSON.parse(fs.readFileSync(path.join(out,'b1-validation.json'),'utf8'));result.checks=previous.checks.filter(c=>c.pass);result.screenshots=previous.screenshots;result.measurements=previous.measurements;}
 async function go(scene,before=false,theme='light'){await page.goto(base+'/?capture=1&scene='+scene+'&stageb='+(before?'1':'0')+'&theme='+theme);await page.waitForFunction(()=>document.getElementById('appLaunch').hidden);await page.waitForTimeout(650)}
 async function check(name,fn){if(resume&&result.checks.some(c=>c.name===name&&c.pass))return;try{await fn();result.checks.push({name,pass:true})}catch(e){result.checks.push({name,pass:false,error:e.message});throw e}}
 async function shot(name,selector){const target=selector?page.locator(selector):page;await target.screenshot({path:path.join(out,name+'.png')});result.screenshots.push(name+'.png')}
 if(!resume)for(const scene of ['home','chat','login'])for(const theme of ['light','dark']){
  let bounds;
  for(const before of [true,false]){
   await go(scene,before,theme);await shot((before?'before':'after')+'-'+scene+(theme==='dark'?'-dark':''));
   const selector=scene==='home'?'.home-shell':scene==='chat'?'.shell':'.login-panel';
   const rect=await page.locator(selector).boundingBox();
   if(before)bounds=rect;else await check(`Unchanged ${scene}/${theme} layout bounds`,async()=>{for(const k of ['x','y','width','height'])assert.ok(Math.abs(rect[k]-bounds[k])<2,`${k}: ${rect[k]} != ${bounds[k]}`)});
  }
 }
 await go('home');
 await check('Original wallpaper, unfiltered wallpaper and no white viewport wash',async()=>{
  const p=await page.evaluate(()=>({image:getComputedStyle(document.body,'::before').backgroundImage,filter:getComputedStyle(document.body,'::before').filter,overlay:getComputedStyle(document.body,'::after').backgroundImage}));
  assert.ok(p.image.includes('sonoma.jpg'));assert.equal(p.filter,'none');assert.ok(!p.overlay.includes('255, 255, 255'));result.measurements.wallpaper=p;
 });
 await check('Clear edge and frosted core are separate, masked and inert; text opacity remains one',async()=>{
  const p=await page.locator('.home-card').first().evaluate(el=>{const c=el.querySelector('.napa-material-core'),a=getComputedStyle(el),b=getComputedStyle(c);return{background:a.backgroundColor,opacity:a.opacity,core:b.backgroundColor,mask:b.maskImage,blur:b.backdropFilter,radius:a.borderRadius,pointer:b.pointerEvents,hidden:c.getAttribute('aria-hidden'),fontOpacity:getComputedStyle(el.querySelector('h3')).opacity,parentBlur:a.backdropFilter}});
  assert.equal(p.opacity,'1');assert.equal(p.fontOpacity,'1');assert.equal(p.pointer,'none');assert.equal(p.hidden,'true');assert.ok(p.mask.includes('gradient'));assert.ok(p.blur.includes('blur'));assert.equal(p.parentBlur,'none');assert.ok(parseFloat(p.radius)>=34);result.measurements.card=p;
 });
 await check('Actual backdrop diffusion survives the page compositing context',async()=>{
  const stripe=await page.addStyleTag({content:'body::before{background:repeating-linear-gradient(90deg,#405d7b 0 12px,#b7c9db 12px 24px)!important}'});
  const card=page.locator('.home-card').first(),bounds=await card.boundingBox();
  async function energy(){
   const data=(await card.screenshot()).toString('base64');
   return page.evaluate(async({data,w,h})=>{
    const im=new Image();im.src='data:image/png;base64,'+data;await im.decode();
    const canvas=document.createElement('canvas');canvas.width=im.width;canvas.height=im.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(im,0,0);
    const y=Math.floor(h*.42),x=Math.floor(w*.36),n=Math.floor(w*.28),pixels=ctx.getImageData(x,y,n,1).data;
    let sum=0;for(let i=4;i<pixels.length;i+=4)sum+=Math.abs(pixels[i+1]-pixels[i-3]);return sum/(n-1);
   },{data,w:bounds.width,h:bounds.height});
  }
  const blurred=await energy();await shot('calibration-frosted-core');
  const none=await page.addStyleTag({content:'.napa-material-core,.napa-material-transition{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}'});
  const unblurred=await energy();await none.evaluate(el=>el.remove());await stripe.evaluate(el=>el.remove());
  result.measurements.diffusion={blurred,unblurred,ratio:blurred/unblurred};
  assert.ok(blurred<unblurred*.65,'The rendered core must soften the pattern, not only advertise CSS blur');
 });
 await check('Inactive rear chat is not an extra wash; login retains spatial transform',async()=>{
  assert.equal(await page.locator('.app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
  await go('login');assert.equal(await page.locator('.app').evaluate(el=>el.inert),true);
  assert.notEqual(await page.locator('.app').evaluate(el=>getComputedStyle(el).transform),'none');
  await go('home');
 });
 await check('Home cards retain real navigation listeners',async()=>{await page.locator('#homeChatOpen').click();await page.waitForTimeout(700);assert.equal(await page.evaluate(()=>state.view),'lobby')});
 await go('chat');
 await check('0/50/100 glass control changes opacity and blur without resetting preference',async()=>{
  const p=await page.evaluate(()=>{const d=readGlassIntensity();const sample=n=>{applyGlassIntensity(n,false);return{alpha:getComputedStyle(document.documentElement).getPropertyValue('--napa-core-alpha'),blur:getComputedStyle(document.querySelector('.composer>.napa-material-core')).backdropFilter}};const a=sample(0),b=sample(50),c=sample(100);sample(d);return{d,a,b,c}});assert.equal(p.d,50);assert.ok(+p.a.alpha<+p.b.alpha&&+p.b.alpha<+p.c.alpha);assert.notEqual(p.a.blur,p.c.blur);result.measurements.intensity=p;
 });
 await check('Edge light follows smoothly, returns to ambient and stops',async()=>{
  const r=await page.locator('#composer').boundingBox();await page.mouse.move(r.x+24,r.y+5);await page.waitForTimeout(800);await shot('highlight-left','#composer');
  const left=await page.locator('#composer').getAttribute('style');
  await page.mouse.move(r.x+r.width-24,r.y+5);await page.waitForTimeout(60);const moving=await page.locator('#composer').getAttribute('style');await page.waitForTimeout(800);await shot('highlight-right','#composer');
  const right=await page.locator('#composer').getAttribute('style');assert.notEqual(left,right);assert.notEqual(moving,right);
  await page.mouse.move(2,2);await page.waitForTimeout(60);assert.ok((await page.locator('#composer').getAttribute('style')).includes('--napa-light-x'));await page.waitForTimeout(850);
  assert.equal(await page.locator('#composer').evaluate(el=>el.style.getPropertyValue('--napa-light-x')),'');
  assert.equal(await page.locator('[style*="--napa-light-x"]').count(),0);await shot('highlight-rest','#composer');
 });
 await check('Highlight follows the rounded corner and is masked out of the reading core',async()=>{
  const r=await page.locator('#composer').boundingBox();
  const radius=await page.locator('#composer').evaluate(el=>parseFloat(getComputedStyle(el).borderTopLeftRadius));
  const c=radius*(1-Math.SQRT1_2)+2;
  await page.mouse.move(r.x+c,r.y+c);await page.waitForTimeout(900);
  const p=await page.locator('#composer').evaluate(el=>({x:parseFloat(el.style.getPropertyValue('--napa-light-x')),y:parseFloat(el.style.getPropertyValue('--napa-light-y')),mask:getComputedStyle(el,'::after').maskComposite,band:getComputedStyle(el,'::after').paddingTop}));
  assert.ok(p.x>0&&p.y>0);assert.ok(Math.abs(Math.hypot(p.x-radius,p.y-radius)-radius)<1);assert.equal(p.mask,'exclude');assert.equal(p.band,'3px');
  result.measurements.curvedLight={...p,radius};await shot('highlight-corner','#composer');
  await page.mouse.move(2,2);await page.waitForTimeout(950);
 });
 await check('Press highlight narrows then releases without moving the window',async()=>{
  await page.locator('#input').fill('合成按压反馈');await page.locator('.send-btn').hover();await page.mouse.down();assert.equal(await page.locator('#composer').evaluate(el=>el.classList.contains('napa-pressed')),true);await page.mouse.up();assert.equal(await page.locator('#composer').evaluate(el=>el.classList.contains('napa-pressed')),false);
 });
 await check('IME composition and normal Enter preserve send behavior',async()=>{
  const n=await page.evaluate(()=>__previewEvents.filter(e=>e==='chat message').length);
  await page.locator('#input').fill('合成中文');await page.locator('#input').evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart'));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}))});assert.equal(await page.evaluate(()=>__previewEvents.filter(e=>e==='chat message').length),n);
  await page.locator('#input').evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend')));await page.waitForTimeout(80);await page.locator('#input').press('Shift+Enter');assert.ok((await page.locator('#input').inputValue()).includes('\n'));await page.locator('#input').press('Enter');assert.equal(await page.evaluate(()=>__previewEvents.filter(e=>e==='chat message').length),n+1);
 });
 for(const width of [390,430,768,1366]){
  await page.setViewportSize({width,height:width<500?844:960});await page.waitForTimeout(450);
  await check(`U19 bounds and nav access ${width}px`,async()=>{
   const p=await page.evaluate(()=>{const c=composer.getBoundingClientRect(),n=mobileNav.getBoundingClientRect(),m=messagesDiv.getBoundingClientRect();return{bottom:c.bottom,top:c.top,msg:m.bottom,navTop:n.top,nav:getComputedStyle(mobileNav).display!=='none',h:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1}});assert.equal(p.overflow,false);assert.ok(p.bottom<=p.h+1);assert.ok(p.msg<=p.top+1);if(p.nav)assert.ok(p.bottom<=p.navTop+1);
  });
 }
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);await shot('after-mobile-chat');
 await check('Soft-keyboard simulation retains multiline input and navigation recovers',async()=>{
  await page.evaluate(()=>{window.__vv=visualViewport;input.focus();Object.defineProperty(window,'visualViewport',{configurable:true,value:{height:410,offsetTop:20,scale:1}});syncMobileViewport()});await page.locator('#input').fill('多行\n'.repeat(8));await page.waitForTimeout(300);assert.equal(await page.locator('#mobileNav').isVisible(),false);assert.ok(await page.locator('#composer').evaluate(el=>el.getBoundingClientRect().bottom<=431));await page.evaluate(()=>{input.blur();Object.defineProperty(window,'visualViewport',{configurable:true,value:window.__vv});syncMobileViewport()});await page.waitForTimeout(300);assert.equal(await page.locator('#mobileNav').isVisible(),true);
 });
 await check('No exposed admin buttons or duplicated material cores',async()=>{
  assert.equal(await page.locator('[data-admin-entry]:visible').count(),0);
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.napa-glass')].some(el=>el.querySelectorAll(':scope>.napa-material-core').length!==1||el.querySelectorAll(':scope>.napa-material-transition').length!==1)),false);
 });
 await page.setViewportSize({width:1440,height:960});
 await check('Reduced motion and high contrast have graceful fallback',async()=>{
  await page.emulateMedia({reducedMotion:'reduce',contrast:'more'});await page.locator('#composer').hover();await page.waitForTimeout(200);assert.equal(await page.locator('#composer').evaluate(el=>el.style.getPropertyValue('--napa-light-x')),'');assert.equal(await page.locator('#composer').evaluate(el=>getComputedStyle(el,'::after').display),'none');assert.equal(await page.locator('#input').isEnabled(),true);
 });
 await page.emulateMedia({reducedMotion:'no-preference',contrast:'no-preference'});
 result.measurements.frameIntervals=await page.evaluate(()=>new Promise(resolve=>{const a=[];let prev=performance.now();function f(now){a.push(now-prev);prev=now;if(a.length<30)requestAnimationFrame(f);else{a.sort((x,y)=>x-y);resolve({medianMs:a[15],p95Ms:a[28],samples:30,note:'headless timing only, not real-device FPS'})}}requestAnimationFrame(f)}));
 assert.deepEqual(result.errors,[]);console.log(JSON.stringify({passed:result.checks.length,errors:result.errors,screenshots:result.screenshots.length}));
 }catch(e){result.failure=e.message;console.error(e.message);process.exitCode=1}finally{fs.writeFileSync(path.join(out,'b1-validation.json'),JSON.stringify(result,null,2));if(browser)await browser.close();server.close()}})();
