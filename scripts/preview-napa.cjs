/* Local-only Stage B preview. Synthetic transport, no server.js, DB, uploads or credentials. */
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),publicRoot=path.join(root,'public');
const baseline=cp.execFileSync('git',['show','b8c177c:public/index.html'],{cwd:root,encoding:'utf8'});
const allowed=new Set(cp.execFileSync('git',['ls-files','public'],{cwd:root,encoding:'utf8'}).trim().split('\n').map(p=>p.slice(6)));
allowed.add('/styles/napa-optics.css');allowed.add('/scripts/napa-optics.js');allowed.add('/styles/napa-transparency.css');
allowed.add('/styles/napa-crystal.css');allowed.add('/scripts/napa-crystal.js');
allowed.add('/styles/napa-fidelity.css');allowed.add('/scripts/napa-presentation.js');
allowed.add('/styles/uni-call.css');allowed.add('/scripts/uni-call.js');
// Synthetic records only. They are re-created on every page load, never written to disk.
const demoPost={postId:'preview-post',userId:'demo-a',username:'演示同伴 A',title:'Sonoma 的色彩与阅读空间',content:'这是一篇用于界面审查的合成帖子。所有内容均为演示资料。',contentText:'这是一篇用于界面审查的合成帖子。所有内容均为演示资料。',contentHtml:'<p>这是一篇用于界面审查的<strong>合成帖子</strong>。</p><p>保留 Sonoma 的色彩，也为长文和讨论留出清晰的阅读空间。</p>',contentFormat:'html',createdAt:'2026-11-15T08:00:00Z',updatedAt:'2026-11-15T08:00:00Z',commentCount:1,likeCount:3,favoriteCount:1};
const transport=`
window.__previewEvents=[];window.__previewHandlers={};
window.__previewPosts=[${JSON.stringify(demoPost)}];
window.__previewNotifications=[
 {id:'preview-notification-1',type:'forum_comment',title:'你的讨论有了新回复',body:'演示同伴 A 回复了关于 Sonoma 阅读空间的讨论。',targetType:'post',targetId:'preview-post',isRead:false,createdAt:'2026-11-15T09:40:00Z'},
 {id:'preview-notification-2',type:'star_received',title:'一颗新的 Star',body:'演示同伴 B 为你的个人主页点亮了 Star。',targetType:'user',targetId:'demo-b',isRead:false,createdAt:'2026-11-15T08:15:00Z'},
 {id:'preview-notification-3',type:'announcement',title:'本地设计预览',body:'这里的通知、帖子和用户资料全部是合成内容。',targetType:'announcement',targetId:'preview-announcement',isRead:true,createdAt:'2026-11-15T07:30:00Z'}
];
window.io=()=>({connected:true,sendBuffer:[],on(n,fn){__previewHandlers[n]=fn;return this},emit(n,p,ack){
 __previewEvents.push(n);
 queueMicrotask(()=>{
  const respond=(event,payload)=>__previewHandlers[event]?.(payload);
  if(n==='login'||n==='register')window.napaPreviewLogin();
  if(n==='get notifications')respond('notifications',{items:__previewNotifications.filter(i=>!p?.unreadOnly||!i.isRead),unreadCount:__previewNotifications.filter(i=>!i.isRead).length});
  if(n==='mark all notifications read'){__previewNotifications.forEach(i=>i.isRead=true);respond('notification:read_all',{unreadCount:0});}
  if(n==='mark notification read'){const i=__previewNotifications.find(i=>i.id===p);if(i)i.isRead=true;respond('notification:read',{id:p,readAt:'2026-11-15T10:00:00Z'});}
  if(n==='get forum posts')respond('forum posts',{posts:__previewPosts,sort:p?.sort||'latest',filter:p?.filter||'all'});
  if(n==='get forum post')respond('forum post detail',{post:__previewPosts[0],comments:[{commentId:'preview-comment',postId:'preview-post',userId:'demo-b',username:'演示同伴 B',content:'文字清晰，色彩也能保留。这是合成评论。',createdAt:'2026-11-15T09:00:00Z',floor:1,replies:[]}]});
  if(n==='get user profile')respond('user profile',{profile:{id:p,username:p==='demo-me'?'演示用户':'演示同伴 B',displayName:p==='demo-me'?'演示用户':'演示同伴 B',bio:'此资料仅用于本地界面与无障碍验证。',starCount:3,isSelf:p==='demo-me',profileBanner:''}});
  if(n==='get bulletins')respond('bulletins',{items:[{id:'preview-announcement',title:'本地预览说明',content:'这里使用合成内容，未连接生产数据。',createdAt:'2026-11-15T07:30:00Z',category:'system',isRead:true}],unreadCount:0});
  if(n==='chat message'){if(typeof ack==='function')ack({ok:true});respond('chat message',{id:crypto.randomUUID(),roomId:'club-demo',userId:'demo-me',username:'演示用户',type:'text',content:p.content,timestamp:new Date().toISOString()});}
 });return this},volatile:{emit(){}}});`;
