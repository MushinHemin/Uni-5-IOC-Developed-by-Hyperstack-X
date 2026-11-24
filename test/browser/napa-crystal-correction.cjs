/* Bounded optical correction evidence: synthetic local preview, no user data. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.UNI_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.NAPA_PREVIEW_URL||'http://127.0.0.1:8862';
const out=path.resolve(process.env.UNI_VISUAL_OUTPUT||'/tmp/crystal-correction');
const result={checks:[],errors:[],measurements:{}};fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.UNI_BROWSER_EXECUTABLE?{executablePath:process.env.UNI_BROWSER_EXECUTABLE}:{})});
 const check=async(name,fn)=>{try{await fn();result.checks.push({name,pass:true})}catch(e){result.checks.push({name,pass:false,error:e.message})}fs.writeFileSync(path.join(out,'correction-validation.json'),JSON.stringify(result,null,2))};
 for(const dpr of [1,2]){
  const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:dpr});page.on('pageerror',e=>result.errors.push(e.message));
  const go=async(q)=>{await page.goto(base+'/?scene=home&capture=1&'+q);await page.waitForTimeout(1200)};
  await check('Actual WebGL and CSS-pixel parameters / DPR '+dpr,async()=>{
   await go('optics=natural');const s=await page.evaluate(()=>NapaCrystal.status());
   assert.equal(s.renderPath,'webgl1-to-2d');assert.equal(s.cards.length,3);
   for(const c of s.cards){assert.equal(c.band,22);assert.equal(c.straightPeak,6);assert.equal(c.cornerPeak,12);assert.equal(c.redBluePeak,3);assert.equal(c.sampleRatio,dpr===1?1:1.5)}
   result.measurements['path-dpr'+dpr]=s;
  });
  await check('Same stripe changes coordinates / DPR '+dpr,async()=>{
   await go('calibration=1&optics=zero');
   await page.evaluate(()=>{const c=document.querySelector('.crystal-sample');window.__zero=c.getContext('2d').getImageData(0,0,c.width,c.height);
    document.documentElement.style.setProperty('--crystal-displacement','6');document.documentElement.style.setProperty('--crystal-corner-displacement','12');});await page.waitForTimeout(180);
   await page.evaluate(()=>{const c=document.querySelector('.crystal-sample');window.__refracted=c.getContext('2d').getImageData(0,0,c.width,c.height);document.documentElement.style.setProperty('--crystal-dispersion','3');});await page.waitForTimeout(180);
   const metrics=await page.evaluate(()=>{
    const c=document.querySelector('.crystal-sample'),el=c.parentElement,ratio=c.width/el.clientWidth,r=parseFloat(getComputedStyle(el).borderTopLeftRadius),after=c.getContext('2d').getImageData(0,0,c.width,c.height);
    const borderDistance=(x,y)=>{const qx=Math.abs(x-el.clientWidth/2)-(el.clientWidth/2-r),qy=Math.abs(y-el.clientHeight/2)-(el.clientHeight/2-r);return r-Math.hypot(Math.max(qx,0),Math.max(qy,0))-Math.min(Math.max(qx,qy),0)};
    const crossings=(data,y)=>{
     const row=Math.round(y*ratio),found=[];
     for(let x=1;x<(r+15)*ratio;x++){
      const i=(row*c.width+x)*4,previous=i-4;if(data.data[i+3]<250||data.data[previous+3]<250)continue;
      const a=data.data[previous]-data.data[previous+1],b=data.data[i]-data.data[i+1];
      if(a<=0&&b>0)found.push((x-1+(0-a)/(b-a))/ratio);
     }return found;
    };
    const points=[];
    for(let y=6;y<r-2;y+=2){
     const original=crossings(__zero,y).filter(x=>x<r&&borderDistance(x,y)>2&&borderDistance(x,y)<22);
     const moved=crossings(__refracted,y);
     if(original.length&&moved.length){const x=original[0],x2=moved.reduce((a,b)=>Math.abs(a-x)<Math.abs(b-x)?a:b);if(Math.abs(x2-x)<14)points.push({y,offX:+x.toFixed(3),onX:+x2.toFixed(3),shift:+(x2-x).toFixed(3)})}
    }
    let rimCount=0,splitSum=0,coreShift=0,coreSplit=0;
    for(let y=0;y<c.height;y+=2)for(let x=0;x<c.width;x+=2){const d=borderDistance((x+.5)/ratio,(y+.5)/ratio),i=(y*c.width+x)*4;
     const delta=Math.max(...[0,1,2].map(k=>Math.abs(__zero.data[i+k]-__refracted.data[i+k]))),split=Math.max(...[0,1,2].map(k=>Math.abs(after.data[i+k]-__refracted.data[i+k])));
     if(d>3&&d<22){rimCount++;splitSum+=split}if(d>42){coreShift=Math.max(coreShift,delta);coreSplit=Math.max(coreSplit,split)}
    }
    window.__withRim=after;return {points,maxShift:Math.max(...points.map(p=>Math.abs(p.shift))),rimDispersionMean:splitSum/rimCount,coreShift,coreSplit};
   });
   result.measurements['coordinates-dpr'+dpr]=metrics;
   assert.ok(metrics.points.length>=5,JSON.stringify(metrics));assert.ok(metrics.maxShift>=3&&metrics.maxShift<14);assert.ok(metrics.rimDispersionMean>1);assert.equal(metrics.coreShift,0);assert.equal(metrics.coreSplit,0);
   // Lighting must also vanish at the core, not leave normal-dependent facets.
   await page.evaluate(()=>document.documentElement.style.setProperty('--crystal-rim-relief','0'));await page.waitForTimeout(180);
   const coreLight=await page.evaluate(()=>{const c=document.querySelector('.crystal-sample'),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data,ratio=c.width/c.parentElement.clientWidth;let max=0;for(let y=Math.ceil(44*ratio);y<c.height-44*ratio;y+=3)for(let x=Math.ceil(44*ratio);x<c.width-44*ratio;x+=3){const i=(y*c.width+x)*4;for(let k=0;k<3;k++)max=Math.max(max,Math.abs(data[i+k]-__withRim.data[i+k]))}return max});
   assert.equal(coreLight,0);metrics.coreLightingDifference=coreLight;
  });
  if(dpr===1)await check('Natural/debug/before screenshots at 100 percent',async()=>{
   for(const [name,q] of [['before-home','stageb=1'],['debug-home','optics=debug'],['natural-home','optics=natural'],['natural-dark','theme=dark'],['natural-grid','calibration=1'],['zero-grid','calibration=1&optics=zero'],['debug-grid','calibration=1&optics=debug']]){
    await go(q);assert.equal(await page.evaluate(()=>visualViewport.scale),1);
    if(name.startsWith('debug')){const s=await page.evaluate(()=>NapaCrystal.status());assert.equal(s.cards[0].straightPeak,16);assert.equal(s.cards[0].cornerPeak,28);assert.equal(s.cards[0].redBluePeak,7.2)}
    await page.screenshot({path:path.join(out,name+'.png')});await page.locator('#homeChatOpen').screenshot({path:path.join(out,name+'-card.png')});
   }
  });
  await page.close();
 }
 await check('DPR changes sampling resolution, not displacement scale',async()=>{
  const a=result.measurements['coordinates-dpr1'],b=result.measurements['coordinates-dpr2'];assert.ok(Math.abs(a.maxShift-b.maxShift)<1.25);
 });
 await browser.close();fs.writeFileSync(path.join(out,'correction-validation.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({passed:result.checks.filter(c=>c.pass).length,failed:result.checks.filter(c=>!c.pass),errors:result.errors}));
 if(result.checks.some(c=>!c.pass)||result.errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
