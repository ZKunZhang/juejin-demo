import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { expect,test } from 'vitest';
import { buildApp } from '../apps/api/app';
import { connectDatabase } from '../apps/api/db';
import { digest,sessionName } from '../apps/api/security';

const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('A dedicated TEST_DATABASE_URL ending in _test is required');
const origin='http://127.0.0.1:5173';
const inbox='/api/me/notifications';

test('first public approvals notify current followers once and only recipients can mark them read',async()=>{
  const db=connectDatabase(url);
  const app=await buildApp(db,{origins:[origin]});
  const suffix=randomBytes(6).toString('hex');
  const ids:string[]=[];
  async function createUser(name:string,role:'USER'|'ADMIN'='USER') {
    const token=randomBytes(32).toString('hex');
    const actor=await db.user.create({data:{username:'notice_'+suffix+name,displayName:name,passwordHash:'fixture',role,
      sessions:{create:{tokenHash:digest(token),expiresAt:new Date(Date.now()+60000)}}}});
    ids.push(actor.id);
    const csrf=await app.inject({method:'GET',url:'/api/auth/csrf'});
    const cookie=[sessionName+'='+token,...[csrf.headers['set-cookie']??[]].flat().map(value=>value.split(';')[0])].join('; ');
    return {id:actor.id,headers:{cookie,origin,'x-csrf-token':csrf.json().csrfToken}};
  }

  try {
    const author=await createUser('author'),follower=await createUser('follower'),outsider=await createUser('outsider'),admin=await createUser('admin','ADMIN');
    const follow=(id:string)=>db.userFollow.create({data:{followerId:id,followeeId:author.id}});
    await follow(follower.id);
    const article=await db.article.create({data:{authorId:author.id,title:'通知验收文章',bodyMarkdown:'正文',reviewStatus:'PENDING'}});
    const pulse=await db.pulse.create({data:{authorId:author.id,body:'通知验收沸点',status:'PENDING'}});
    const approve=(id:string,version:number)=>app.inject({method:'POST',url:'/api/admin/articles/'+id+'/review',headers:admin.headers,payload:{version,action:'APPROVE'}});
    const reviewPulse=(id:string)=>app.inject({method:'PATCH',url:'/api/admin/pulses/'+id+'/status',headers:admin.headers,payload:{expectedStatus:'PENDING',status:'PUBLISHED'}});
    const list=(user:typeof follower)=>app.inject({url:inbox,headers:user.headers});
    const unread=(user:typeof follower)=>app.inject({url:inbox+'/unread',headers:user.headers});
    expect((await app.inject(inbox)).statusCode).toBe(401);
    expect((await unread(follower)).json()).toMatchObject({count:0});
    expect((await list(follower)).json().items).toEqual([]);

    const rejected=await db.article.create({data:{authorId:author.id,title:'驳回样例',bodyMarkdown:'正文',reviewStatus:'PENDING'}});
    const reject=await app.inject({method:'POST',url:'/api/admin/articles/'+rejected.id+'/review',headers:admin.headers,payload:{version:rejected.version,action:'REJECT',reason:'测试驳回'}});
    expect(reject.statusCode).toBe(200);
    expect((await unread(follower)).json()).toMatchObject({count:0});

    const attempts=await Promise.all([approve(article.id,article.version),approve(article.id,article.version)]);
    expect(attempts.map(response=>response.statusCode).sort()).toEqual([200,409]);
    expect((await reviewPulse(pulse.id)).statusCode).toBe(200);
    expect((await reviewPulse(pulse.id)).statusCode).toBe(409);
    const items=(await list(follower)).json().items;
    expect(items).toHaveLength(2);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({kind:'ARTICLE_PUBLISHED',targetId:article.id,preview:article.title,readAt:null,actor:{displayName:'author'}}),
      expect.objectContaining({kind:'PULSE_PUBLISHED',targetId:pulse.id,preview:pulse.body,readAt:null}),
    ]));
    expect((await unread(follower)).json()).toEqual({count:2,byKind:{ARTICLE_PUBLISHED:1,PULSE_PUBLISHED:1}});
    expect((await app.inject({url:inbox+'?kind=PULSE_PUBLISHED',headers:follower.headers})).json().items)
      .toEqual([expect.objectContaining({targetId:pulse.id})]);
    expect((await list(outsider)).json().items).toEqual([]);
    expect((await list(author)).json().items).toEqual([]);
    const mark=(user:typeof follower,id:string)=>app.inject({method:'PUT',url:inbox+'/'+id+'/read',headers:user.headers});
    expect((await mark(outsider,items[0].id)).statusCode).toBe(404);
    expect((await mark(follower,items[0].id)).statusCode).toBe(204);
    const once=(await db.notification.findUniqueOrThrow({where:{id:items[0].id}})).readAt;
    expect((await mark(follower,items[0].id)).statusCode).toBe(204);
    expect((await db.notification.findUniqueOrThrow({where:{id:items[0].id}})).readAt).toEqual(once);
    expect((await unread(follower)).json()).toMatchObject({count:1});
    expect((await app.inject({method:'POST',url:inbox+'/read-all?kind='+items[0].kind,headers:follower.headers})).statusCode).toBe(204);
    expect((await unread(follower)).json()).toMatchObject({count:1});

    await db.userFollow.delete({where:{followerId_followeeId:{followerId:follower.id,followeeId:author.id}}});
    await follow(outsider.id);
    const again=await db.article.update({where:{id:article.id},data:{status:'DRAFT',reviewStatus:'PENDING',version:{increment:1}}});
    expect((await approve(again.id,again.version)).statusCode).toBe(200);
    expect((await unread(outsider)).json()).toMatchObject({count:0});
    const fresh=await db.pulse.create({data:{authorId:author.id,body:'取关后的新沸点',status:'PENDING'}});
    expect((await reviewPulse(fresh.id)).statusCode).toBe(200);
    expect((await list(follower)).json().items).toHaveLength(2);
    expect((await list(outsider)).json().items).toEqual([expect.objectContaining({targetId:fresh.id,readAt:null})]);
    expect((await app.inject({method:'POST',url:inbox+'/read-all',headers:follower.headers})).statusCode).toBe(204);
    expect((await unread(follower)).json()).toMatchObject({count:0});
    expect((await unread(outsider)).json()).toMatchObject({count:1});
  }finally{
    await db.articleReview.deleteMany({where:{article:{authorId:{in:ids}}}});
    await db.article.deleteMany({where:{authorId:{in:ids}}});
    await db.pulse.deleteMany({where:{authorId:{in:ids}}});
    await db.user.deleteMany({where:{id:{in:ids}}});
    await app.close();
    await db.$disconnect();
  }
});