const fixture=`
(() => {
 const params=new URLSearchParams(location.search),scene=params.get('scene')||'login';
 if(params.get('crystal')==='off')document.documentElement.dataset.crystalMode='off';
 if(params.get('optics')==='debug')document.documentElement.dataset.crystalProfile='debug';
 if(params.get('optics')==='zero')for(const card of document.querySelectorAll('.home-card'))for(const name of ['--crystal-displacement','--crystal-corner-displacement','--crystal-dispersion'])card.style.setProperty(name,'0');
 window.napaPreviewLogin=()=>{
  __previewHandlers.authSuccess({user:{id:'demo-me',username:'演示用户',displayName:'演示用户',isAdmin:false},apiToken:'synthetic-session-only'});
  const users=[{id:'demo-me',username:'演示用户'},{id:'demo-a',username:'演示同伴 A'},{id:'demo-b',username:'演示同伴 B'}];
  const room={id:'club-demo',name:'Sonoma 设计交流 · 合成会话',joinedCount:3,onlineCount:3};
  state.lobbyRooms=[room];state.lobbyUsers=users;renderLobby();
  __previewHandlers['room joined']({room,messages:[
   {id:'demo-1',userId:'demo-a',username:'演示同伴 A',content:'这里是设计预览，所有对话均为合成内容。'},
   {id:'demo-2',userId:'demo-me',username:'演示用户',content:'熟悉的 Sonoma，新的光学细节。'},
   {id:'demo-3',userId:'demo-b',username:'演示同伴 B',content:'看看输入框的边缘高光，以及导航切换时的连续运动。'},
   {id:'demo-4',userId:'demo-a',username:'演示同伴 A',content:'背景、布局和常用入口都还在原来的位置。'}
  ].map((m,i)=>({...m,roomId:room.id,type:'text',timestamp:new Date(Date.UTC(2026,10,7,1,30+i)).toISOString()}))});
  state.onlineUsers=users;renderOnlineUsers();renderHome();
  if(scene==='forum')openForumPage();else if(scene==='workspace')openWorkspacePage('overview');else setView(['home','lobby'].includes(scene)?scene:'chat');
 };
 __previewHandlers.connect();
 if(scene!=='login')napaPreviewLogin();
 accountInput.value='synthetic_demo';passwordInput.value='synthetic-only';
 setThemeMode(params.get('theme')==='dark'?'dark':'light',false);
 // A separate preview toolbar, not part of shipped product markup or screenshot content.
 const toolbar=document.createElement('nav');toolbar.id='napaPreviewControls';toolbar.setAttribute('aria-label','本地设计预览');
 toolbar.style.cssText='position:fixed;z-index:200;top:4px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:10px;background:#12233be8;color:white;font:11px system-ui;white-space:nowrap;max-width:98vw;overflow:auto';
 const label=document.createElement('span');label.textContent='本地预览 · 仅合成数据';toolbar.append(label);
 const make=(text,changes)=>{const a=document.createElement('a'),q=new URLSearchParams(params);Object.entries(changes).forEach(([k,v])=>q.set(k,v));a.href='/?'+q;a.textContent=text;a.style.cssText='color:#c6e4ff;padding:4px';toolbar.append(a)};
 make('登录',{scene:'login'});make('聊天',{scene:'chat'});make('首页',{scene:'home'});make('论坛',{scene:'forum'});make('我的内容',{scene:'workspace'});make(params.get('stageb')==='1'?'当前版本':'修改前快照',{stageb:params.get('stageb')==='1'?'0':'1'});make(params.get('theme')==='dark'?'浅色':'深色',{theme:params.get('theme')==='dark'?'light':'dark'});
 make(params.get('crystal')==='off'?'开启折射':'关闭折射',{crystal:params.get('crystal')==='off'?'on':'off'});
 make(params.get('calibration')==='1'?'Sonoma 壁纸':'条纹校准',{calibration:params.get('calibration')==='1'?'0':'1'});
 make('自然档',{optics:'natural'});make('夸张调试',{optics:'debug'});make('零位移对照',{optics:'zero'});
 const pathLabel=document.createElement('span');pathLabel.style.cssText='color:#a7efc2;padding-left:6px';toolbar.append(pathLabel);
 let pathTries=0;const showPath=()=>{const s=window.NapaCrystal?.status(),c=s?.cards?.[0];const label=params.get('optics')==='zero'?'零位移对照':s?.profile==='debug'?'夸张调试':'自然档';pathLabel.textContent=s?.renderPath==='webgl1-to-2d'?'WebGL · '+label+(c?' · '+c.straightPeak.toFixed(1)+'/'+c.cornerPeak.toFixed(1)+'px · RGB '+c.redBluePeak+'px · '+c.sampleRatio.toFixed(1)+'×':''):(s?.state||'旧版快照');if(s?.state==='loading'&&++pathTries<30)setTimeout(showPath,150)};setTimeout(showPath,250);
 if(params.get('capture')!=='1')document.body.append(toolbar);
})();`;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const snapshot=process.env.NAPA_BEFORE_DIR;
 if(url.pathname.startsWith('/__stage-b/') && snapshot){
  const rel=url.pathname.slice('/__stage-b/'.length);
  if(!['styles/napa-optics.css','styles/napa-transparency.css','styles/napa-crystal.css','scripts/napa-optics.js','scripts/napa-crystal.js'].includes(rel)){res.writeHead(404);return res.end()}
  res.setHeader('Content-Type',rel.endsWith('.css')?'text/css':'text/javascript');
  let asset=fs.readFileSync(path.join(snapshot,'public',rel),'utf8');
  if(url.searchParams.get('calibration')==='1')asset=asset.replaceAll('/assets/backgrounds/sonoma.jpg','/assets/backgrounds/sonoma.jpg?calibration=1');
  return res.end(asset);
 }
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET'){res.writeHead(405);return res.end('Preview is read-only')}
 // Local synthetic optical calibration: identical source for CSS and shader.
 // The shipped product can only sample the original same-origin Sonoma asset.
 if(url.pathname==='/assets/backgrounds/sonoma.jpg' && url.searchParams.get('calibration')==='1'){
  res.setHeader('Content-Type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="2400"><defs><pattern id="p" width="80" height="80" patternUnits="userSpaceOnUse"><rect width="80" height="80" fill="#152d55"/><rect width="40" height="80" fill="#f8e6a2"/><path d="M0 0H80M0 40H80" stroke="#80d5d9" stroke-width="3"/></pattern></defs><rect width="2400" height="2400" fill="url(#p)"/></svg>');
 }
 if(url.pathname==='/socket.io/socket.io.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(transport)}
 if(url.pathname.startsWith('/api/')){
  res.setHeader('Content-Type','application/json');
  const stats={posts:1,comments:1,replies:0,favorites:1,unreadNotifications:2,stars:3};
  const items=/\/(posts|favorites)$/.test(url.pathname)?[demoPost]:[];
  return res.end(JSON.stringify({items,stats,recentPosts:[demoPost],recentComments:[],recentReplies:[],isSelf:url.pathname.includes('demo-me')}));
 }
 if(url.pathname==='/'){
  let html=url.searchParams.get('baseline')==='1'?baseline:fs.readFileSync(path.join(publicRoot,'index.html'),'utf8');
  if(url.searchParams.get('stageb')==='1' && snapshot){html=fs.readFileSync(path.join(snapshot,'public/index.html'),'utf8');for(const rel of ['styles/napa-optics.css','styles/napa-transparency.css','styles/napa-crystal.css','scripts/napa-optics.js','scripts/napa-crystal.js'])html=html.replaceAll('/'+rel,'/__stage-b/'+rel);}
  if(url.searchParams.get('calibration')==='1')html=html.replace('/styles/napa-transparency.css"','/styles/napa-transparency.css?calibration=1"').replace('/scripts/napa-crystal.js"','/scripts/napa-crystal.js?calibration=1"');
  res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html.replace('</body>','<script>'+fixture+'</script></body>'));
 }
 let rel;try{rel=decodeURIComponent(url.pathname)}catch{res.writeHead(400);return res.end()}
 if(!allowed.has(rel)){res.writeHead(404);return res.end('Not a preview asset')}
 const file=path.resolve(publicRoot,'.'+rel);
 if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end()}
 res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.json')?'application/json':file.endsWith('.jpg')?'image/jpeg':'application/octet-stream');
 if(url.searchParams.get('calibration')==='1' && ['/styles/napa-transparency.css','/scripts/napa-crystal.js'].includes(rel))return res.end(fs.readFileSync(file,'utf8').replaceAll('/assets/backgrounds/sonoma.jpg','/assets/backgrounds/sonoma.jpg?calibration=1'));
 fs.createReadStream(file).pipe(res);
});
if(require.main===module){server.listen(Number(process.env.NAPA_PREVIEW_PORT||8856),'127.0.0.1',()=>console.log('Synthetic Napa Valley preview: http://127.0.0.1:'+server.address().port));}
module.exports={server};
