/* Liquid Crystal: bounded, on-demand wallpaper resampling. Never samples DOM text,
   user images, credentials or network content. One shared WebGL 1 context, three
   retained 2D presentation canvases. No dependency, idle loop or per-frame readback. */
(() => {
  'use strict';
  const root = document.documentElement;
  const cards = [...document.querySelectorAll('.home-card')];
  if (!cards.length) return;
  const reduce = matchMedia('(prefers-reduced-motion:reduce)');
  const contrast = matchMedia('(prefers-contrast:more), (forced-colors:active)');
  const small = matchMedia('(max-width:820px)');
  const source = '/assets/backgrounds/sonoma.jpg';
  let image, samplePixels, renderer, frame = 0, timer = 0, stopped = false, pending = false;
  const stats = { draws:0, batches:0, state:'loading', maxPixels:0, lastBatchMs:0 };
  const surfaces = cards.map(el => {
    const canvas = document.createElement('canvas');
    canvas.className = 'crystal-sample';canvas.setAttribute('aria-hidden','true');
    el.prepend(canvas);
    return {el,canvas,ctx:canvas.getContext('2d'),visible:false};
  });
  const vertex = `attribute vec2 position;varying vec2 uv;
    void main(){uv=vec2(position.x*.5+.5,.5-position.y*.5);gl_Position=vec4(position,0.,1.);}`;
  const fragment = `precision highp float;
    varying vec2 uv;
    uniform sampler2D wallpaper;
    uniform vec2 size, imageSize, imageOrigin, imageExtent;
    uniform vec4 rect, textRect, metaRect;
    uniform float radius, band, strength, cornerStrength, dispersion, relief, softness, dark, textLight, metaLight;
    float sd(vec2 p,vec2 halfSize,float r){vec2 q=abs(p)-halfSize+r;
      return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
    vec3 sampleAt(vec2 screen){return texture2D(wallpaper,(screen-imageOrigin)/imageExtent).rgb;}
    vec3 linearColor(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
    vec3 srgb(vec3 c){return mix(c*12.92,1.055*pow(max(c,0.),vec3(1./2.4))-.055,step(vec3(.0031308),c));}
    float luminance(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
    float readingMask(vec2 p,vec4 r){
      vec2 outside=max(max(r.xy-p,p-r.zw),0.);
      return 1.-smoothstep(4.,38.,length(outside));
    }
    vec3 protect(vec3 c,float lightInk){
      float l=luminance(c);
      // Protect white ink by lowering luminance only. Dark ink is chosen solely on
      // already bright zones; a local luminance floor handles unsampled fine detail.
      if(lightInk>.5)return c*min(1.,.135/max(l,.0001));
      return mix(c,vec3(1.),max(0.,(.245-l)/max(1.-l,.0001)));
    }
    void main(){
      vec2 p=uv*size,centered=p-size*.5;
      float distance=sd(centered,size*.5,radius),inside=-distance;
      if(distance>0.){gl_FragColor=vec4(0.);return;}
      vec2 q=abs(centered)-(size*.5-radius);
      vec2 normal=q.x>0.&&q.y>0.?normalize(q)*sign(centered):
        (q.x>q.y?vec2(sign(centered.x),0.):vec2(0.,sign(centered.y)));
      float corner=min(abs(normal.x),abs(normal.y))*1.41421356;
      // A continuous polished shoulder: displacement grows across the outer
      // quarter, holds over the curved face, then returns to zero at the core.
      float t=clamp(inside/band,0.,1.);
      float edge=smoothstep(0.,.23,t)*(1.-smoothstep(.43,1.,t));
      vec2 offset=normal*mix(strength,cornerStrength,corner)*edge;
      // Uniform is total R/B separation. Channel samples follow the same normal;
      // dispersion peaks only where refraction is strong, especially at corners.
      vec2 split=normal*.5*dispersion*pow(edge,1.35)*(.5+.5*corner);
      vec2 screen=rect.xy+uv*rect.zw;
      vec3 color=vec3(sampleAt(screen+offset+split).r,sampleAt(screen+offset).g,sampleAt(screen+offset-split).b);
      // Small symmetric diffusion in the undistorted core, never a white fill.
      // Do not dilute the refracted samples with unshifted core samples.
      float core=smoothstep(band,band+8.,inside);
      vec3 soft=(sampleAt(screen+vec2(softness,0.))+sampleAt(screen-vec2(softness,0.))+
        sampleAt(screen+vec2(0.,softness))+sampleAt(screen-vec2(0.,softness)))*.25;
      color=mix(color,soft,core*.55);
      vec3 linear=linearColor(color);
      linear*=mix(.98,.84,dark);
      // Directional bevel reflection and shadow, confined to a narrow optical rim.
      float light=dot(normal,normalize(vec2(-.55,-.85)));
      float silhouette=exp(-pow((inside-.8)/.7,2.));
      float shoulder=exp(-pow((t-.22)/.17,2.));
      float inner=exp(-pow((t-.77)/.15,2.));
      float returnLight=exp(-pow((t-.94)/.07,2.));
      float rimLimit=1.-smoothstep(.90,1.,t);
      // Reflection spans the curved face; the darker inner shoulder supplies
      // volume over ~18 CSS px, rather than two bright contour strokes.
      float reflection=rimLimit*relief*(silhouette*.11+shoulder*(.035+.20*max(light,0.)));
      linear=mix(linear,vec3(.88,.94,1.),clamp(reflection,0.,.55));
      linear*=1.-rimLimit*min(.55,relief*inner*(.19+.14*max(-light,0.)));
      linear=mix(linear,vec3(.88,.94,1.),rimLimit*returnLight*.055*relief*max(-light,0.));
      linear=mix(linear,protect(linear,textLight),readingMask(p,textRect));
      linear=mix(linear,protect(linear,metaLight),readingMask(p,metaRect));
      gl_FragColor=vec4(srgb(clamp(linear,0.,1.)),smoothstep(0.,.8,inside));
    }`;
  function shader(gl,type,code){
    const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){gl.deleteShader(s);throw Error('Crystal shader unavailable');}return s;
  }
  function makeRenderer(){
    const canvas=document.createElement('canvas');
    const gl=canvas.getContext('webgl',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:false,preserveDrawingBuffer:false,powerPreference:'low-power'});
    if(!gl)throw Error('WebGL unavailable');
    const program=gl.createProgram(),v=shader(gl,gl.VERTEX_SHADER,vertex),f=shader(gl,gl.FRAGMENT_SHADER,fragment);
    gl.attachShader(program,v);gl.attachShader(program,f);gl.linkProgram(program);
    gl.deleteShader(v);gl.deleteShader(f);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Crystal program unavailable');
    gl.useProgram(program);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const attribute=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,2,gl.FLOAT,false,0,0);
    const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    // One texture upload, bounded to <=2048 each side. No per-frame texture upload.
    const textureCanvas=document.createElement('canvas'),ratio=Math.min(1,2048/image.width,2048/image.height,gl.getParameter(gl.MAX_TEXTURE_SIZE)/Math.max(image.width,image.height));
    textureCanvas.width=Math.round(image.width*ratio);textureCanvas.height=Math.round(image.height*ratio);
    textureCanvas.getContext('2d').drawImage(image,0,0,textureCanvas.width,textureCanvas.height);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,textureCanvas);
    const uniforms={};for(const name of ['size','imageSize','imageOrigin','imageExtent','rect','textRect','metaRect','radius','band','strength','cornerStrength','dispersion','relief','softness','dark','textLight','metaLight'])uniforms[name]=gl.getUniformLocation(program,name);
    canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();fallback('context-lost');});
    canvas.addEventListener('webglcontextrestored',()=>{
      renderer?.dispose();renderer=null;stats.state='loading';schedule();
    });
    return {canvas,gl,uniforms,textureSize:[textureCanvas.width,textureCanvas.height],dispose(){gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteProgram(program);}};
  }
  function fallback(reason){
    stats.state=reason;surfaces.forEach(s=>{s.el.classList.remove('crystal-ready');s.el.classList.add('crystal-fallback');});
  }
  function wallpaperMapping(){
    const style=getComputedStyle(document.body,'::before');
    if(!style.backgroundImage.includes(source)||style.backgroundSize!=='cover'||style.backgroundPosition!=='50% 50%')return null;
    // Read actual pseudo-element dimensions, including its -28px inset and 1.02
    // scale. This keeps wallpaper coordinates registered across viewport sizes.
    const width=parseFloat(style.width),height=parseFloat(style.height);
    const matrix=new DOMMatrixReadOnly(style.transform),scale=matrix.a;
    if(!width||!height||matrix.b||matrix.c||matrix.m34||Math.abs(matrix.d-scale)>.001)return null;
    const ratio=Math.max(width/image.width,height/image.height)*scale;
    const extent=[image.width*ratio,image.height*ratio];
    const center=[parseFloat(style.left)+width/2,parseFloat(style.top)+height/2];
    return {origin:[center[0]-extent[0]/2,center[1]-extent[1]/2],extent};
  }
  const toLinear=c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4;
  function lightInk(box,mapping,dark){
    if(dark)return 1;
    let min=1;
    for(let y=0;y<5;y++)for(let x=0;x<9;x++){
      const u=(box.left+box.width*x/8-mapping.origin[0])/mapping.extent[0];
      const v=(box.top+box.height*y/4-mapping.origin[1])/mapping.extent[1];
      const i=(Math.max(0,Math.min(63,Math.round(v*63)))*64+Math.max(0,Math.min(63,Math.round(u*63))))*4;
      const l=.2126*toLinear(samplePixels[i]/255)+.7152*toLinear(samplePixels[i+1]/255)+.0722*toLinear(samplePixels[i+2]/255);
      min=Math.min(min,l);
    }
    return min>.25?0:1;
  }
  function measure(s,mapping,dark){
    const el=s.el,rect=el.getBoundingClientRect(),style=getComputedStyle(el);
    if(rect.width<2||rect.height<2||!s.ctx||!s.visible||el.closest('[hidden]'))return null;
    const width=el.clientWidth,height=el.clientHeight;
    const sx=rect.width/el.offsetWidth,sy=rect.height/el.offsetHeight;
    const r={x:rect.x+el.clientLeft*sx,y:rect.y+el.clientTop*sy,width:width*sx,height:height*sy};
    // Protect the actual text extents, not the full-width grid/flex containers.
    const inkBounds=nodes=>{
      const boxes=nodes.map(node=>{const range=document.createRange();range.selectNodeContents(node);return range.getBoundingClientRect();});
      const left=Math.min(...boxes.map(b=>b.left)),top=Math.min(...boxes.map(b=>b.top));
      const right=Math.max(...boxes.map(b=>b.right)),bottom=Math.max(...boxes.map(b=>b.bottom));
      return {left,top,right,bottom,width:right-left,height:bottom-top};
    };
    const text=inkBounds([...el.querySelectorAll('h3,p')]),meta=inkBounds([...el.querySelectorAll('.home-card-meta span')]);
    const local=b=>[(b.left-r.x)/sx,(b.top-r.y)/sy,(b.right-r.x)/sx,(b.bottom-r.y)/sy];
    const number=(name,value)=>{const n=parseFloat(style.getPropertyValue(name));return Number.isFinite(n)?n:value;};
    const level=Math.max(0,Math.min(1,(parseFloat(getComputedStyle(root).getPropertyValue('--glass-blur-lg'))-10)/12));
    const debug=root.dataset.crystalProfile==='debug';
    return {s,r,width,height,text:local(text),meta:local(meta),textLight:lightInk(text,mapping,dark),metaLight:lightInk(meta,mapping,dark),
      radius:Math.min(parseFloat(style.borderTopLeftRadius)||40,width/2,height/2),
      band:Math.min(24,Math.max(14,number('--crystal-band',22))),
      strength:Math.min(debug?18:6,Math.max(0,number('--crystal-displacement',6))*(.65+.7*level)),
      cornerStrength:Math.min(debug?30:12,Math.max(0,number('--crystal-corner-displacement',12))*(.65+.7*level)),
      dispersion:Math.min(debug?8:3,Math.max(0,number('--crystal-dispersion',3))),
      relief:Math.min(debug?2:1.2,Math.max(0,number('--crystal-rim-relief',1))),
      softness:Math.min(4,Math.max(0,number('--crystal-core-softness',1.8)))*(.5+level)};
  }
  function draw(m,mapping,dark){
    const {s,width,height}=m,{gl,canvas,uniforms:u}=renderer;
    const dpr=Math.min(devicePixelRatio||1,small.matches?1:1.5,Math.sqrt(650000/(width*height)));
    const w=Math.max(1,Math.round(width*dpr)),h=Math.max(1,Math.round(height*dpr));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    gl.viewport(0,0,w,h);
    gl.uniform2f(u.size,width,height);gl.uniform2fv(u.imageOrigin,mapping.origin);gl.uniform2fv(u.imageExtent,mapping.extent);
    gl.uniform4f(u.rect,m.r.x,m.r.y,m.r.width,m.r.height);gl.uniform4fv(u.textRect,m.text);gl.uniform4fv(u.metaRect,m.meta);
    for(const name of ['radius','band','strength','cornerStrength','dispersion','relief','softness','textLight','metaLight'])gl.uniform1f(u[name],m[name]);
    gl.uniform1f(u.dark,dark?1:0);gl.drawArrays(gl.TRIANGLES,0,6);
    if(gl.isContextLost()){fallback('context-lost');return;}
    // Copy in the same task before the non-preserved WebGL buffer is discarded.
    if(s.canvas.width!==w||s.canvas.height!==h){s.canvas.width=w;s.canvas.height=h;}
    s.ctx.clearRect(0,0,w,h);s.ctx.drawImage(canvas,0,0);
    s.el.style.setProperty('--crystal-text-ink',m.textLight?'#f5f9ff':'#0b1c30');
    s.el.style.setProperty('--crystal-meta-ink',m.metaLight?'#f5f9ff':'#0b1c30');
    s.el.classList.remove('crystal-fallback');s.el.classList.add('crystal-ready');stats.draws++;stats.maxPixels=Math.max(stats.maxPixels,w*h);
    s.renderInfo={id:s.el.id,cssSize:[width,height],framebuffer:[w,h],sampleRatio:w/width,
      band:m.band,straightPeak:m.strength,cornerPeak:m.cornerStrength,redBluePeak:m.dispersion,relief:m.relief};
  }
  function render(){
    frame=0;pending=false;if(stopped||document.hidden||!image||!document.body.classList.contains('view-home'))return;
    if(contrast.matches||root.dataset.transparency==='reduced'||root.dataset.crystalMode==='off'||navigator.connection?.saveData||navigator.deviceMemory<4){fallback('simplified');return;}
    if(stats.state==='context-lost'||stats.state==='unavailable')return;
    const mapping=wallpaperMapping();if(!mapping){fallback('unsupported-wallpaper');return;}
    try{
      renderer ||= makeRenderer();
      const start=performance.now(),dark=root.dataset.theme==='dark';
      // Batch all layout reads before writes. No layout reads in a motion loop.
      const measurements=surfaces.map(s=>measure(s,mapping,dark)).filter(Boolean);
      for(const m of measurements){draw(m,mapping,dark);if(stats.state==='context-lost')return;}
      stats.batches++;stats.lastBatchMs=+(performance.now()-start).toFixed(2);stats.state='ready';
    }catch{fallback('unavailable');}
  }
  function schedule(){if(!frame&&!stopped){pending=true;frame=requestAnimationFrame(render);}}
  function afterMovement(){
    // Let compositor transforms run independently; refresh once they settle.
    clearTimeout(timer);timer=setTimeout(schedule,reduce.matches?0:460);
  }
  function afterScroll(){
    // During scrolling use live CSS backdrop sampling; a cached wallpaper must
    // never masquerade as accurately registered moving content.
    surfaces.forEach(s=>{s.el.classList.remove('crystal-ready');s.el.classList.add('crystal-fallback');});afterMovement();
  }
  const visible=new IntersectionObserver(entries=>{for(const entry of entries){const s=surfaces.find(s=>s.el===entry.target);s.visible=entry.isIntersecting;}schedule();});
  const resize=new ResizeObserver(schedule);
  surfaces.forEach(s=>{
    visible.observe(s.el);resize.observe(s.el);
    // Online counts and labels can grow without resizing the card itself.
    s.el.querySelectorAll('h3,p,.home-card-meta span').forEach(el=>resize.observe(el));
  });
  const state=new MutationObserver(afterMovement);state.observe(document.body,{attributes:true,attributeFilter:['class']});
  const theme=new MutationObserver(schedule);theme.observe(root,{attributes:true,attributeFilter:['data-theme','style','data-crystal-mode','data-crystal-profile','data-transparency']});
  window.addEventListener('resize',schedule,{passive:true});
  window.visualViewport?.addEventListener('resize',schedule,{passive:true});
  document.addEventListener('scroll',afterScroll,{capture:true,passive:true});
  for(const event of ['transitionend','animationend'])document.addEventListener(event,e=>{if(e.target.matches('.home-card,.home,.home-shell'))schedule();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
  contrast.addEventListener('change',schedule);small.addEventListener('change',schedule);
  document.fonts?.ready.then(schedule);
  const img=new Image();
  img.onload=()=>{
    image=img;
    const thumbnail=document.createElement('canvas');thumbnail.width=thumbnail.height=64;
    const ctx=thumbnail.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,64,64);
    // One 16KB readback at image load, for conservative text-color selection only.
    samplePixels=ctx.getImageData(0,0,64,64).data;schedule();
  };
  img.onerror=()=>fallback('image-unavailable');img.src=source;
  // Read-only diagnostics; no business/session state is exposed or owned here.
  window.NapaCrystal={status:()=>({...stats,pending,canvases:surfaces.length,scope:'known-sonoma-wallpaper/home-cards',
    renderPath:stats.state==='ready'?'webgl1-to-2d':'css-fallback',profile:root.dataset.crystalProfile==='debug'?'debug':'natural',
    texture:renderer?[...renderer.textureSize]:null,
    cards:surfaces.filter(s=>s.renderInfo).map(s=>({...s.renderInfo}))}),refresh:schedule};
})();
