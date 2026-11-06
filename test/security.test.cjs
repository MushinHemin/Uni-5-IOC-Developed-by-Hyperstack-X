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
 try{m._compile(fs.readFileSync(m.filename,'utf8')+'\nmodule.exports={db,io,server,users,listForumPosts,upsertMessage,loadHistory,myForumFavorites,myForumComments,listNotificationsForUser,searchUni,insertForumPost,groupCodeInfo,isValidGroupCode,allowGroupInviteAttempt,ensureAdminUser,verifyPassword,broadcastForumPosts,broadcastForumPostDetail,messagesForRoom};',m.filename)}finally{http.Server.prototype.listen=original}
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
test('U03/U28 identity changes clear private rooms, tokens, forum subscriptions and broadcasts',async t=>{
 const a=fixture(t),A=await connect(a,t),B=await connect(a,t),anonymous=await connect(a,t);
 const ua=await register(A,'usera'),ub=await register(B,'userb');
 const room=await emitWait(A,'open private chat',ub.user.id,'room joined');await emitWait(B,'open private chat',ua.user.id,'room joined');
 const now=new Date().toISOString();a.insertForumPost({postId:'post:test',userId:ua.user.id,username:'a',avatar:'A',title:'test',content:'text',contentHtml:'',contentText:'text',contentFormat:'plain',createdAt:now,updatedAt:now});
 await emitWait(A,'get forum post','post:test','forum post detail');
 const uc=await register(A,'userc');const serverA=a.io.sockets.sockets.get(A.id);
 assert.equal(serverA.currentRoomId,'');assert.equal(serverA.currentForumPostId,'');assert.deepEqual([...serverA.rooms],[A.id]);assert.equal((await api(a,ua.apiToken)).status,401);
 let received=0;A.on('chat message',()=>received++);
 assert.equal((await ack(A,'chat message',{content:'forbidden'})).ok,false);
 serverA.currentRoomId=room.room.id;serverA.join('room:'+room.room.id);
 assert.equal((await ack(A,'chat image',{base64:'data:image/png;base64,YWJjZA=='})).ok,false);
 assert.deepEqual(a.messagesForRoom(room.room.id,uc.user.id),[]);
 // Even a stale server-side room subscription cannot authorize delivery.
 serverA.currentRoomId=room.room.id;serverA.join('room:'+room.room.id);
 assert.equal((await ack(B,'chat message',{content:'private',clientMessageId:'private-001'})).ok,true);
 await delay(30);assert.equal(received,0);
 await emitWait(A,'get forum post','post:test','forum post detail');
 await emitWait(A,'logout',undefined,'loggedOut');
 assert.equal((await api(a,uc.apiToken)).status,401);assert.equal(serverA.currentForumPostId,'');assert.deepEqual([...serverA.rooms],[A.id]);
 let forumEvents=0;for(const s of [A,anonymous])for(const e of ['forum posts','forum post detail'])s.on(e,()=>forumEvents++);
 a.broadcastForumPosts();a.broadcastForumPostDetail('post:test');await delay(30);assert.equal(forumEvents,0);
 const back=await emitWait(A,'login',{account:'usera',password:'Synthetic-Password'},'authSuccess');assert.equal(back.user.id,ua.user.id);
 await emitWait(A,'join room','club-91','room joined');assert.equal((await ack(A,'chat message',{content:'normal',clientMessageId:'normal-001'})).ok,true);
 await emitWait(A,'login',{account:'userb',password:'Synthetic-Password'},'authSuccess');assert.equal(serverA.currentRoomId,'');assert.equal((await api(a,back.apiToken)).status,401);
});
test('U07 password reset revokes all old sockets/tokens, preserves password on restart, failure is atomic',async t=>{
 const a=fixture(t),A=await connect(a,t),A2=await connect(a,t),admin=await connect(a,t);
 const ua=await register(A,'resetuser');const ua2=await emitWait(A2,'login',{account:'resetuser',password:'Synthetic-Password'},'authSuccess');
 await emitWait(admin,'login',{account:'testadmin',password:'Synthetic-Test-Password-Only'},'authSuccess');
 const hash=a.users.find(u=>u.id===ua.user.id).passwordHash;
 a.db.exec("CREATE TRIGGER fail_reset BEFORE UPDATE ON users BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 assert.equal((await ack(admin,'admin reset password',{userId:ua.user.id,password:'Changed-Password'})).ok,false);assert.equal(a.users.find(u=>u.id===ua.user.id).passwordHash,hash);assert.equal((await api(a,ua.apiToken)).status,200);
 a.db.exec('DROP TRIGGER fail_reset');
 const loggedOut=event(A,'loggedOut'),loggedOut2=event(A2,'loggedOut');await emitWait(admin,'admin reset password',{userId:ua.user.id,password:'Changed-Password'},'admin notice');await Promise.all([loggedOut,loggedOut2]);
 for(const token of [ua.apiToken,ua2.apiToken])assert.equal((await api(a,token)).status,401);
 assert.equal((await ack(A,'chat message',{content:'old session'})).ok,false);
 await emitWait(A,'login',{account:'resetuser',password:'Synthetic-Password'},'authError');
 assert.ok((await emitWait(A,'login',{account:'resetuser',password:'Changed-Password'},'authSuccess')).apiToken);
 const administrator=a.users.find(u=>u.account==='testadmin');await emitWait(admin,'admin reset password',{userId:administrator.id,password:'Changed-Admin-Password'},'admin notice');
 const saved=administrator.passwordHash;A.disconnect();A2.disconnect();admin.disconnect();await a.close();a.closed=true;
 const restarted=fixture(t,a.dir,'Completely-Different-Bootstrap');assert.equal(restarted.users.find(u=>u.account==='testadmin').passwordHash,saved);assert.equal(restarted.verifyPassword('Changed-Admin-Password',saved),true);
 await restarted.close();restarted.closed=true;
});
test('U08 random invitations expire, are consumed only after successful creation, cannot replay or brute force',async t=>{
 const a=fixture(t),s=await connect(a,t);await register(s,'inviteuser');
 const info=a.groupCodeInfo();assert.match(info.code,/^\d{6}$/);assert.equal(a.isValidGroupCode(info.code,Date.parse(info.expiresAt)),false);
 const expired=a.groupCodeInfo(Date.now()-700000); // Current code remains current until its expiry; no clock rollback rotation.
 assert.equal(expired.code,info.code);
 a.db.exec("CREATE TRIGGER fail_room BEFORE INSERT ON rooms BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 assert.equal((await ack(s,'create room',{name:'failed',code:info.code})).ok,false);assert.equal(a.isValidGroupCode(info.code),true);a.db.exec('DROP TRIGGER fail_room');
 await emitWait(s,'create room',{name:'created',code:info.code},'room created');assert.equal(a.isValidGroupCode(info.code),false);
 const next=a.groupCodeInfo();assert.notEqual(next.code,info.code);
 await emitWait(s,'create room',{name:'replayed',code:info.code},'messageError');
 const serverSocket=a.io.sockets.sockets.get(s.id);a.allowGroupInviteAttempt(serverSocket);a.allowGroupInviteAttempt(serverSocket);assert.equal(a.allowGroupInviteAttempt(serverSocket),false);
 assert.equal(a.allowGroupInviteAttempt(serverSocket,Date.now()+700000),true);
 assert.equal(a.groupCodeInfo(Date.parse(next.expiresAt)+1).code===next.code,false);
});
test('U10 bootstrap rejects missing/placeholder password and never modifies an existing administrator',t=>{
 const a=fixture(t);const admin=a.users.find(u=>u.account==='testadmin');const before=JSON.stringify(admin);a.ensureAdminUser();assert.equal(JSON.stringify(admin),before);
 // Extract and execute only bootstrap policy for missing-account negative cases; no production startup or data.
 const source=fs.readFileSync(path.join(root,'server.js'),'utf8');const vm=require('node:vm');
 const policy=source.slice(source.indexOf('function isStrongBootstrapPassword'),source.indexOf('function warnIfDefaultAdminPassword'));
 const ensure=source.slice(source.indexOf('function ensureAdminUser'),source.indexOf('function validateAuthPayload'));
 for(const password of ['', 'change-me-admin-password','replace-with-a-strong-password','short']){
  const c={ADMIN_PASSWORD:password,ADMIN_ACCOUNT:'admin',findUserByAccount:()=>null};vm.createContext(c);vm.runInContext(policy+ensure,c);assert.throws(()=>c.ensureAdminUser(),/administrator requires/);
 }
});
