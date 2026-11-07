const {pngUrl,wavUrl}=require('./media-fixtures.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module'),http=require('node:http');
const root=path.resolve(__dirname,'..');
function fixture(t,existing){
 const dir=existing||fs.mkdtempSync(path.join(os.tmpdir(),'uni-reliability-'));
 for(const name of ['server.js','package.json'])fs.copyFileSync(path.join(root,name),path.join(dir,name));
 process.env.PORT='0';process.env.ADMIN_ACCOUNT='testadmin';process.env.ADMIN_PASSWORD='Synthetic-Test-Password-Only';
 const original=http.Server.prototype.listen;
 http.Server.prototype.listen=function(_port,cb){return original.call(this,0,'127.0.0.1',cb)};
 const m=new Module(path.join(dir,'server.js'));m.filename=path.join(dir,'server.js');m.paths=Module._nodeModulePaths(root);
 try{m._compile(fs.readFileSync(m.filename,'utf8')+'\nmodule.exports={db,io,server,users,listForumPosts,upsertMessage,loadHistory,myForumFavorites,myForumComments,listNotificationsForUser,searchUni,insertForumPost};',m.filename)}finally{http.Server.prototype.listen=original}
 const a=m.exports;a.dir=dir;
 a.close=async()=>{await new Promise(r=>a.io.close(r));a.db.close()};
 t.after(async()=>{if(!a.closed){await a.close();a.closed=true}if(!existing)fs.rmSync(dir,{recursive:true,force:true})});return a;
}
test('U01 all five filters and sorts on empty and populated database',t=>{
 const a=fixture(t),uid=a.users[0].id;
 const filters=['all','mine','favorites','has_images','edited'],sorts=['latest','updated','comments','likes','favorites'];
 for(const filter of filters)for(const sort of sorts)assert.deepEqual(a.listForumPosts(uid,{filter,sort}),[]);
 for(let i=0;i<2;i++)a.insertForumPost({postId:'post:'+i,userId:uid,username:'test',avatar:'A',title:'test '+i,content:'text',contentHtml:'',contentText:'text',contentFormat:'plain',createdAt:`2026-01-0${i+1}T00:00:00Z`,updatedAt:`2026-01-0${i+1}T00:00:00Z`});
 for(const filter of filters)for(const sort of sorts){const p=a.listForumPosts(uid,{filter,sort});assert.equal(p.length,['all','mine'].includes(filter)?2:0)}
 assert.equal(a.listForumPosts(uid,{limit:1,offset:1})[0].postId,'post:0');
});
test('U02 persistence fields and reload for every message type',t=>{
 const a=fixture(t);
 for(const type of ['text','image','voice','sticker'])a.upsertMessage({id:'message:'+type,roomId:'club-91',userId:a.users[0].id,username:'test',avatar:'A',type,content:type==='image'?'data:image/png;base64,YWJjZA==':type==='voice'?'data:audio/webm;base64,YWJjZA==':type==='sticker'?'/uploads/stickers/test.png':'synthetic',duration:2,stickerId:type==='sticker'?'s1':'',timestamp:new Date().toISOString(),displayName:'not a DB field',reactions:[]});
 assert.equal(a.db.prepare('SELECT COUNT(*) n FROM messages').get().n,4);assert.equal(a.loadHistory().length,4);
});
test('U04 all shared pagination rejects malformed input',t=>{
 const a=fixture(t),uid=a.users[0].id;
 const calls=[p=>a.listNotificationsForUser(uid,p),p=>a.listForumPosts(uid,p),p=>a.searchUni(a.users[0],{q:'test',...p}),p=>a.myForumFavorites(uid,p.limit,p.offset),p=>a.myForumComments(uid,false,p.limit,p.offset)];
 for(const call of calls)for(const key of ['limit','offset'])for(const value of [1.5,-1,Infinity,NaN,'x','',null,{},[],true,100000000000])assert.throws(()=>call({[key]:value}),/参数|分页/);
 for(const call of calls)assert.doesNotThrow(()=>call({limit:'1',offset:'0'}));
});
module.exports={fixture};
const {io:client}=require(path.join(path.dirname(require.resolve('socket.io')), '../client-dist/socket.io.js'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function event(s,name){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{s.off(name,done);reject(new Error('timeout '+name))},2000);function done(v){clearTimeout(timer);resolve(v)}s.once(name,done)})}
async function emitWait(s,name,payload,response){const p=event(s,response);s.emit(name,payload);return p}
async function connect(a,t){if(!a.server.listening)await new Promise(r=>a.server.once('listening',r));const s=client(`http://127.0.0.1:${a.server.address().port}`,{transports:['websocket'],reconnection:false});t.after(()=>s.disconnect());await event(s,'connect');return s}
function ack(s,name,payload){return new Promise((resolve,reject)=>s.timeout(2000).emit(name,payload,(e,r)=>e?reject(e):resolve(r)))}
test('Socket/HTTP controlled errors, media persistence, retries, write failure and restart',async t=>{
 const a=fixture(t),s=await connect(a,t);
 const auth=await emitWait(s,'register',{account:'testuser',username:'Test',password:'Synthetic-Password'},'authSuccess');
 await emitWait(s,'join room','club-91','room joined');
 assert.deepEqual((await emitWait(s,'get forum posts',{},'forum posts')).posts,[]);
 for(const payload of [{limit:1.5},{offset:-1},{filter:'invalid'},{sort:'bad'},null])assert.equal((await ack(s,'get forum posts',payload)).ok,false);
 a.db.exec('ALTER TABLE posts RENAME TO posts_fault');
 assert.equal((await ack(s,'get forum posts',{})).ok,false);
 a.db.exec('ALTER TABLE posts_fault RENAME TO posts');
 assert.equal((await emitWait(s,'get forum posts',{},'forum posts')).posts.length,0);
 assert.equal((await ack(s,'get notifications',{limit:1.5})).ok,false);
 assert.equal((await ack(s,'search',{q:'a',offset:1.2})).ok,false);
 for(const endpoint of ['notifications','forum/posts','me/posts','me/comments','me/replies','me/favorites','search?q=a&']){
  const url=endpoint.includes('?')?endpoint+'limit=1.5':endpoint+'?limit=1.5';
  const res=await fetch(`http://127.0.0.1:${a.server.address().port}/api/${url}`,{headers:{Authorization:`Bearer ${auth.apiToken}`}});assert.equal(res.status,400);assert.match((await res.json()).error,/参数/);
 }
 a.db.prepare("INSERT INTO stickers(id,owner_user_id,url,sticker_type,status,created_at) VALUES(?,?,?,?,?,?)").run('sticker:test',auth.user.id,'/uploads/stickers/test.png','personal','active',new Date().toISOString());
 const payloads=[['chat message',{content:'persisted text'}],['chat image',{base64:pngUrl}],['chat voice',{base64:wavUrl,duration:2}],['chat sticker',{stickerId:'sticker:test'}]];
 let received=[];s.on('chat message',m=>received.push(m));
 for(let i=0;i<payloads.length;i++){
  const [name,p]=payloads[i];p.clientMessageId='request-'+i;
  const result=await ack(s,name,p);assert.equal(result.ok,true);assert.ok(a.db.prepare('SELECT id FROM messages WHERE id=?').get(result.messageId));
  assert.equal((await ack(s,name,p)).duplicate,true);
 }
 await delay(30);assert.equal(received.length,4);assert.equal(a.db.prepare('SELECT count(*) n FROM messages').get().n,4);
 assert.equal((await ack(s,'chat message',{content:'different',clientMessageId:'request-0'})).ok,false);
 a.db.exec("CREATE TRIGGER fail_messages BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 for(const [name,p] of payloads)assert.equal((await ack(s,name,{...p,clientMessageId:p.clientMessageId+'-failed'})).ok,false);
 await delay(30);assert.equal(received.length,4);assert.equal(a.db.prepare('SELECT count(*) n FROM messages').get().n,4);
 a.db.exec('DROP TRIGGER fail_messages');
 assert.equal((await ack(s,'chat message',{content:'persisted text',clientMessageId:'request-0-failed'})).ok,true);
 const recalledId=received[0].id;
 a.db.exec("CREATE TRIGGER fail_recall BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 await emitWait(s,'recall message',recalledId,'messageError');
 assert.equal(a.db.prepare('SELECT recalled FROM messages WHERE id=?').get(recalledId).recalled,0);
 a.db.exec('DROP TRIGGER fail_recall');
 await emitWait(s,'recall message',recalledId,'message recalled');
 assert.equal(a.db.prepare('SELECT recalled FROM messages WHERE id=?').get(recalledId).recalled,1);
 const legacy=event(s,'chat message');s.emit('chat message','legacy scalar');await legacy;
 s.disconnect();await a.close();a.closed=true;
 const restarted=fixture(t,a.dir);assert.equal(restarted.loadHistory().length,6);
 const s2=await connect(restarted,t);await emitWait(s2,'login',{account:'testuser',password:'Synthetic-Password'},'authSuccess');
 const room=await emitWait(s2,'join room','club-91','room joined');assert.equal(room.messages.length,6);
 assert.equal((await ack(s2,'chat message',payloads[0][1])).duplicate,true);
 s2.disconnect();await restarted.close();restarted.closed=true;
});
test('Forum sorting and nonempty filter semantics remain correct',t=>{
 const a=fixture(t),u=a.users[0].id,old='2026-01-01T00:00:00Z',recent='2026-01-02T00:00:00Z';
 for(const [id,date] of [['post:a',old],['post:b',recent]])a.insertForumPost({postId:id,userId:u,username:'test',avatar:'A',title:id,content:'text',contentHtml:'',contentText:'text',contentFormat:'plain',createdAt:date,updatedAt:date});
 a.db.prepare('UPDATE posts SET updated_at=?,edited_at=? WHERE id=?').run('2026-01-03T00:00:00Z',recent,'post:a');
 for(const table of ['post_likes','post_favorites'])a.db.prepare(`INSERT INTO ${table}(id,post_id,user_id,created_at) VALUES(?,?,?,?)`).run(table,'post:a',u,old);
 a.db.prepare('INSERT INTO comments(id,post_id,user_id,username,avatar,content,created_at) VALUES(?,?,?,?,?,?,?)').run('comment:a','post:a',u,'test','A','reply',old);
 a.db.prepare('INSERT INTO post_images(id,post_id,user_id,url,filename,mime_type,is_bound,created_at) VALUES(?,?,?,?,?,?,?,?)').run('image:a','post:a',u,'/uploads/post-images/a.png','a.png','image/png',1,old);
 for(const sort of ['latest','updated','comments','likes','favorites'])assert.equal(a.listForumPosts(u,{sort})[0].postId,sort==='latest'?'post:b':'post:a');
 for(const filter of ['favorites','has_images','edited'])assert.deepEqual(a.listForumPosts(u,{filter}).map(p=>p.postId),['post:a']);
 assert.equal(a.listForumPosts('other-user',{filter:'mine'}).length,0);
});
const vm=require('node:vm');
function frontend(){
 const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 const code=html.slice(html.indexOf('    const pendingMessageRequests'),html.indexOf('    function openMessageMenu'));
 const c={clientSessionGeneration:0,prepareMediaPayload:async (_e,p)=>p,crypto:require('node:crypto').webcrypto,Map,Promise,setTimeout,clearTimeout,Error,JSON,state:{userId:'u1',username:'test',isConnected:true,currentRoom:{id:'club-91'},pendingImage:null},input:{value:'hello',style:{}},sendBtn:{},mentionMenu:{},stopTyping(){},clearQuote(){},clearPendingImage(){c.state.pendingImage=null},startImageCooldown(){},compactText:s=>s,showToast:m=>c.lastError=m,confirm:()=>false,socket:{emit(){}}};
 vm.createContext(c);vm.runInContext(code,c);return c;
}
test('Client failure retains input and retry uses same ID; successful send clears input',async()=>{
 const c=frontend(),ids=[];let fail=true;
 c.socket.emit=(_event,p,reply)=>{ids.push(p.clientMessageId);reply(fail?{ok:false,error:'write failed'}:{ok:true})};
 await c.sendMessage();assert.equal(c.input.value,'hello');assert.equal(c.lastError,'write failed');fail=false;
 await c.sendMessage();assert.equal(c.input.value,'');assert.equal(ids[0],ids[1]);
 c.input.value='hello';await c.sendMessage();assert.notEqual(ids[2],ids[1]);
});
test('Client coalesces pending sends and keeps retry ID after acknowledgement timeout',async()=>{
 const c=frontend();let expire,callback;const sent=[];
 c.setTimeout=f=>{expire=f;return 1};c.clearTimeout=()=>{};
 c.socket.emit=(_e,p,cb)=>{sent.push(p);callback=cb};
 const first=c.sendReliableMessage('chat message',{content:'hello'});assert.equal(c.sendReliableMessage('chat message',{content:'hello'}),first);
 await Promise.resolve();expire();await assert.rejects(first,/未确认/);
 const retry=c.sendReliableMessage('chat message',{content:'hello'});await Promise.resolve();assert.equal(sent[0].clientMessageId,sent[1].clientMessageId);callback({ok:true});await retry;
});
test('Client does not resend confirmed image when text fails',async()=>{
 const c=frontend(),events=[];c.state.pendingImage={base64:pngUrl};let fail=true;
 c.socket.emit=(e,p,cb)=>{events.push(e);cb(e==='chat message'&&fail?{ok:false,error:'failed'}:{ok:true})};
 await c.sendMessage();assert.equal(c.state.pendingImage,null);assert.equal(c.input.value,'hello');fail=false;await c.sendMessage();assert.deepEqual(events,['chat image','chat message','chat message']);
});
test('Message survives two separate Node server processes',async t=>{
 const a=fixture(t),uid=a.users[0].id;
 a.upsertMessage({id:'process-restart-message',roomId:'club-91',userId:uid,username:'test',avatar:'A',type:'text',content:'persist across process exit',timestamp:new Date().toISOString()});
 await a.close();a.closed=true;
 fs.symlinkSync(path.join(root,'node_modules'),path.join(a.dir,'node_modules'));
 const preload=path.join(a.dir,'listen.cjs');fs.writeFileSync(preload,"const http=require('http'),listen=http.Server.prototype.listen;http.Server.prototype.listen=function(p,cb){return listen.call(this,0,'127.0.0.1',()=>{console.log('TEST_PORT:'+this.address().port);if(cb)cb()})}");
 for(let i=0;i<2;i++){
  const child=require('node:child_process').spawn(process.execPath,['--require',preload,path.join(a.dir,'server.js')],{cwd:a.dir,env:{PATH:process.env.PATH,PORT:'0',ADMIN_ACCOUNT:'testadmin',ADMIN_PASSWORD:'Synthetic-Test-Password-Only'}});
  let socket;
  try{
   const port=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('child startup timeout')),3000);child.once('exit',()=>{clearTimeout(timer);reject(Error('child exited before startup'))});child.stdout.on('data',d=>{log+=d;const m=log.match(/TEST_PORT:(\d+)/);if(m){clearTimeout(timer);resolve(Number(m[1]))}});child.stderr.resume()});
   socket=client(`http://127.0.0.1:${port}`,{transports:['websocket'],reconnection:false});await event(socket,'connect');await emitWait(socket,'login',{account:'testadmin',password:'Synthetic-Test-Password-Only'},'authSuccess');
   const room=await emitWait(socket,'join room','club-91','room joined');assert.equal(room.messages[0].id,'process-restart-message');assert.equal(room.messages[0].content,'persist across process exit');
  }finally{if(socket)socket.disconnect();if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited}}
 }
});
