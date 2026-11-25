/* Focused Liquid Crystal validation. Synthetic preview only; no production data. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.UNI_PLAYWRIGHT_MODULE||'playwright');
const out=path.resolve(process.env.UNI_VISUAL_OUTPUT||'/tmp/uni-liquid-crystal');
const base=process.env.NAPA_PREVIEW_URL||'http://127.0.0.1:8860';
const report={checks:[],errors:[],measurements:{},scope:'Chromium synthetic preview; Safari native checks recorded separately'};
const only=process.env.CRYSTAL_CHECK_FILTER;
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.UNI_BROWSER_EXECUTABLE?{executablePath:process.env.UNI_BROWSER_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:960},deviceScaleFactor:1});
 const page=await context.newPage();page.setDefaultTimeout(6000);
 page.on('pageerror',e=>report.errors.push(e.message));
 const save=()=>fs.writeFileSync(path.join(out,'validation'+(only?'-targeted':'')+'.json'),JSON.stringify(report,null,2));
 const check=async(name,fn)=>{if(only&&!name.includes(only))return;try{await fn();report.checks.push({name,pass:true});}catch(e){report.checks.push({name,pass:false,error:e.message});}save();};
 const go=async(query='scene=home')=>{await page.mouse.move(1,1);await page.goto(base+'/?capture=1&'+query);await page.waitForFunction(()=>document.getElementById('appLaunch').hidden);await page.waitForTimeout(1000);};
 const shot=async(name,selector)=>{await(selector?page.locator(selector):page).screenshot({path:path.join(out,name+'.png')});};
 const bounds=()=>page.locator('.home-card').evaluateAll(es=>es.map(el=>{const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}));
 const contrast=()=>page.evaluate(()=>{
  const linear=c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;};
  const lum=c=>.2126*linear(c[0])+.7152*linear(c[1])+.0722*linear(c[2]);
  return [...document.querySelectorAll('.crystal-ready')].flatMap(el=>{
   const c=el.querySelector('canvas'),r=c.getBoundingClientRect(),pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
   return [...el.querySelectorAll('h3,p,.home-card-meta span')].map(t=>{
    const range=document.createRange();range.selectNodeContents(t);const b=range.getBoundingClientRect();
    const ink=lum(getComputedStyle(t).color.match(/[\d.]+/g).slice(0,3).map(Number));let minimum=100;
    for(let y=b.top;y<b.bottom;y+=2)for(let x=b.left;x<b.right;x+=2){
     const px=Math.max(0,Math.min(c.width-1,Math.round((x-r.x)/r.width*c.width))),py=Math.max(0,Math.min(c.height-1,Math.round((y-r.y)/r.height*c.height)));
     const i=(py*c.width+px)*4,L=lum(pixels.slice(i,i+3));minimum=Math.min(minimum,(Math.max(L,ink)+.05)/(Math.min(L,ink)+.05));
    }return {card:el.id,tag:t.tagName,minimum:+minimum.toFixed(3)};
   });
  });
 });
 try{
  report.browser=browser.version();
  for(const theme of ['light','dark'])await check('Home layout and text contrast / '+theme,async()=>{
   await go('scene=home&theme='+theme+'&stageb=1');const before=await bounds();await shot('before-home-'+theme);
   await go('scene=home&theme='+theme);await page.waitForFunction(()=>document.querySelectorAll('.crystal-ready').length===3);
   const after=await bounds();for(let i=0;i<3;i++)for(let j=0;j<4;j++)assert.ok(Math.abs(after[i][j]-before[i][j])<1);
   const values=await contrast();assert.ok(values.length>=12);assert.ok(values.every(v=>v.minimum>=4.5),JSON.stringify(values));
   report.measurements['contrast-'+theme]=values;
   await shot('after-home-'+theme);await shot('card-'+theme,'#homeChatOpen');
  });
  await check('Pixel displacement and chromatic separation confined to rim',async()=>{
   await go('scene=home&calibration=1');await page.waitForFunction(()=>document.querySelector('.crystal-ready'));
   assert.match(await page.locator('body').evaluate(el=>getComputedStyle(el,'::before').backgroundImage),/calibration=1/);
   await page.evaluate(()=>{document.documentElement.style.setProperty('--crystal-displacement','0');document.documentElement.style.setProperty('--crystal-corner-displacement','0');document.documentElement.style.setProperty('--crystal-dispersion','0');});await page.waitForTimeout(200);
   await shot('calibration-zero');await shot('calibration-zero-card','#homeChatOpen');
   await page.evaluate(()=>{const c=document.querySelector('.crystal-sample');window.__zero=c.getContext('2d').getImageData(0,0,c.width,c.height);document.documentElement.style.setProperty('--crystal-displacement','6');document.documentElement.style.setProperty('--crystal-corner-displacement','12');});await page.waitForTimeout(200);
   await page.evaluate(()=>{const c=document.querySelector('.crystal-sample');window.__bent=c.getContext('2d').getImageData(0,0,c.width,c.height);document.documentElement.style.setProperty('--crystal-dispersion','3');});await page.waitForTimeout(200);
   report.measurements.pixels=await page.evaluate(()=>{
    const c=document.querySelector('.crystal-sample'),after=c.getContext('2d').getImageData(0,0,c.width,c.height),r=parseFloat(getComputedStyle(c.parentElement).borderTopLeftRadius);
    const sample=(x,y)=>{const qx=Math.abs(x-c.width/2)-(c.width/2-r),qy=Math.abs(y-c.height/2)-(c.height/2-r);return -(Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r);};
    const result={rimSamples:0,rimShiftMean:0,rimDispersionMean:0,coreSamples:0,coreShiftMax:0,coreDispersionMax:0};
    for(let y=1;y<c.height-1;y++)for(let x=1;x<c.width-1;x++){
     const inside=sample(x+.5,y+.5),i=(y*c.width+x)*4;
     const shift=Math.max(...[0,1,2].map(k=>Math.abs(__bent.data[i+k]-__zero.data[i+k])));
     const split=Math.max(...[0,1,2].map(k=>Math.abs(after.data[i+k]-__bent.data[i+k])));
     if(inside>3&&inside<22){result.rimSamples++;result.rimShiftMean+=shift;result.rimDispersionMean+=split;}
     if(inside>42){result.coreSamples++;result.coreShiftMax=Math.max(result.coreShiftMax,shift);result.coreDispersionMax=Math.max(result.coreDispersionMax,split);}
    }
    result.rimShiftMean/=result.rimSamples;result.rimDispersionMean/=result.rimSamples;return result;
   });
   const m=report.measurements.pixels;assert.ok(m.rimShiftMean>8,JSON.stringify(m));assert.ok(m.rimDispersionMean>.15,JSON.stringify(m));assert.equal(m.coreShiftMax,0);assert.equal(m.coreDispersionMax,0);
   await shot('calibration-refracted');await shot('calibration-refracted-card','#homeChatOpen');
  });
  await check('Idle renderer stops; pixel budget bounded',async()=>{
   await go();const a=await page.evaluate(()=>NapaCrystal.status());await page.waitForTimeout(700);const b=await page.evaluate(()=>NapaCrystal.status());
   assert.equal(a.draws,b.draws);assert.ok(b.maxPixels<=650000);assert.equal(b.canvases,3);report.measurements.idle=b;
  });
  await check('Living reflection still responds without shader redraw',async()=>{
   await go();const box=await page.locator('#homeChatOpen').boundingBox(),draws=await page.evaluate(()=>NapaCrystal.status().draws);
   await page.mouse.move(box.x+75,box.y+2);await page.waitForTimeout(800);
   const position=await page.locator('#homeChatOpen').evaluate(el=>el.style.getPropertyValue('--napa-light-x'));
   assert.ok(position);await shot('edge-hover','#homeChatOpen');
   const settled=await page.evaluate(()=>NapaCrystal.status().draws);await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>NapaCrystal.status().draws),settled);
   report.measurements.interaction={position,drawsBefore:draws,drawsAfterTransform:settled};
  });
  for(const width of [390,768])await check('Responsive bounds / '+width,async()=>{
   await page.setViewportSize({width,height:844});await go('scene=home&stageb=1');const before=await bounds();
   await go();const after=await bounds();for(let i=0;i<3;i++)for(let j=0;j<4;j++)assert.ok(Math.abs(before[i][j]-after[i][j])<1);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot('home-'+width);
   await go('scene=chat');assert.ok(await page.locator('.composer').isVisible());assert.ok(await page.evaluate(()=>document.querySelector('.composer').getBoundingClientRect().bottom<=document.querySelector('#mobileNav').getBoundingClientRect().top+1));
   await page.setViewportSize({width:1440,height:960});
  });
  await check('Simplified mode and high contrast preserve navigation',async()=>{
   await go('scene=home&crystal=off');assert.equal(await page.locator('.crystal-ready').count(),0);
   await page.locator('#homeForumOpen').click();assert.ok(await page.evaluate(()=>document.body.classList.contains('view-forum')));
   await go();await page.emulateMedia({contrast:'more'});await page.waitForTimeout(150);assert.equal(await page.locator('.crystal-ready').count(),0);
   await page.emulateMedia({contrast:'no-preference',reducedMotion:'reduce'});await page.waitForTimeout(300);assert.equal(await page.locator('.crystal-ready').count(),3);
   await page.emulateMedia({reducedMotion:'no-preference'});
  });
  await check('WebGL unavailable / context loss / restoration',async()=>{
   const p=await context.newPage();await p.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(type==='webgl')return null;return original.call(this,type,...args)}});
   await p.goto(base+'/?scene=home&capture=1');await p.waitForTimeout(1200);assert.equal(await p.locator('.crystal-ready').count(),0);assert.equal(await p.locator('.crystal-fallback').count(),3);await p.locator('#homeSettingsOpen').click();await p.waitForFunction(()=>document.body.classList.contains('view-workspace'));await p.close();
   const q=await context.newPage();await q.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){const value=original.call(this,type,...args);if(type==='webgl')window.__testGL=value;return value;}});
   await q.goto(base+'/?scene=home&capture=1');await q.waitForFunction(()=>document.querySelectorAll('.crystal-ready').length===3);
   await q.evaluate(()=>{window.__loss=__testGL.getExtension('WEBGL_lose_context');__loss.loseContext()});await q.waitForFunction(()=>document.querySelectorAll('.crystal-ready').length===0);
   await q.evaluate(()=>__loss.restoreContext());await q.waitForFunction(()=>document.querySelectorAll('.crystal-ready').length===3);await q.close();
  });
  await check('Existing glass preference and login/chat layouts',async()=>{
   await go();for(const level of [0,100]){await page.evaluate(level=>applyGlassIntensity(level,false),level);await page.waitForTimeout(200);assert.equal(await page.locator('.crystal-ready').count(),3);}
   for(const scene of ['login','chat']){await go('scene='+scene+'&stageb=1');const selector=scene==='login'?'.login-panel':'.composer',old=await page.locator(selector).boundingBox();await go('scene='+scene);const now=await page.locator(selector).boundingBox();for(const k of ['x','y','width','height'])assert.ok(Math.abs(old[k]-now[k])<1);assert.equal(await page.locator('.crystal-ready').count(),0);}
  });
  assert.deepEqual(report.errors,[]);
 }finally{save();await browser.close();}
 console.log(JSON.stringify({passed:report.checks.filter(c=>c.pass).length,failed:report.checks.filter(c=>!c.pass),errors:report.errors}));
 if(report.checks.some(c=>!c.pass)||report.errors.length)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1});
