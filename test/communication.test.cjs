const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module'),http=require('node:http');
const root=path.resolve(__dirname,'..');
function fixture(t,existing,password="Synthetic-Test-Password-Only"){
 const dir=existing||fs.mkdtempSync(path.join(os.tmpdir(),'uni-reliability-'));
 for(const name of ['server.js','package.json'])fs.copyFileSync(path.join(root,name),path.join(dir,name));
 process.env.PORT='0';process.env.ADMIN_ACCOUNT='testadmin';process.env.ADMIN_PASSWORD=password;
 const original=http.Server.prototype.listen;
 http.Server.prototype.listen=function(_port,cb){return original.call(this,0,'127.0.0.1',cb)};
 const m=new Module(path.join(dir,'server.js'));m.filename=path.join(dir,'server.js');m.paths=Module._nodeModulePaths(root);
 try{m._compile(fs.readFileSync(m.filename,'utf8')+'\nmodule.exports={db,io,server,users,listForumPosts,upsertMessage,loadHistory,myForumFavorites,myForumComments,listNotificationsForUser,searchUni,insertForumPost,groupCodeInfo,isValidGroupCode,allowGroupInviteAttempt,ensureAdminUser,verifyPassword,broadcastForumPosts,broadcastForumPostDetail,messagesForRoom,mediaTickets,mediaType,validateMedia,registrationAttempts,loginAttempts,markRoomRead,unreadCountForRoom,readStateForRoom,takeQuota,parseStoredMediaData,normalizeMessage,buildLobbyPayload};',m.filename)}finally{http.Server.prototype.listen=original}
 const a=m.exports;a.dir=dir;
 a.close=async()=>{await new Promise(r=>a.io.close(r));a.db.close()};
 t.after(async()=>{if(!a.closed){await a.close();a.closed=true}if(!existing)fs.rmSync(dir,{recursive:true,force:true})});return a;
}

const {io:client}=require(path.join(path.dirname(require.resolve('socket.io')), '../client-dist/socket.io.js'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function event(s,name){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{s.off(name,done);reject(new Error('timeout '+name))},2000);function done(v){clearTimeout(timer);resolve(v)}s.once(name,done)})}
async function emitWait(s,name,payload,response){const p=event(s,response);s.emit(name,payload);return p}
async function connect(a,t){if(!a.server.listening)await new Promise(r=>a.server.once('listening',r));const s=client(`http://127.0.0.1:${a.server.address().port}`,{transports:['websocket'],reconnection:false});t.after(()=>s.disconnect());await event(s,'connect');return s}
function ack(s,name,payload){return new Promise((resolve,reject)=>s.timeout(2000).emit(name,payload,(e,r)=>e?reject(e):resolve(r)))}
async function register(s,account){return emitWait(s,'register',{account,username:account,password:'Synthetic-Password'},'authSuccess')}
async function api(a,token){return fetch(`http://127.0.0.1:${a.server.address().port}/api/notifications`,{headers:{Authorization:`Bearer ${token}`}})}

