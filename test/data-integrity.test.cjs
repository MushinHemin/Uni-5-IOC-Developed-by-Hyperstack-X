const {png,pngUrl}=require('./media-fixtures.cjs');
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
 try{m._compile(fs.readFileSync(m.filename,'utf8')+'\nmodule.exports={db,io,server,users,listForumPosts,upsertMessage,loadHistory,myForumFavorites,myForumComments,listNotificationsForUser,searchUni,insertForumPost,groupCodeInfo,isValidGroupCode,allowGroupInviteAttempt,ensureAdminUser,verifyPassword,broadcastForumPosts,broadcastForumPostDetail,messagesForRoom,transaction,importLegacyOnce,normalizeMessage,loadUsers,refreshPostImageReferences,cleanupOrphanPostImages,recoverQuarantinedPostImages,quarantinePath,savePostImageUpload,deleteForumCommentById,deleteForumPostById,deleteRoomData,deleteMessageData,nextCommentFloor,backfillCommentFloors,listForumComments,roomHistoryPage,migrateForumTable};',m.filename)}finally{http.Server.prototype.listen=original}
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
function post(a,id,html=''){const now=new Date().toISOString();a.insertForumPost({postId:id,userId:a.users[0].id,username:'test',avatar:'A',title:id,content:'text '+html,contentHtml:html,contentText:'text',contentFormat:'html',createdAt:now,updatedAt:now})}
function msg(a,id,room='club-91',time='2026-01-01T00:00:00Z'){a.upsertMessage({id,roomId:room,userId:a.users[0].id,username:'test',avatar:'A',type:'text',content:'retained '+id,timestamp:time})}
function comment(a,id,parent='',floor=1,reply=0){a.db.prepare('INSERT INTO comments(id,post_id,user_id,username,avatar,content,parent_comment_id,floor_number,reply_number,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'post:test',a.users[0].id,'test','A','original '+id,parent,floor,reply,'2026-01-01T00:00:00Z')}
test('U05 legacy import is lossless beyond cache, once-only, rollbackable and source JSON untouched',t=>{
 const a=fixture(t),file=path.join(a.dir,'legacy-synthetic.json');
 const records=Array.from({length:305},(_,i)=>({id:'legacy:'+i,roomId:'club-91',username:'legacy',content:'x'.repeat(1500),timestamp:'2026-01-01T00:00:00Z'}));fs.writeFileSync(file,JSON.stringify(records));const before=fs.readFileSync(file,'utf8');
 a.db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON messages WHEN NEW.id='legacy:100' BEGIN SELECT RAISE(ABORT,'injected'); END");
 assert.throws(()=>a.importLegacyOnce('test-import','messages',file,a.normalizeMessage,a.upsertMessage));assert.equal(a.db.prepare('SELECT count(*) n FROM messages').get().n,0);assert.equal(a.db.prepare("SELECT count(*) n FROM data_migrations WHERE name='test-import'").get().n,0);
 a.db.exec('DROP TRIGGER fail_import');a.importLegacyOnce('test-import','messages',file,a.normalizeMessage,a.upsertMessage);assert.equal(a.db.prepare('SELECT count(*) n FROM messages').get().n,305);assert.equal(a.db.prepare("SELECT length(content) n FROM messages LIMIT 1").get().n,1500);assert.equal(fs.readFileSync(file,'utf8'),before);
 a.deleteMessageData();a.importLegacyOnce('test-import','messages',file,a.normalizeMessage,a.upsertMessage);assert.equal(a.loadHistory().length,0);
 fs.writeFileSync(file,'{malformed');assert.throws(()=>a.importLegacyOnce('malformed','messages',file,a.normalizeMessage,a.upsertMessage));assert.equal(fs.readFileSync(file,'utf8'),'{malformed');
});
test('U05 actual startup imports legacy users first and preserves all historical records across reload',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'uni-legacy-startup-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const salt='synthetic-legacy-salt';const hash=salt+':'+require('node:crypto').scryptSync('Legacy-Password',salt,64).toString('hex');
 fs.writeFileSync(path.join(dir,'users.json'),JSON.stringify([{id:'legacy-user',account:'legacyuser',username:'old',passwordHash:hash,createdAt:'2026-01-01T00:00:00Z'}]));
 fs.writeFileSync(path.join(dir,'chat-history.json'),JSON.stringify(Array.from({length:301},(_,i)=>({id:'boot:'+i,userId:'legacy-user',username:'old',content:'kept',timestamp:'2026-01-01T00:00:00Z'}))));
 const a=fixture(t,dir);assert.equal(a.users.find(u=>u.id==='legacy-user').passwordHash,hash);assert.equal(a.db.prepare('SELECT count(*) n FROM messages').get().n,301);a.deleteMessageData();await a.close();a.closed=true;
 const again=fixture(t,dir);assert.equal(again.loadHistory().length,0);await again.close();again.closed=true;
});
test('U06 shared references survive cleanup; quarantine rollback, crash recovery and restore',t=>{
 const a=fixture(t),image=a.savePostImageUpload(a.users[0],pngUrl).image,url=image.url,html=`<img src="${url}">`;
 post(a,'post:a',html);post(a,'post:b',html);a.transaction(a.refreshPostImageReferences);
 assert.equal(a.db.prepare('SELECT count(*) n FROM post_image_refs').get().n,2);
 a.deleteForumPostById('post:b');a.db.prepare("UPDATE post_images SET unbound_at='2000-01-01',created_at='2000-01-01'").run();assert.equal(a.cleanupOrphanPostImages().quarantined,0);const original=path.join(a.dir,url);assert.ok(fs.existsSync(original));
 a.deleteForumPostById('post:a');a.db.exec("UPDATE post_images SET unbound_at='2000-01-01'");
 a.db.exec("CREATE TRIGGER fail_quarantine BEFORE UPDATE OF quarantined_at ON post_images WHEN NEW.quarantined_at!='' BEGIN SELECT RAISE(ABORT,'injected'); END");assert.throws(()=>a.cleanupOrphanPostImages());assert.ok(fs.existsSync(original));assert.equal(a.db.prepare('SELECT quarantined_at FROM post_images').get().quarantined_at,'');a.db.exec('DROP TRIGGER fail_quarantine');
 let row=a.db.prepare('SELECT * FROM post_images').get(),q=a.quarantinePath(row);
 fs.mkdirSync(path.dirname(q),{recursive:true});fs.renameSync(original,q);a.recoverQuarantinedPostImages();assert.ok(fs.existsSync(original)); // Crash after rename, before commit.
 a.db.exec("UPDATE post_images SET unbound_at='2000-01-01'");assert.equal(a.cleanupOrphanPostImages().quarantined,1);assert.ok(fs.existsSync(q));assert.ok(!fs.existsSync(original));
 a.recoverQuarantinedPostImages(true);assert.deepEqual(fs.readFileSync(original),png);assert.equal(a.db.prepare('SELECT quarantined_at FROM post_images').get().quarantined_at,'');
 a.db.exec("UPDATE post_images SET draft_token='offline-draft',unbound_at='2000-01-01'");assert.equal(a.cleanupOrphanPostImages().quarantined,0);
});
test('U14 tombstones preserve replies/floors and legacy orphan backfill is stable',t=>{
 const a=fixture(t);post(a,'post:test');comment(a,'comment:root');comment(a,'comment:reply','comment:root',1,1);a.deleteForumCommentById('comment:root');
 let list=a.listForumComments('post:test',a.users[0].id);assert.equal(list.length,2);assert.equal(list[0].isDeleted,true);assert.equal(list[0].content,'此评论已删除');assert.equal(list[1].content,'original comment:reply');assert.equal(a.nextCommentFloor('post:test').floorNumber,2);assert.equal(a.nextCommentFloor('post:test','comment:root'),null);
 comment(a,'comment:orphan','comment:missing',7,2);a.transaction(a.backfillCommentFloors);const before=JSON.stringify(a.db.prepare('SELECT * FROM comments ORDER BY id').all());a.transaction(a.backfillCommentFloors);assert.equal(JSON.stringify(a.db.prepare('SELECT * FROM comments ORDER BY id').all()),before);assert.equal(a.nextCommentFloor('post:test').floorNumber,8);assert.equal(a.listForumComments('post:test').length,4);
});
test('U15 post and room delete transactions roll back associations and clear dependent rows only on commit',t=>{
 const a=fixture(t);post(a,'post:test');comment(a,'comment:root');
 for(const table of ['post_likes','post_favorites'])a.db.prepare(`INSERT INTO ${table}(id,post_id,user_id,created_at) VALUES(?,?,?,?)`).run(table,'post:test',a.users[0].id,'2026-01-01');
 a.db.prepare('INSERT INTO comment_likes(id,comment_id,user_id,created_at) VALUES(?,?,?,?)').run('like','comment:root',a.users[0].id,'2026-01-01');
 a.db.exec("CREATE TRIGGER fail_post BEFORE DELETE ON posts BEGIN SELECT RAISE(ABORT,'injected'); END");assert.throws(()=>a.deleteForumPostById('post:test'));for(const table of ['posts','comments','post_likes','post_favorites','comment_likes'])assert.equal(a.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,1);
 a.db.exec('DROP TRIGGER fail_post');a.deleteForumPostById('post:test');for(const table of ['posts','comments','post_likes','post_favorites','comment_likes'])assert.equal(a.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
 a.db.prepare('INSERT INTO rooms(id,name,type,created_by,created_at) VALUES(?,?,?,?,?)').run('group:test','test','group',a.users[0].id,'2026-01-01');a.db.prepare('INSERT INTO room_members VALUES(?,?,?)').run('group:test',a.users[0].id,'2026-01-01');msg(a,'roommsg','group:test');msg(a,'unrelated');
 a.db.exec("CREATE TRIGGER fail_room_delete BEFORE DELETE ON rooms BEGIN SELECT RAISE(ABORT,'injected'); END");assert.throws(()=>a.deleteRoomData('group:test'));assert.ok(a.db.prepare("SELECT * FROM messages WHERE id='roommsg'").get());assert.equal(a.db.prepare("SELECT count(*) n FROM room_members WHERE room_id='group:test'").get().n,1);
 a.db.exec('DROP TRIGGER fail_room_delete');a.deleteRoomData('group:test');assert.ok(!a.db.prepare("SELECT * FROM messages WHERE id='roommsg'").get());assert.ok(a.db.prepare("SELECT * FROM messages WHERE id='unrelated'").get());
});
test('U17 per-room history and stable keyset paging survive busy rooms and tied timestamps',async t=>{
 const a=fixture(t),u=a.users[0].id;msg(a,'quiet');for(let i=0;i<350;i++)msg(a,'busy:'+i,'other-room');assert.equal(a.messagesForRoom('club-91',u).length,1);
 for(let i=0;i<8;i++)msg(a,'tie:'+i);const first=a.roomHistoryPage('club-91',u,{limit:3});msg(a,'new-after-page','club-91','2026-01-02T00:00:00Z');
 const ids=first.messages.map(m=>m.id);let cursor=first.nextCursor;while(cursor){const page=a.roomHistoryPage('club-91',u,{limit:3,before:cursor});ids.push(...page.messages.map(m=>m.id));cursor=page.nextCursor}assert.equal(ids.length,9);assert.equal(new Set(ids).size,9);assert.ok(!ids.includes('new-after-page'));assert.throws(()=>a.roomHistoryPage('club-91','unknown-user'),/权限/);assert.throws(()=>a.roomHistoryPage('club-91',u,{before:{id:'x',timestamp:'bad'}}),/游标/);
 const sock=await connect(a,t);await emitWait(sock,'login',{account:'testadmin',password:'Synthetic-Test-Password-Only'},'authSuccess');const result=await ack(sock,'get room history',{roomId:'club-91',limit:2});assert.equal(result.ok,true);assert.equal(result.messages.length,2);assert.ok(result.nextCursor);
});
test('U15 archived reports stay addressable after post deletion and legacy table migration preserves extra columns',t=>{
 const a=fixture(t);post(a,'post:test');a.db.prepare('INSERT INTO post_reports(id,post_id,reporter_user_id,reported_user_id,reason,details,status,created_at) VALUES(?,?,?,?,?,?,?,?)').run('report:test','post:test',a.users[0].id,a.users[0].id,'spam','retained report','pending','2026-01-01');
 a.deleteForumPostById('post:test');const report=a.db.prepare('SELECT * FROM post_reports').get();assert.equal(report.post_id,'');assert.equal(report.original_post_id,'post:test');assert.equal(report.details,'retained report');assert.equal(report.status,'post_deleted');
 a.db.exec("CREATE TABLE legacy_probe(old_id TEXT,content TEXT,extra TEXT); INSERT INTO legacy_probe VALUES('a','kept','original extra'),('a','duplicate','also retained')");
 const migration={tableName:'legacy_probe',legacyIdColumn:'old_id',columnsSql:'id TEXT PRIMARY KEY,content TEXT',copySql:table=>`INSERT OR IGNORE INTO legacy_probe SELECT old_id,content FROM ${table}`};
 assert.throws(()=>a.migrateForumTable(migration),/omit/);assert.equal(a.db.prepare('SELECT count(*) n FROM legacy_probe').get().n,2);assert.ok(a.db.prepare('PRAGMA table_info(legacy_probe)').all().some(c=>c.name==='extra'));
 a.db.exec("UPDATE legacy_probe SET old_id='b' WHERE content='duplicate'");a.migrateForumTable(migration);assert.equal(a.db.prepare('SELECT count(*) n FROM legacy_probe').get().n,2);const archive=a.db.prepare('SELECT row_json FROM legacy_table_archive').all().map(x=>JSON.parse(x.row_json));assert.equal(archive.length,2);assert.ok(archive.some(r=>r.extra==='original extra'));
});
test('U06 restore metadata failure is recoverable without losing the restored file',t=>{
 const a=fixture(t),im=a.savePostImageUpload(a.users[0],pngUrl).image;
 a.transaction(a.refreshPostImageReferences);a.db.exec("UPDATE post_images SET unbound_at='2000-01-01'");a.cleanupOrphanPostImages();
 a.db.exec("CREATE TRIGGER fail_restore BEFORE UPDATE OF quarantined_at ON post_images WHEN NEW.quarantined_at='' BEGIN SELECT RAISE(ABORT,'restore interrupted'); END");assert.throws(()=>a.recoverQuarantinedPostImages(true));assert.ok(fs.existsSync(path.join(a.dir,im.url)));a.db.exec('DROP TRIGGER fail_restore');a.recoverQuarantinedPostImages();assert.equal(a.db.prepare('SELECT quarantined_at FROM post_images').get().quarantined_at,'');
});
