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
 try{m._compile(fs.readFileSync(m.filename,'utf8')+'\nmodule.exports={db,io,server,users,createNotification,notificationPreferenceKey,setNotificationPreference,listNotificationsForUser,markNotificationRead};',m.filename)}finally{http.Server.prototype.listen=original}
 const a=m.exports;a.dir=dir;
 a.close=async()=>{await new Promise(r=>a.io.close(r));a.db.close()};
 t.after(async()=>{if(!a.closed){await a.close();a.closed=true}if(!existing)fs.rmSync(dir,{recursive:true,force:true})});return a;
}


const vm=require('node:vm');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
function drafts(){
 const store=new Map(),timers=new Map();let next=0;
 const c={state:{userId:'A',username:'a',forumEditPostId:'post-A'},forumPostTitle:{value:'edit A'},forumEditor:{innerHTML:'content A',hidden:false,querySelectorAll:()=>[]},forumEditorText:()=>c.forumEditor.innerHTML,sanitizeClientForumHtml:x=>x,forumEditorStatus:{},forumComposerPage:{hidden:false},forumDraftBanner:{hidden:false},forumEditorPreview:{},forumPreviewToggle:{classList:{remove(){}}},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},window:{clearTimeout:id=>timers.delete(id),setTimeout:fn=>{timers.set(++next,fn);return next}}};
 vm.createContext(c);vm.runInContext(html.slice(html.indexOf('    function forumDraftKey'),html.indexOf('    function applyForumDraft')),c);
 vm.runInContext(html.slice(html.indexOf('    function closeForumComposer()'),html.indexOf('    function clearForumComposer(')),c);
 return {c,store,timers};
}
test('U20 rapid edit close flushes captured draft, preserves independent new draft and cancels stale callback',()=>{
 const {c,store,timers}=drafts();const newKey=c.forumDraftKey('new','');store.set(newKey,JSON.stringify({title:'new untouched'}));
 c.scheduleForumDraftSave();const stale=[...timers.values()][0];c.closeForumComposer();stale();c.saveForumDraftNow();
 const edited=JSON.parse(store.get('uni:sonoma:forum-draft:edit:post-A:A'));assert.equal(edited.mode,'edit');assert.equal(edited.postId,'post-A');assert.equal(edited.contentHtml,'content A');assert.equal(JSON.parse(store.get(newKey)).title,'new untouched');assert.equal(timers.size,0);
});
test('U20 autosave snapshots isolate account/post changes; discard prevents delayed resurrection',()=>{
 const {c,store,timers}=drafts();c.scheduleForumDraftSave();const first=[...timers.values()][0];
 c.state.userId='B';c.state.forumEditPostId='post-B';c.forumEditor.innerHTML='B';first();
 assert.equal(JSON.parse(store.get('uni:sonoma:forum-draft:edit:post-A:A')).userId,'A');assert.equal(store.has(c.forumDraftKey()),false);
 c.scheduleForumDraftSave();const stale=[...timers.values()][0];c.clearForumDraft();stale();assert.equal(store.has(c.forumDraftKey()),false);
 c.scheduleForumDraftSave();[...timers.values()][0]();assert.equal(c.loadForumDraft().contentHtml,'B');
 c.state.forumEditPostId='';c.forumEditor.innerHTML='new B';c.scheduleForumDraftSave();c.flushForumDraftSave();assert.equal(c.loadForumDraft().mode,'new');assert.equal(JSON.parse(store.get('uni:sonoma:forum-draft:edit:post-B:B')).contentHtml,'B');
});
function notifications(){
 let handler,toasts=0;const c={state:{notifications:[],notificationUnread:0,soundEnabled:false},socket:{on:(_e,h)=>handler=h},renderNotificationBadges(){},renderNotifications(){},showToast(){toasts++},playMessageSound(){}};
 vm.createContext(c);vm.runInContext(html.slice(html.indexOf("    socket.on('notification:new'"),html.indexOf("    socket.on('notification:read',")),c);
 return {c,send:p=>handler(p),toasts:()=>toasts};
}
test('U24 same-ID update refreshes content/time/read state, deduplicates and ignores older replay',()=>{
 const {c,send,toasts}=notifications(),base={id:'n',title:'old',body:'old',isRead:true,createdAt:'2026-01-01T00:00:00.000Z'};
 send(base);send({...base,title:'updated',body:'fresh',isRead:false,readAt:'',createdAt:'2026-01-02T00:00:00.000Z'});
 assert.equal(c.state.notifications.length,1);assert.equal(c.state.notifications[0].title,'updated');assert.equal(c.state.notifications[0].body,'fresh');assert.equal(c.state.notifications[0].isRead,false);assert.equal(c.state.notificationUnread,1);
 const latest={...c.state.notifications[0]};send(latest);send(base);assert.equal(toasts(),2);assert.equal(c.state.notificationUnread,1);
 c.state.notifications[0].isRead=true;c.state.notificationUnread=0;send(latest);assert.equal(c.state.notifications[0].isRead,true);assert.equal(c.state.notificationUnread,0);
 send({notification:{...latest,createdAt:'2026-01-03T00:00:00.000Z',isRead:true},unreadCount:0});assert.equal(c.state.notificationUnread,0);
});
test('U24 unread delta preserves total outside loaded window and list remains bounded/sorted',()=>{
 const {c,send}=notifications();c.state.notificationUnread=100;
 for(let i=0;i<85;i++)send({id:'n'+i,title:'test',isRead:false,createdAt:new Date(1700000000000+i).toISOString()});
 assert.equal(c.state.notifications.length,80);assert.equal(c.state.notificationUnread,185);
 const item={...c.state.notifications[0],title:'changed',createdAt:'2090-01-01T00:00:00.000Z'};send(item);assert.equal(c.state.notificationUnread,185);assert.equal(c.state.notifications[0].title,'changed');
});
test('U25 structural preferences ignore display words; legacy notifications and aggregate updates remain compatible',t=>{
 const a=fixture(t),uid=a.users[0].id;
 const cases=[['forum_comment','forum_comment'],['forum_comment','forum_reply'],['reaction_received','post_like'],['reaction_received','comment_like'],['star_received','star_received'],['sticker_submission_result','sticker_review'],['creator_request_result','creator_result']];
 for(const [type,key] of cases){
  const metadata={eventType:key};assert.equal(a.notificationPreferenceKey({type,metadata,title:'回复帖子评论 username'}),key);
  a.setNotificationPreference(uid,key,false);assert.equal(a.createNotification({userId:uid,type,eventType:key,title:'回复帖子评论 username'}),null);
  a.setNotificationPreference(uid,key,true);assert.ok(a.createNotification({userId:uid,type,eventType:key,title:'回复帖子评论 username'}));
 }
 assert.equal(a.notificationPreferenceKey({type:'reaction_received',title:'帖子评论',targetType:'chat'}),'');
 assert.equal(a.notificationPreferenceKey({type:'reaction_received',title:'帖子',dedupeKey:'comment-like:old'}),'comment_like');
 assert.equal(a.notificationPreferenceKey({type:'forum_comment',title:'回复 username',metadata:{parentCommentId:'old-parent'}}),'forum_reply');
 assert.equal(a.notificationPreferenceKey({type:'forum_comment',title:'回复 username'}),'forum_comment');
 const legacy=a.createNotification({userId:uid,type:'forum_comment',title:'legacy',metadata:{commentId:'missing-old'},dedupeKey:'legacy-key'});assert.ok(legacy);
 const before=a.db.prepare('SELECT metadata_json FROM notifications WHERE id=?').get(legacy.id).metadata_json;a.listNotificationsForUser(uid);assert.equal(a.db.prepare('SELECT metadata_json FROM notifications WHERE id=?').get(legacy.id).metadata_json,before);
 a.markNotificationRead(uid,legacy.id);
 // Force a future timestamp to cover same-millisecond/clock rollback monotonicity.
 a.db.prepare('UPDATE notifications SET created_at=? WHERE id=?').run('2090-01-01T00:00:00.000Z',legacy.id);
 const updated=a.createNotification({userId:uid,type:'forum_comment',eventType:'forum_reply',title:'new',dedupeKey:'legacy-key'});assert.equal(updated.id,legacy.id);assert.equal(updated.isRead,false);assert.equal(updated.metadata.eventType,'forum_reply');assert.ok(updated.createdAt>'2090-01-01T00:00:00.000Z');
 assert.equal(a.db.prepare('SELECT count(*) n FROM notifications WHERE dedupe_key=?').get('legacy-key').n,1);
});
test('U30 documented socket events and HTTP paths exist; native support is explicitly historical',()=>{
 const source=fs.readFileSync(path.join(root,'server.js'),'utf8'),doc=fs.readFileSync(path.join(root,'docs/API.md'),'utf8');
 const events=new Set([...source.matchAll(/\.(?:on|emit)\(\s*'([^']+)'/g),...source.matchAll(/safeSocketHandler\(socket,\s*'([^']+)'/g)].map(m=>m[1]));
 const routes=new Set([...source.matchAll(/app\.(get|post)\('([^']+)'/g)].map(m=>m[1].toUpperCase()+' '+m[2]));
 for(const line of doc.split('\n')){
  const entry=line.match(/^- ((?:`[^`]+`(?: \/ )?)+):/);if(!entry)continue;
  for(const match of entry[1].matchAll(/`([^`]+)`/g)){
   if(/^(GET|POST) /.test(match[1]))assert.ok(routes.has(match[1].split('?')[0]),match[1]);
   else assert.ok(events.has(match[1]),match[1]);
  }
 }
 assert.match(doc,/Android\/Capacitor is an unmaintained historical project/);
 assert.match(fs.readFileSync(path.join(root,'README.md'),'utf8'),/Android\/Capacitor development has been discontinued/);
});