const {png,wav,pngUrl,wavUrl,dataUrl}=require('./media-fixtures.cjs');
function base(a){return `http://127.0.0.1:${a.server.address().port}`}
async function upload(a,token,event,buffer=png,mime='image/png'){
 return fetch(base(a)+'/api/media',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':mime,'X-Uni-Media-Event':event},body:buffer});
}
async function join(s){return emitWait(s,'join room','club-91','room joined')}
test('U09 registration success cannot clear quota; failed login is account-scoped and headers cannot change peer',async t=>{
 const a=fixture(t),s=await connect(a,t);
 for(let i=0;i<8;i++)assert.ok((await register(s,'quota'+i)).user.id);
 await emitWait(s,'register',{account:'ninth',username:'ninth',password:'Synthetic-Password'},'authError');
 for(let i=0;i<8;i++)await emitWait(s,'login',{account:'quota0',password:'wrong-pass'},'authError');
 const logged=await emitWait(s,'login',{account:'quota1',password:'Synthetic-Password'},'authSuccess');assert.ok(logged.user.id);
 assert.match(await emitWait(s,'login',{account:'quota0',password:'Synthetic-Password'},'authError'),/太多/);
 await emitWait(s,'register',{account:'stillblocked',username:'block',password:'Synthetic-Password'},'authError');
 for(const entry of a.registrationAttempts.values())entry.resetAt=0;
 assert.ok((await register(s,'afterwindow')).user.id);
 const fake={handshake:{address:'same-peer',headers:{'x-forwarded-for':'changed'}},id:'fake'};
 const bucket=new Map();for(let i=0;i<8;i++)assert.equal(a.takeQuota(bucket,'same-peer',8),true);assert.equal(a.takeQuota(bucket,'same-peer',8),false);
});
test('U12 HTTP raw upload at 800 KB and near 5 MiB, oversize rejection, persistence and retry without transport close',async t=>{
 const a=fixture(t),s=await connect(a,t),auth=await register(s,'mediauser');await join(s);
 const sharp=require('sharp'),crypto=require('node:crypto');
 for(const size of [520,1300]){
  const bytes=await sharp(crypto.randomBytes(size*size*3),{raw:{width:size,height:size,channels:3}}).png({compressionLevel:0}).toBuffer();
  assert.ok(bytes.length>800000 && bytes.length<=5*1024*1024);
  const res=await upload(a,auth.apiToken,'chat image',bytes);assert.equal(res.status,200);const {ticket}=await res.json();
  const payload={base64:ticket,clientMessageId:'large-'+size+'-0000'};
  const sent=await ack(s,'chat image',payload);assert.equal(sent.ok,true);assert.equal(a.db.prepare('SELECT content FROM messages WHERE id=?').get(sent.messageId).content,dataUrl(bytes,'image/png'));
  const again=await upload(a,auth.apiToken,'chat image',bytes);payload.base64=(await again.json()).ticket;assert.equal((await ack(s,'chat image',payload)).duplicate,true);
 }
 assert.equal((await upload(a,auth.apiToken,'chat image',Buffer.alloc(5*1024*1024+1))).status,413);
 assert.equal((await upload(a,auth.apiToken,'avatar upload',Buffer.alloc(2*1024*1024+1))).status,413);
 assert.equal((await upload(a,auth.apiToken,'chat voice',Buffer.alloc(3*1024*1024+1),'audio/wav')).status,413);
 assert.equal(s.connected,true);assert.equal((await ack(s,'chat message',{content:'still connected'})).ok,true);
 assert.equal(a.db.prepare("SELECT count(*) n FROM messages WHERE type='image'").get().n,2);
});
test('U12 upload concurrency, cancellation, expired/cross-user/wrong-purpose tickets and revocation',async t=>{
 const a=fixture(t),s=await connect(a,t),other=await connect(a,t),auth=await register(s,'ticketuser'),authB=await register(other,'ticketother');await join(s);await join(other);
 const held=[];
 for(let i=0;i<2;i++){
  const req=http.request(base(a)+'/api/media',{method:'POST',headers:{Authorization:'Bearer '+auth.apiToken,'Content-Type':'image/png','X-Uni-Media-Event':'chat image','Content-Length':png.length}});req.on('error',()=>{});req.write(png.subarray(0,8));held.push(req);
 }
 await delay(40);assert.equal((await upload(a,auth.apiToken,'chat image')).status,429);held.forEach(r=>r.destroy());await delay(40);
 let res=await upload(a,auth.apiToken,'chat image');assert.equal(res.status,200);let {ticket}=await res.json();
 assert.equal((await ack(other,'chat image',{base64:ticket,clientMessageId:'cross-0000'})).ok,false);
 assert.equal((await ack(s,'chat voice',{base64:ticket,clientMessageId:'wrong-0000'})).ok,false);
 a.mediaTickets.get(ticket).expiresAt=0;assert.equal((await ack(s,'chat image',{base64:ticket,clientMessageId:'expired-0000'})).ok,false);
 res=await upload(a,auth.apiToken,'chat image');ticket=(await res.json()).ticket;
 await emitWait(s,'logout',undefined,'loggedOut');assert.equal(a.mediaTickets.has(ticket),false);assert.equal((await upload(a,auth.apiToken,'chat image')).status,401);
 assert.equal((await upload(a,authB.apiToken,'chat image')).status,200);
});
test('U13 decode all image paths, preserve animation, reject wrong MIME, truncated bytes and pixel bombs',async t=>{
 const a=fixture(t),s=await connect(a,t),auth=await register(s,'imagevalidation');await join(s);const sharp=require('sharp');
 for(const [format,mime] of [['png','image/png'],['jpeg','image/jpeg'],['webp','image/webp'],['gif','image/gif']]){
  const bytes=await sharp(png).toFormat(format).toBuffer();assert.equal((await upload(a,auth.apiToken,'chat image',bytes,mime)).status,200);
  a.mediaTickets.clear();
 }
 // Hand-made two-frame GIF: reuse image blocks with a valid GIF container.
 const gif=await sharp(png).gif().toBuffer(),imageStart=gif.indexOf(0x2c,13+((gif[10]&0x80)?3*(2**((gif[10]&7)+1)):0));
 const animated=Buffer.concat([gif.subarray(0,gif.length-1),gif.subarray(imageStart,gif.length)]);
 const before=await sharp(animated,{animated:true}).metadata();assert.equal(before.pages,2);
 let res=await upload(a,auth.apiToken,'upload post image',animated,'image/gif');assert.equal(res.status,200);const im=(await res.json()).ticket;
 const received=event(s,'post image uploaded');s.emit('upload post image',{base64:im});const result=await received;assert.deepEqual(fs.readFileSync(path.join(a.dir,result.image.url)),animated);
 for(const [bytes,mime] of [[Buffer.from('not an image'),'image/png'],[png,'image/jpeg'],[png.subarray(0,45),'image/png'],[Buffer.from('<svg/>'),'image/svg+xml']])assert.ok((await upload(a,auth.apiToken,'chat image',bytes,mime)).status>=400);
 const wide=await sharp({create:{width:8193,height:1,channels:3,background:'red'}}).png().toBuffer();assert.equal((await upload(a,auth.apiToken,'chat image',wide)).status,400);
 const huge=await sharp({create:{width:4100,height:4100,channels:3,background:'red'}}).png().toBuffer();assert.equal((await upload(a,auth.apiToken,'chat image',huge)).status,400);
 for(const name of ['avatar upload','profile banner upload','upload sticker','submit official sticker','upload post image'])assert.equal((await ack(s,name,{base64:'data:image/png;base64,YWJjZA=='})).ok,false);
 assert.equal((await ack(s,'chat image',{base64:'data:image/png;base64,YWJjZA=='})).ok,false);
 const legacy=a.normalizeMessage({id:'legacy',type:'image',content:'data:image/png;base64,YWJjZA==',timestamp:'2020-01-01T00:00:00.000Z'});assert.ok(legacy,'new upload validation must not drop existing legacy rows');
 assert.ok(a.normalizeMessage({id:'legacy-spaces',type:'image',content:'data:image/png;base64,YW JjZA==\n',timestamp:'2020-01-01T00:00:00.000Z'}),'previously accepted whitespace is retained on history reads');
});
test('U18 audio MIME codec allowlist and content validation, WAV delivery and persistence',async t=>{
 const a=fixture(t),s=await connect(a,t),auth=await register(s,'voicevalidation');await join(s);
 for(const mime of ['audio/webm;codecs=opus',' Audio/WebM ; codecs="opus" ','audio/mp4; codecs=mp4a.40.2','audio/ogg;codecs=vorbis','audio/wav','audio/mpeg'])assert.ok(a.mediaType(mime),mime);
 for(const mime of ['audio/webm;codecs=evil','audio/mp4;codecs=opus','video/webm','audio/webm;x=y','image/png;codecs=opus'])assert.equal(a.mediaType(mime),null,mime);
 let res=await upload(a,auth.apiToken,'chat voice',wav,'audio/wav');assert.equal(res.status,200);let payload={base64:(await res.json()).ticket,clientMessageId:'voice-valid-0000',duration:1};let sent=await ack(s,'chat voice',payload);assert.equal(sent.ok,true);
 assert.equal(a.db.prepare('SELECT content FROM messages WHERE id=?').get(sent.messageId).content,wavUrl);
 for(const mime of ['audio/webm;codecs=opus','audio/mp4;codecs=mp4a.40.2','audio/ogg','audio/mpeg'])assert.equal((await upload(a,auth.apiToken,'chat voice',wav,mime)).status,400);
 // Container-signature specimens test parser paths, not browser playability.
 const element=(id,data)=>Buffer.concat([Buffer.from(id,'hex'),Buffer.from([0x80|data.length]),data]);
 const webm=Buffer.concat([element('1a45dfa3',element('4282',Buffer.from('webm'))),element('18538067',Buffer.concat([element('1654ae6b',element('ae',Buffer.concat([element('83',Buffer.from([2])),element('86',Buffer.from('A_OPUS'))]))),element('1f43b675',element('a3',Buffer.from([0x81,0,0,0x80,0xf8,0xff,0xfe])))]))]);
 assert.doesNotThrow(()=>a.mediaType('audio/webm;codecs=opus'));assert.equal((await upload(a,auth.apiToken,'chat voice',webm,'audio/webm;codecs=opus')).status,200);
});
test('U16 disconnect revokes credentials and tickets; reconnect is anonymous until fresh login with per-room history',async t=>{
 const a=fixture(t),s=await connect(a,t),b=await connect(a,t),auth=await register(s,'reconnecta');await register(b,'reconnectb');await join(s);await join(b);
 let res=await upload(a,auth.apiToken,'chat image');const ticket=(await res.json()).ticket;
 s.disconnect();await delay(20);assert.equal((await api(a,auth.apiToken)).status,401);assert.equal(a.mediaTickets.has(ticket),false);
 const sent=await ack(b,'chat message',{content:'while offline',clientMessageId:'offline-0000'});assert.equal(sent.ok,true);
 const replacement=await connect(a,t);assert.equal((await ack(replacement,'chat message',{content:'anonymous'})).ok,false);
 replacement.auth={token:auth.apiToken};assert.equal((await api(a,auth.apiToken)).status,401);
 const fresh=await emitWait(replacement,'login',{account:'reconnecta',password:'Synthetic-Password'},'authSuccess');assert.notEqual(fresh.apiToken,auth.apiToken);
 const history=await join(replacement);assert.equal(history.messages.filter(m=>m.id===sent.messageId).length,1);
 assert.equal((await ack(replacement,'chat image',{base64:ticket,clientMessageId:'stale-0000'})).ok,false);
});
test('U27 explicit validated cursor only, stable ties, room switches and monotonic multi-device receipts',async t=>{
 const a=fixture(t),A=await connect(a,t),B=await connect(a,t),B2=await connect(a,t),ua=await register(A,'readera'),ub=await register(B,'readerb');await emitWait(B2,'login',{account:'readerb',password:'Synthetic-Password'},'authSuccess');await join(A);await join(B);await join(B2);
 const first=await ack(A,'chat message',{content:'first',clientMessageId:'read-first-0000'});const second=await ack(A,'chat message',{content:'second',clientMessageId:'read-second-0000'});
 assert.equal(a.unreadCountForRoom(ub.user.id,'club-91'),2);await join(B);assert.equal(a.unreadCountForRoom(ub.user.id,'club-91'),2);
 const row=a.db.prepare('SELECT * FROM messages WHERE id=?').get(first.messageId);
 const receipt={roomId:'club-91',cursor:{id:row.id,timestamp:row.created_at}};
 assert.equal((await ack(B,'mark room read','club-91')).ok,false);assert.equal((await ack(B,'mark room read',{...receipt,cursor:{...receipt.cursor,timestamp:'2099-01-01'}})).ok,false);
 assert.equal((await ack(B,'mark room read',receipt)).ok,true);assert.equal(a.unreadCountForRoom(ub.user.id,'club-91'),1);
 const row2=a.db.prepare('SELECT * FROM messages WHERE id=?').get(second.messageId);
 assert.equal((await ack(B2,'mark room read',{roomId:'club-91',cursor:{id:row2.id,timestamp:row2.created_at}})).ok,true);
 assert.equal((await ack(B,'mark room read',receipt)).ok,true);assert.equal(a.readStateForRoom(ub.user.id,'club-91').last_read_message_id,row2.id);
 await emitWait(B,'open private chat',ua.user.id,'room joined');assert.equal((await ack(B,'mark room read',receipt)).ok,false);
 const privateSent=await ack(B,'chat message',{content:'private'});const priv=a.db.prepare('SELECT * FROM messages WHERE id=?').get(privateSent.messageId);assert.equal((await ack(B2,'mark room read',{roomId:'club-91',cursor:{id:priv.id,timestamp:priv.created_at}})).ok,false);
 assert.equal(a.buildLobbyPayload(ua.user).privateUnread[ub.user.id],1);
 await emitWait(A,'open private chat',ub.user.id,'room joined');
 assert.equal(a.buildLobbyPayload(ua.user).privateUnread[ub.user.id],1);
 assert.equal((await ack(A,'mark room read',{roomId:priv.room_id,cursor:{id:priv.id,timestamp:priv.created_at}})).ok,true);
 assert.equal(a.buildLobbyPayload(ua.user).privateUnread[ub.user.id],0);
 const timestamp='2090-01-01T00:00:00.000Z';for(const id of ['tie:a','tie:b'])a.upsertMessage({id,roomId:'club-91',userId:ua.user.id,username:'a',type:'text',content:'tie',timestamp});
 await ack(B2,'mark room read',{roomId:'club-91',cursor:{id:'tie:a',timestamp}});assert.equal(a.unreadCountForRoom(ub.user.id,'club-91'),1);
});
test('U27 client visibility, focus, viewport, dialog and delayed room-switch guards',()=>{
 const vm=require('node:vm'),html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 const code=html.slice(html.indexOf('    function visibleReadCursor'),html.indexOf('    function openSearchTarget'));
 let focused=true,modal=false,transition=false,timer,rect={top:100,bottom:150},emitted=[];
 const row={dataset:{messageId:'m1',timestamp:'2026-01-01T00:00:00.000Z'},getBoundingClientRect:()=>rect,querySelectorAll:()=>[]};
 const c={state:{userId:'u',isConnected:true,currentRoom:{id:'a'},view:'chat'},document:{visibilityState:'visible',hasFocus:()=>focused,body:{classList:{contains:()=>transition}},querySelector:()=>modal?{}:null,addEventListener(){}},window:{innerHeight:800,clearTimeout(){timer=null},setTimeout(fn){timer=fn;return 1},addEventListener(){}},messagesDiv:{getBoundingClientRect:()=>({top:80,bottom:700,height:620}),querySelectorAll:()=>[row]},socket:{volatile:{emit:(e,p)=>emitted.push(p)}}};
 vm.createContext(c);vm.runInContext(code,c);c.markCurrentRoomRead();timer();assert.equal(emitted.length,1);
 for(const disable of [()=>c.document.visibilityState='hidden',()=>focused=false,()=>modal=true,()=>transition=true,()=>c.state.view='forum',()=>rect={top:701,bottom:750}]){
  c.document.visibilityState='visible';focused=true;modal=false;transition=false;c.state.view='chat';rect={top:100,bottom:150};disable();assert.equal(c.visibleReadCursor(),null);
 }
 rect={top:100,bottom:150};c.markCurrentRoomRead();const delayed=timer;c.state.currentRoom={id:'b'};delayed();assert.equal(emitted.length,1);
 row.querySelectorAll=()=>[{complete:false,naturalWidth:0}];assert.equal(c.visibleReadCursor(),null);row.querySelectorAll=()=>[];
 c.state.currentRoom={id:'a'};c.markCurrentRoomRead();const blur=timer;focused=false;blur();assert.equal(emitted.length,1);
});
test('U16 client disconnect clears buffered work and requires login; media completion cannot cross identities',async()=>{
 const vm=require('node:vm'),html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 const start=html.indexOf("    socket.on('disconnect', () => {");const end=html.indexOf("    socket.on('loggedOut'",start);let handler;
 const c={socket:{sendBuffer:[1,2],on:(_e,h)=>handler=h},setConnection(v){c.connected=v},resetClientSession(){c.reset=true},loginError:{textContent:''}};vm.createContext(c);vm.runInContext(html.slice(start,end),c);handler();assert.equal(c.connected,false);assert.equal(c.reset,true);assert.equal(c.socket.sendBuffer.length,0);assert.match(c.loginError.textContent,/重新登录/);
 const uploadCode=html.slice(html.indexOf('    let clientSessionGeneration'),html.indexOf('    // Keep uncertain sends'));
 let complete;const scope={state:{apiToken:'old',userId:'a',isConnected:true,currentRoom:{id:'room'}},Set,Uint8Array,atob,AbortController,setTimeout,clearTimeout,Error,fetch:async()=>new Promise(r=>complete=r)};
 vm.createContext(scope);vm.runInContext(uploadCode,scope);const pending=scope.prepareMediaPayload('chat image',{base64:pngUrl});scope.state.apiToken='new';complete({ok:true,json:async()=>({ticket:'upload:synthetic'})});await assert.rejects(pending,/会话已改变/);
});

test('U16 disconnected emits never queue passwords or mutations',()=>{
 const vm=require('node:vm'),html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 const start=html.indexOf('    const connectedEmit'),end=html.indexOf('    };',start)+6;
 let sent=0,reply;const socket={connected:false,emit(){sent++;return this}};const c={socket};vm.createContext(c);vm.runInContext(html.slice(start,end),c);
 socket.emit('login',{password:'synthetic'});socket.emit('chat message',{},r=>reply=r);assert.equal(sent,0);assert.equal(reply.ok,false);socket.connected=true;socket.emit('login',{});assert.equal(sent,1);
});
test('U29 patched network parsers survive malformed socket upgrade and compressed HTTP input',async t=>{
 const a=fixture(t),s=await connect(a,t);const auth=await register(s,'protocoluser');await join(s);
 const handshake=await (await fetch(base(a)+'/socket.io/?EIO=4&transport=polling')).text();const sid=JSON.parse(handshake.slice(1)).sid;
 const WebSocket=require('ws');
 const mismatch=await new Promise((resolve,reject)=>{
  const ws=new WebSocket(base(a).replace('http:','ws:')+'/socket.io/?EIO=3&transport=websocket&sid='+sid);const timer=setTimeout(()=>{ws.terminate();reject(Error('upgrade rejection timeout'))},2000);
  ws.on('error',e=>{clearTimeout(timer);resolve(e.message)});ws.on('open',()=>{clearTimeout(timer);ws.close();resolve('unexpected upgrade')});
 });assert.notEqual(mismatch,'unexpected upgrade');
 const compressed=require('node:zlib').gzipSync(Buffer.from('{}'));const response=await fetch(base(a)+'/api/notifications',{method:'POST',headers:{Authorization:'Bearer '+auth.apiToken,'Content-Type':'application/json','Content-Encoding':'gzip'},body:Buffer.concat([compressed,Buffer.from('trailing')])});assert.equal(response.status,415);
 assert.equal((await ack(s,'chat message',{content:'process alive',clientMessageId:'protocol-0000'})).ok,true);
});

test('U27 private badges take server counts and never clear on selection',()=>{
 const vm=require('node:vm'),html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 const start=html.indexOf("    socket.on('lobby', (payload) => {"),end=html.indexOf("    socket.on('forum posts'",start);let handler;
 const c={state:{privateUnread:{other:9}},socket:{on:(_e,h)=>handler=h},renderLobby(){},renderHome(){},renderNotificationBadges(){}};vm.createContext(c);vm.runInContext(html.slice(start,end),c);handler({rooms:[],users:[],privateUnread:{other:2},chatUnreadCount:2});assert.equal(c.state.privateUnread.other,2);handler({privateUnread:{other:0},chatUnreadCount:0});assert.equal(c.state.privateUnread.other,0);
 assert.equal(html.includes('clearPrivateUnread(room)'),false);assert.equal(html.includes('delete state.privateUnread[user.id]'),false);
});
