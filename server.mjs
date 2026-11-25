import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { seed } from './seed.mjs';

mkdirSync(new URL('./data/',import.meta.url),{recursive:true});
const db = new DatabaseSync(process.env.DATABASE_PATH || new URL('./data/community.sqlite',import.meta.url));
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
seed(db);
const query = (sql,...params)=>db.prepare(sql).all(...params);
const one = (sql,...params)=>db.prepare(sql).get(...params);
const run = (sql,...params)=>db.prepare(sql).run(...params);
const hash = value => createHash('sha256').update(value).digest('hex');
const day = ()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format();
const profiles = 'id,handle,name,bio,avatar,website,created_at';
const getUser = id=>one('SELECT '+profiles+' FROM users WHERE id=?',id);
const postSql = `SELECT p.*,u.name,u.avatar,u.handle,
  (SELECT count(*) FROM likes WHERE post_id=p.id) likes,
  (SELECT count(*) FROM comments WHERE post_id=p.id) comments,
  EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) liked,
  EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=?) saved,
  COALESCE((SELECT group_concat(t.name,' · ') FROM tags t JOIN post_tags pt ON t.id=pt.tag_id WHERE pt.post_id=p.id),'') tags
  FROM posts p JOIN users u ON u.id=p.user_id`;
const posts = (uid,where,args=[],order='p.id DESC')=>query(postSql+' WHERE '+where+' ORDER BY '+order+' LIMIT 100',uid,uid,...args);
const fail = (status,message)=>{throw Object.assign(new Error(message),{status});};
const field = (body,key,max,required=false)=>{
  if (body[key] == null && !required) return '';
  if (typeof body[key]!=='string') fail(400,'字段格式有误');
  const value=body[key].trim();
  if (value.length>max || (required && !value)) fail(400,'请检查必填字段和内容长度');
  return value;
};
const web = value=>{
  if (!value) return '';
  try { const url=new URL(value); if (['http:','https:'].includes(url.protocol)) return url.href; } catch {}
  fail(400,'请输入有效的 HTTP 或 HTTPS 地址');
};
const picture = value=>{
  if (!value) return '';
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return value;
  fail(400,'请选择 PNG、JPEG、WebP 或 GIF 图片');
};
async function readBody(req){
  let size=0;
  const chunks=[];
  for await (const chunk of req){
    size+=chunk.length;
    if (size>3_100_000) fail(413,'请求过大');
    chunks.push(chunk);
  }
  try {
    const value=JSON.parse(Buffer.concat(chunks).toString());
    if (value && typeof value==='object' && !Array.isArray(value)) return value;
  } catch {}
  fail(400,'请求格式有误');
}
function cookie(res,token,age){
  res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${process.env.SECURE_COOKIES==='1'?'; Secure':''}`);
}
async function api(req,res,url){
  const path=url.pathname;
  const method=req.method;
  const token=(req.headers.cookie || '').match(/(?:^|; )session=([0-9a-f]{64})(?:;|$)/)?.[1];
  const uid=token ? one('SELECT user_id FROM sessions WHERE token_hash=? AND expires>?',hash(token),Date.now())?.user_id || 0 : 0;
  const param=name=>url.searchParams.get(name) || '';
  if (method==='GET'){
    if (path==='/api/me') return {user:getUser(uid)||null,checked:!!one('SELECT 1 FROM checkins WHERE user_id=? AND day=?',uid,day())};
    if (path==='/api/tags') return query('SELECT * FROM tags ORDER BY id');
    if (path==='/api/feed'){
      const kind=param('kind')==='pulse'?'pulse':'article';
      const filters=['p.kind=?'];
      const args=[kind];
      if(param('tag')){filters.push('EXISTS(SELECT 1 FROM post_tags WHERE post_id=p.id AND tag_id=?)');args.push(Number(param('tag'))||0);}
      if(param('q')){filters.push('instr(lower(p.title || p.body),lower(?))>0');args.push(param('q').slice(0,100));}
      if(param('tab')==='following'){filters.push('p.user_id IN (SELECT target_id FROM follows WHERE user_id=?)');args.push(uid);}
      if(param('tab')==='featured') filters.push('p.featured=1');
      return posts(uid,filters.join(' AND '),args,param('tab')==='recommended'?'p.featured DESC, likes DESC, p.views DESC, p.id DESC':undefined);
    }
    const detail=path.match(/^\/api\/posts\/(\d+)$/);
    if(detail){
      const id=Number(detail[1]);
      const post=posts(uid,'p.id=?',[id])[0];
      if(!post) fail(404,'内容不存在');
      if(post.kind==='article' && param('view')==='1'){run('UPDATE posts SET views=views+1 WHERE id=?',id);post.views++;}
      return {post,following:!!one('SELECT 1 FROM follows WHERE user_id=? AND target_id=?',uid,post.user_id),
        comments:query('SELECT c.*,u.name,u.avatar FROM comments c JOIN users u ON u.id=c.user_id WHERE post_id=? ORDER BY c.id',id),
        related:posts(uid,"p.kind='article' AND p.id<>? AND EXISTS(SELECT 1 FROM post_tags a JOIN post_tags b USING(tag_id) WHERE a.post_id=p.id AND b.post_id=?)",[id,id]).slice(0,4)};
    }
    const profile=path.match(/^\/api\/users\/(\d+)$/);
    if(profile){
      const id=Number(profile[1]), user=getUser(id);
      if(!user) fail(404,'用户不存在');
      return {user,following:!!one('SELECT 1 FROM follows WHERE user_id=? AND target_id=?',uid,id),
        stats:one(`SELECT (SELECT count(*) FROM likes l JOIN posts p ON p.id=l.post_id WHERE p.user_id=? AND p.kind='article') likes,
          (SELECT coalesce(sum(views),0) FROM posts WHERE user_id=? AND kind='article') views,
          (SELECT count(*) FROM follows WHERE user_id=?) following,(SELECT count(*) FROM follows WHERE target_id=?) followers`,id,id,id,id),
        posts:posts(uid,'p.user_id=?',[id]),
        bookmarks:posts(uid,'EXISTS(SELECT 1 FROM bookmarks WHERE user_id=? AND post_id=p.id)',[id]),
        likes:posts(uid,'EXISTS(SELECT 1 FROM likes WHERE user_id=? AND post_id=p.id)',[id]),
        follows:query('SELECT u.id,u.name,u.avatar,u.bio FROM follows f JOIN users u ON u.id=f.target_id WHERE f.user_id=? ORDER BY u.id',id)};
    }
    if(path==='/api/courses') return query('SELECT c.*,(SELECT count(*) FROM lessons WHERE course_id=c.id) chapters FROM courses c WHERE (?=\'\' OR category=?) AND (?=\'\' OR level=?) ORDER BY c.id',param('category'),param('category'),param('level'),param('level'));
    const course=path.match(/^\/api\/courses\/(\d+)$/);
    if(course){
      const item=one('SELECT * FROM courses WHERE id=?',Number(course[1]));
      if(!item) fail(404,'小册不存在');
      return {course:item,lessons:query('SELECT * FROM lessons WHERE course_id=? ORDER BY position',item.id),related:query('SELECT * FROM courses WHERE id<>? ORDER BY (category=?) DESC,id LIMIT 3',item.id,item.category)};
    }
    fail(404,'接口不存在');
  }
  if(method!=='POST') fail(405,'请求方法不支持');
  if(req.headers['sec-fetch-site']==='cross-site' || (req.headers.origin && req.headers.origin!==`http${process.env.SECURE_COOKIES==='1'?'s':''}://${req.headers.host}`)) fail(403,'请求来源无效');
  const body=await readBody(req);
  if(path==='/api/register' || path==='/api/login'){
    const handle=field(body,'handle',24,true);
    const password=body.password;
    if(!/^[a-zA-Z0-9_]{3,24}$/.test(handle) || typeof password!=='string' || password.length<8 || password.length>128) fail(400,'用户名须为 3–24 位字母、数字或下划线，密码须为 8–128 位');
    let account=one('SELECT * FROM users WHERE handle=?',handle);
    if(path==='/api/register'){
      if(account) fail(409,'该用户名已使用');
      const name=field(body,'name',32,true), salt=randomBytes(16).toString('hex');
      const id=run('INSERT INTO users(handle,name,avatar,password) VALUES(?,?,?,?)',handle,name,Array.from(name)[0],salt+':'+scryptSync(password,salt,64).toString('hex')).lastInsertRowid;
      account=getUser(id);
      res.statusCode=201;
    }else{
      const [salt,key]=(account?.password || '').split(':');
      const candidate=scryptSync(password,salt || 'invalid-account',64);
      if(!key || !timingSafeEqual(candidate,Buffer.from(key,'hex'))) fail(401,'用户名或密码错误');
    }
    if(token) run('DELETE FROM sessions WHERE token_hash=?',hash(token));
    run('DELETE FROM sessions WHERE expires<=?',Date.now());
    const newToken=randomBytes(32).toString('hex'), age=604800;
    run('INSERT INTO sessions VALUES(?,?,?)',hash(newToken),account.id,Date.now()+age*1000);
    cookie(res,newToken,age);
    return getUser(account.id);
  }
  if(path==='/api/logout'){
    if(token) run('DELETE FROM sessions WHERE token_hash=?',hash(token));
    cookie(res,'',0);
    return {ok:true};
  }
  if(!uid) fail(401,'请先登录');
  if(path==='/api/profile'){
    const name=field(body,'name',32,true), avatar=picture(field(body,'avatar',2_800_000));
    run('UPDATE users SET name=?,bio=?,website=?,avatar=? WHERE id=?',name,field(body,'bio',240),web(field(body,'website',400)),avatar||Array.from(name)[0],uid);
    return getUser(uid);
  }
  if(path==='/api/checkin'){
    run('INSERT INTO checkins VALUES(?,?) ON CONFLICT DO NOTHING',uid,day());
    return {checked:true};
  }
  if(path==='/api/posts'){
    const kind=field(body,'kind',10,true);
    if(!['article','pulse'].includes(kind)) fail(400,'内容类型有误');
    const title=field(body,'title',120,kind==='article'), content=field(body,'body',kind==='article'?60000:2000,true);
    const image=kind==='pulse'?picture(field(body,'image',2_800_000)):'';
    const series=kind==='article'?field(body,'series',60):'';
    const tag=Number(body.tag)||0;
    if(tag && !one('SELECT 1 FROM tags WHERE id=?',tag)) fail(400,'标签不存在');
    db.exec('BEGIN');
    try {
      const id=run('INSERT INTO posts(user_id,kind,title,body,image,series) VALUES(?,?,?,?,?,?)',uid,kind,title,content,image,series).lastInsertRowid;
      if(tag) run('INSERT INTO post_tags VALUES(?,?)',id,tag);
      db.exec('COMMIT');
      res.statusCode=201;
      return {id};
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  const action=path.match(/^\/api\/posts\/(\d+)\/(like|save|comment)$/);
  if(action){
    const id=Number(action[1]);
    if(!one('SELECT 1 FROM posts WHERE id=?',id)) fail(404,'内容不存在');
    if(action[2]==='comment'){
      const result=run('INSERT INTO comments(post_id,user_id,body) VALUES(?,?,?)',id,uid,field(body,'body',2000,true));
      res.statusCode=201;
      return {id:result.lastInsertRowid};
    }
    const table=action[2]==='like'?'likes':'bookmarks';
    if(typeof body.active!=='boolean') fail(400,'状态有误');
    if(body.active) run('INSERT INTO '+table+' VALUES(?,?) ON CONFLICT DO NOTHING',uid,id);
    else run('DELETE FROM '+table+' WHERE user_id=? AND post_id=?',uid,id);
    return {active:body.active};
  }
  const follow=path.match(/^\/api\/users\/(\d+)\/follow$/);
  if(follow){
    const target=Number(follow[1]);
    if(target===uid || typeof body.active!=='boolean') fail(400,'关注操作有误');
    if(!getUser(target)) fail(404,'用户不存在');
    if(body.active) run('INSERT INTO follows VALUES(?,?) ON CONFLICT DO NOTHING',uid,target);
    else run('DELETE FROM follows WHERE user_id=? AND target_id=?',uid,target);
    return {active:body.active};
  }
  fail(404,'接口不存在');
}
const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/styles.css':'styles.css','/sample.png':'sample.png'};
const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',png:'image/png'};
createServer(async (req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')){
      res.setHeader('Content-Type','application/json; charset=utf-8');
      res.setHeader('Cache-Control','no-store');
      res.end(JSON.stringify(await api(req,res,url)));
    }else if(req.method==='GET' && Object.hasOwn(files,url.pathname)){
      const file=files[url.pathname];
      res.setHeader('Content-Type',types[file.split('.').pop()]);
      res.end(readFileSync(new URL('./public/'+file,import.meta.url)));
    }else fail(404,'页面不存在');
  }catch(error){
    if(!error.status) console.error(error);
    res.statusCode=error.status||500;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.end(JSON.stringify({error:error.status?error.message:'服务暂时不可用'}));
  }
}).listen(Number(process.env.PORT || 3000),process.env.HOST || '127.0.0.1',function(){
  console.log('码栈 · http://'+this.address().address+':'+this.address().port);
});
