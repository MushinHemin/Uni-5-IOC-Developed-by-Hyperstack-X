/* Stage B checks only. Requires an existing Playwright installation; no dependencies installed. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {chromium}=require(process.env.UNI_PLAYWRIGHT_MODULE||'playwright');
const {server}=require('../../scripts/preview-napa.cjs');
const out=path.resolve(process.env.UNI_VISUAL_OUTPUT||'/tmp/uni-napa-stage-b');
const result={scope:'Stage A/B optical prototype; synthetic local data only',checks:[],errors:[],screenshots:[]};
(async()=>{
 let browser;
 try{
 fs.mkdirSync(out,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({...(process.env.UNI_BROWSER_EXECUTABLE?{executablePath:process.env.UNI_BROWSER_EXECUTABLE}:{}),headless:true,args:['--disable-gpu']});
 result.browser=browser.version();
 const context=await browser.newContext({viewport:{width:1440,height:960},deviceScaleFactor:1});
 const page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>result.errors.push(e.message));
 const base='http://127.0.0.1:'+server.address().port;
 const check=async(name,fn)=>{try{await fn();result.checks.push({name,pass:true})}catch(e){result.checks.push({name,pass:false,error:e.message});throw e}};
 async function visit(scene,baseline=false,theme='light'){await page.goto(base+'/?scene='+scene+'&baseline='+(baseline?'1':'0')+'&theme='+theme+'&capture=1');await page.waitForTimeout(800)}
 async function shot(name){await page.screenshot({path:path.join(out,name+'.png')});result.screenshots.push(name+'.png')}
 for(const baseline of [true,false]){
   for(const scene of ['login','chat','home']){await visit(scene,baseline);await shot((baseline?'before-':'after-')+scene)}
   await visit('login',baseline,'dark');await shot((baseline?'before-':'after-')+'dark-login');
 }
 await visit('login');
 await check('Sonoma wallpaper and all business IDs are preserved',async()=>{
   const baseline=cp.execFileSync('git',['show','b8c177c:public/index.html'],{encoding:'utf8'});
   const html=fs.readFileSync(path.resolve(__dirname,'../../public/index.html'),'utf8');
   const ids=s=>[...s.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.deepEqual(ids(html),ids(baseline));
   assert.ok(await page.evaluate(()=>getComputedStyle(document.body,'::before').backgroundImage.includes('sonoma.jpg')));
 });
 await check('Login background is recessed and cannot receive keyboard focus',async()=>{
   assert.equal(await page.locator('.app').evaluate(el=>el.inert),true);
   assert.equal(await page.locator('.app').evaluate(el=>getComputedStyle(el).filter),'blur(12px)');
   assert.equal(await page.locator('.login-panel').isVisible(),true);
 });
 await check('Glass default is 50%; 0 and 100 alter real material blur/transmission',async()=>{
   const values=await page.evaluate(()=>{const d=readGlassIntensity(),el=document.querySelector('.login-panel');applyGlassIntensity(0,false);const a=[getComputedStyle(el).backdropFilter,getComputedStyle(el).backgroundImage];applyGlassIntensity(100,false);const b=[getComputedStyle(el).backdropFilter,getComputedStyle(el).backgroundImage];applyGlassIntensity(50,false);return {d,a,b}});
   assert.equal(values.d,50);assert.notEqual(values.a[0],values.b[0]);assert.notEqual(values.a[1],values.b[1]);
 });
 await check('Existing login form works; transition exits before it is hidden',async()=>{
   await page.locator('#authSubmit').click();await page.waitForFunction(()=>{const p=parseFloat(getComputedStyle(document.getElementById('login')).opacity);return p>0&&p<.98},{},{timeout:1000});
   assert.equal(await page.locator('#login').getAttribute('hidden'),null);
   assert.ok(await page.locator('#login').evaluate(el=>parseFloat(getComputedStyle(el).opacity)<1));
   await page.waitForTimeout(700);assert.equal(await page.locator('#login').isVisible(),false);
   assert.equal(await page.locator('#input').isEnabled(),true);
   assert.equal(await page.locator('.app').evaluate(el=>el.inert),false);
 });
 await check('IME Enter does not send; Shift+Enter and normal send remain intact',async()=>{
   await page.locator('#input').fill('合成输入法测试');
   await page.locator('#input').evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart'));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));});
   assert.equal(await page.evaluate(()=>__previewEvents.filter(n=>n==='chat message').length),0);
   await page.locator('#input').evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend')));await page.waitForTimeout(80);
   await page.locator('#input').press('Shift+Enter');assert.ok((await page.locator('#input').inputValue()).includes('\n'));
   await page.locator('#input').press('Enter');await page.waitForTimeout(100);
   assert.equal(await page.evaluate(()=>__previewEvents.filter(n=>n==='chat message').length),1);
 });
 await check('Pointer specular light settles; touch does not start hover tracking',async()=>{
   await page.locator('#composer').hover();await page.waitForTimeout(1200);
   const first=await page.locator('#composer').getAttribute('style');await page.waitForTimeout(300);assert.equal(await page.locator('#composer').getAttribute('style'),first);
   assert.ok(first?.includes('--napa-light-x'));
   await page.locator('#composer').dispatchEvent('pointermove',{pointerType:'touch',clientX:1,clientY:1});await page.waitForTimeout(100);assert.equal(await page.locator('#composer').getAttribute('style'),first);
 });
 for(const width of [390,430,768,1366]){
   await page.setViewportSize({width,height:width<500?844:960});
   for(const theme of ['light','dark']){
     await page.evaluate(t=>setThemeMode(t,false),theme);await page.waitForTimeout(650);
     await check(`Composer/nav bounds ${width}px ${theme}`,async()=>{
       const b=await page.evaluate(()=>{const c=composer.getBoundingClientRect(),m=messagesDiv.getBoundingClientRect(),n=mobileNav.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth+1,bottom:c.bottom,top:c.top,messageBottom:m.bottom,navTop:n.top,navVisible:getComputedStyle(mobileNav).display!=='none',height:innerHeight}});
       assert.equal(b.overflow,false);assert.ok(b.bottom<=b.height+1);assert.ok(b.messageBottom<=b.top+1);if(b.navVisible)assert.ok(b.bottom<=b.navTop+1);
     });
   }
 }
 await page.setViewportSize({width:390,height:844});await visit('chat');await shot('after-mobile-chat');
 await check('Existing mobile navigation moves one continuous lens and retains input',async()=>{
   await page.locator('#input').fill('保留的合成草稿');
   const x=await page.locator('#mobileNav').evaluate(el=>el.style.getPropertyValue('--napa-lens-x'));
   await page.locator('[data-mobile-nav="forum"]').click();await page.waitForTimeout(700);
   assert.equal(await page.locator('[data-mobile-nav="forum"]').getAttribute('aria-current'),'page');
   assert.notEqual(await page.locator('#mobileNav').evaluate(el=>el.style.getPropertyValue('--napa-lens-x')),x);
   await page.locator('[data-mobile-nav="chat"]').click();await page.waitForTimeout(700);
   assert.equal(await page.locator('#input').inputValue(),'保留的合成草稿');assert.equal(await page.locator('.napa-nav-lens').count(),1);
 });
 await check('Simulated soft keyboard and multiline input remain within the visible viewport',async()=>{
   await page.evaluate(()=>{window.__vv=visualViewport;input.focus();Object.defineProperty(window,'visualViewport',{configurable:true,value:{height:410,offsetTop:20,scale:1}});syncMobileViewport()});
   await page.locator('#input').fill('合成多行\n'.repeat(9));await page.waitForTimeout(250);
   assert.equal(await page.locator('#mobileNav').isVisible(),false);
   assert.ok(await page.locator('#composer').evaluate(el=>el.getBoundingClientRect().bottom<=431));
   await page.evaluate(()=>{input.blur();Object.defineProperty(window,'visualViewport',{configurable:true,value:window.__vv});syncMobileViewport()});await page.waitForTimeout(250);
 });
 await check('Ordinary users do not acquire visible administrator controls',async()=>{
   assert.equal(await page.locator('[data-admin-entry]:visible').count(),0);
 });
 await page.setViewportSize({width:1440,height:960});await visit('chat',false,'dark');await shot('after-dark-chat');
 await check('Reduced motion stops optical tracking and nav interpolation',async()=>{
   await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);
   await page.locator('#composer').hover();await page.waitForTimeout(100);
   assert.equal(await page.locator('#composer').evaluate(el=>el.style.getPropertyValue('--napa-light-x')),'');
   assert.equal(await page.locator('.napa-nav-lens').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
 });
 assert.deepEqual(result.errors,[]);
 console.log(JSON.stringify({passed:result.checks.filter(c=>c.pass).length,failed:result.checks.filter(c=>!c.pass).length,screenshots:result.screenshots.length,pageErrors:result.errors}));
 }catch(e){result.failure=e.message;console.error(e.message);process.exitCode=1}
 finally{fs.writeFileSync(path.join(out,'stage-b-validation.json'),JSON.stringify(result,null,2));if(browser)await browser.close();server.close()}
})();
