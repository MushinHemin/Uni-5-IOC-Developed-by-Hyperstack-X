const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
function viewport(){
 const frames=new Map(),styles=new Map(),classes=new Set(),listeners={},root={clientHeight:844,style:{getPropertyValue:k=>styles.get(k)||'',setProperty:(k,v)=>styles.set(k,v),removeProperty:k=>styles.delete(k)},classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),toggle:(k,v)=>v?classes.add(k):classes.delete(k)}};
 let next=0,scrolls=0,near=true,observer;
 const field={},query={matches:true,addEventListener:(n,fn)=>listeners['media:'+n]=fn};
 const c={document:{documentElement:root,activeElement:null,addEventListener:(n,fn)=>listeners[n]=fn},window:{innerWidth:390,innerHeight:844,matchMedia:()=>query,visualViewport:{height:844,offsetTop:0,scale:1,addEventListener:(n,fn)=>listeners['visual:'+n]=fn},addEventListener:(n,fn)=>listeners['window:'+n]=fn,ResizeObserver:true},composer:{contains:x=>x===field},state:{view:'chat'},messagesDiv:{addEventListener:(n,fn)=>listeners['messages:'+n]=fn},mobileNav:{},requestAnimationFrame:fn=>{frames.set(++next,fn);return next},scrollToBottom:()=>scrolls++,isNearBottom:()=>near,ResizeObserver:class{constructor(fn){observer=fn}observe(){}}};
 vm.createContext(c);const start=html.indexOf('    let mobileViewportFrame'),end=html.indexOf("    window.addEventListener('resize', () => {",start);vm.runInContext(html.slice(start,end),c);
 const flush=()=>{for(let i=0;i<8&&frames.size;i++){const list=[...frames.values()];frames.clear();list.forEach(fn=>fn())}};
 return {c,root,field,query,styles,classes,frames,listeners,flush,scrolls:()=>scrolls,near:v=>near=v,observe:v=>observer([{borderBoxSize:[{blockSize:v}]}])};
}
test('U19 visual viewport updates are coalesced; keyboard opening/closing and offset stay synchronized',()=>{
 const v=viewport();v.flush();assert.equal(v.styles.get('--app-viewport-height'),'844px');
 v.c.document.activeElement=v.field;v.c.window.visualViewport.height=440;v.c.window.visualViewport.offsetTop=24;
 for(let i=0;i<12;i++)v.listeners['visual:resize']();assert.equal(v.frames.size,1);v.flush();
 assert.equal(v.styles.get('--app-viewport-height'),'440px');assert.equal(v.styles.get('--app-viewport-top'),'24px');assert.equal(v.classes.has('is-chat-keyboard-open'),true);
 v.c.window.visualViewport.height=844;v.c.window.visualViewport.offsetTop=0;v.listeners['visual:resize']();v.flush();assert.equal(v.classes.has('is-chat-keyboard-open'),false);
});
test('U19 layout-resizing keyboards, orientation, desktop and no-VisualViewport fallback',()=>{
 const v=viewport();v.flush();v.c.document.activeElement=v.field;v.root.clientHeight=420;v.c.window.visualViewport.height=420;v.listeners['window:resize']();v.flush();assert.equal(v.classes.has('is-chat-keyboard-open'),true);
 v.c.window.innerWidth=768;v.root.clientHeight=390;v.c.window.visualViewport.height=390;v.listeners['window:orientationchange']();v.flush();assert.equal(v.classes.has('is-chat-keyboard-open'),false);
 v.query.matches=false;v.listeners['media:change']();v.flush();assert.equal(v.styles.has('--app-viewport-height'),false);
 v.query.matches=true;delete v.c.window.visualViewport;v.c.window.innerHeight=500;v.c.document.activeElement=null;v.c.syncMobileViewport();assert.equal(v.styles.get('--app-viewport-height'),'500px');
});
test('U19 pinch zoom and readers scrolling older messages are not forcibly repositioned',()=>{
 const v=viewport();v.flush();v.near(false);v.listeners['messages:scroll']();const initial=v.scrolls();v.c.window.visualViewport.height=500;v.listeners['visual:resize']();v.flush();assert.equal(v.scrolls(),initial);
 v.c.window.visualViewport.scale=2;v.c.window.visualViewport.height=250;v.c.syncMobileViewport();assert.equal(v.styles.get('--app-viewport-height'),'500px');
 v.c.window.visualViewport.scale=1;v.c.state.view='forum';v.c.document.activeElement=v.field;v.c.syncMobileViewport();assert.equal(v.classes.has('is-chat-keyboard-open'),false);
});
test('U19 measured nav reserve tolerates hidden navigation and zoomed text without resize loops',()=>{
 const v=viewport();v.flush();v.observe(74.2);v.flush();assert.equal(v.styles.get('--mobile-nav-content-height'),'75px');
 v.observe(0);assert.equal(v.styles.get('--mobile-nav-content-height'),'75px');v.observe(74.2);assert.equal(v.frames.size,0);
});
test('U29 Web production manifest excludes historical native tools and agrees with lockfile',()=>{
 const root=path.join(__dirname,'..'),pkg=require(path.join(root,'package.json')),lock=require(path.join(root,'package-lock.json'));
 assert.deepEqual(lock.packages[''].dependencies,pkg.dependencies);assert.deepEqual(lock.packages[''].devDependencies,pkg.devDependencies);
 for(const n of ['@capacitor/cli','@capacitor/core','@capacitor/android']){assert.equal(pkg.dependencies[n],undefined);assert.ok(pkg.devDependencies[n]);assert.equal(lock.packages['node_modules/'+n].dev,true)}
 for(const n of ['express','socket.io','sharp'])assert.ok(pkg.dependencies[n]);
});
