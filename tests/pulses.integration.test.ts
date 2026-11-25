import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { expect,test } from 'vitest';
import { buildApp } from '../apps/api/app/app';
import { connectDatabase } from '../apps/api/shared/db';
import { digest,sessionName } from '../apps/api/shared/security';

const origin='http://127.0.0.1:5173';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('A dedicated TEST_DATABASE_URL ending in _test is required');
test('pulse publish, image validation, tag, followed feed, like and day check-in persist',async()=>{
  const db=connectDatabase(url);
  const app=await buildApp(db,{origins:[origin]});
  const ids:string[]=[];
  const key=randomBytes(5).toString('hex');
  async function actor(suffix:string, role:'ADMIN'|'USER'='USER') {
    const token=randomBytes(32).toString('hex');
    const row=await db.user.create({data:{username:'pulse_'+key+suffix,displayName:suffix,role,passwordHash:'fixture',sessions:{create:{tokenHash:digest(token),expiresAt:new Date(Date.now()+60000)}}}});
    ids.push(row.id);
    const csrf=await app.inject({method:'GET',url:'/api/auth/csrf'});
    const cookie=[sessionName+'='+token,...[csrf.headers['set-cookie']||[]].flat().map(value=>value.split(';')[0])].join('; ');
    return {id:row.id,headers:{cookie,origin,'x-csrf-token':csrf.json().csrfToken}};
  }
  try{
    const author=await actor('author'), reader=await actor('reader'), admin=await actor('admin','ADMIN');
    const tag=await db.tag.findUniqueOrThrow({where:{slug:'work-break'}});
    expect((await app.inject('/api/tags')).json()).not.toContainEqual(expect.objectContaining({id:tag.id}));
    expect((await app.inject('/api/pulses/topics')).json()).toContainEqual(expect.objectContaining({id:tag.id,name:'上班摸鱼'}));
    const blocked=await app.inject({method:'POST',url:'/api/articles',headers:author.headers,payload:{title:'文章测试',bodyMarkdown:'正文',tagIds:[tag.id]}});
    expect(blocked.statusCode).toBe(400);
    expect(await db.article.count({where:{authorId:author.id}})).toBe(0);
    const input={body:'',images:['https://example.com/pulse.png'],tagId:tag.id};
    const create=(payload:typeof input)=>app.inject({method:'POST',url:'/api/pulses',headers:author.headers,payload});
    expect((await create({...input,images:[]})).statusCode).toBe(400);
    expect((await create({...input,images:['http://example.com/p.png']})).statusCode).toBe(400);
    const published=await create(input);
    expect(published.statusCode).toBe(201);
    const {id,status}=published.json();
    expect(status).toBe('PENDING');
    expect((await app.inject('/api/pulses')).json()).not.toContainEqual(expect.objectContaining({id}));
    expect((await app.inject('/api/pulses/'+id)).statusCode).toBe(404);
    const review=(headers:typeof admin.headers,expectedStatus:string,status:string,reason?:string)=>app.inject({
      method:'PATCH',url:'/api/admin/pulses/'+id+'/status',headers,payload:{expectedStatus,status,...(reason?{reason}:{})},
    });
    const commentPath='/api/pulses/'+id+'/comments';
    const comment=()=>app.inject({method:'POST',url:commentPath,headers:reader.headers,payload:{body:' 测试沸点评论 '}});
    expect((await comment()).statusCode).toBe(404);
    expect((await review(reader.headers,'PENDING','PUBLISHED')).statusCode).toBe(403);
    expect((await review(admin.headers,'PENDING','PUBLISHED')).statusCode).toBe(200);
    expect((await review(admin.headers,'PENDING','PUBLISHED')).statusCode).toBe(409);
    const createdComment=await comment();
    expect(createdComment.statusCode).toBe(201);
    const commentId=createdComment.json().id;
    const detail=(await app.inject('/api/pulses/'+id)).json();
    expect(detail.pulse.id).toBe(id);
    expect(detail.pulse._count.comments).toBe(1);
    expect(detail.related).not.toContainEqual(expect.objectContaining({id}));
    const addReply=(parentId:string)=>app.inject({method:'POST',url:commentPath,headers:author.headers,payload:{body:'沸点回复',parentId}});
    const reply=await addReply(commentId);
    expect(reply.statusCode).toBe(201);
    const replyId=reply.json().id;
    expect((await addReply(replyId)).statusCode).toBe(404);
    const vote=()=>app.inject({method:'PUT',url:commentPath+'/'+replyId+'/like',headers:reader.headers,payload:{active:true}});
    expect((await vote()).json()).toEqual({liked:true,likeCount:1});
    expect((await vote()).json()).toEqual({liked:true,likeCount:1});
    const thread=(await app.inject({url:commentPath+'?page=1&sort=hot',headers:reader.headers})).json();
    expect(thread).toEqual([expect.objectContaining({id:commentId,replies:[expect.objectContaining({id:replyId,liked:true,likeCount:1})]})]);
    await db.pulseComment.createMany({data:Array.from({length:20},(_,index)=>({
      pulseId:id,authorId:author.id,parentId:commentId,body:'较早回复 '+index,createdAt:new Date(index),
    }))});
    const recent=(await app.inject(commentPath+'?page=1')).json()[0].replies;
    expect(recent).toHaveLength(20);
    expect(recent.at(-1).id).toBe(replyId);
    expect((await app.inject(commentPath)).json()).toEqual([expect.objectContaining({id:commentId,body:'测试沸点评论',author:expect.objectContaining({id:reader.id})})]);
    expect((await app.inject({url:'/api/admin/pulse-comments',headers:reader.headers})).statusCode).toBe(403);
    expect((await app.inject({url:'/api/admin/pulse-comments?status=VISIBLE',headers:admin.headers})).json().items).toContainEqual(expect.objectContaining({id:commentId,pulse:expect.objectContaining({id})}));
    const commentReview=(expectedStatus:string,status:string,reason?:string)=>app.inject({
      method:'PATCH',url:'/api/admin/pulse-comments/'+commentId+'/status',headers:admin.headers,
      payload:{expectedStatus,status,...(reason?{reason}:{})},
    });
    expect((await commentReview('VISIBLE','HIDDEN')).statusCode).toBe(400);
    expect((await commentReview('VISIBLE','HIDDEN','测试隐藏')).statusCode).toBe(200);
    expect((await app.inject(commentPath)).json()).toEqual([]);
    expect((await vote()).statusCode).toBe(404);
    expect((await app.inject('/api/pulses?tab=following')).statusCode).toBe(401);
    await db.userFollow.create({data:{followerId:reader.id,followeeId:author.id}});
    const feed=await app.inject({url:'/api/pulses?tab=following&tagId='+tag.id,headers:reader.headers});
    expect(feed.json()).toEqual([expect.objectContaining({id,images:input.images,following:true,author:expect.objectContaining({displayName:'author',avatarUrl:null}),_count:{likes:0,comments:0}})]);
    const like=()=>app.inject({method:'PUT',url:'/api/pulses/'+id+'/like',headers:reader.headers,payload:{active:true}});
    expect((await Promise.all([like(),like()])).map(item=>item.statusCode)).toEqual([200,200]);
    expect(await db.pulseLike.count({where:{pulseId:id}})).toBe(1);
    expect((await commentReview('HIDDEN','VISIBLE')).statusCode).toBe(200);
    expect((await app.inject(commentPath)).json()).toHaveLength(1);
    expect(await db.pulseCommentReview.count({where:{commentId}})).toBe(2);
    expect((await app.inject('/api/pulses/leaderboard')).json()).toContainEqual({id:author.id,displayName:'author',likes:1,pulses:1});
    expect((await review(admin.headers,'PUBLISHED','UNLISTED','测试下架')).statusCode).toBe(200);
    expect((await app.inject(commentPath)).statusCode).toBe(404);
    expect((await app.inject('/api/pulses/'+id)).statusCode).toBe(404);
    expect((await like()).statusCode).toBe(404);
    expect((await app.inject('/api/pulses/leaderboard')).json()).not.toContainEqual(expect.objectContaining({id:author.id}));
    expect((await review(reader.headers,'UNLISTED','PUBLISHED')).statusCode).toBe(403);
    expect((await review(admin.headers,'UNLISTED','PUBLISHED')).statusCode).toBe(200);
    expect((await review(admin.headers,'UNLISTED','PUBLISHED')).statusCode).toBe(409);
    expect((await app.inject('/api/pulses/'+id)).statusCode).toBe(200);
    expect((await app.inject(commentPath)).json()).toHaveLength(1);
    expect(await db.pulseReview.findMany({where:{pulseId:id},orderBy:{createdAt:'asc'},select:{fromStatus:true,toStatus:true}})).toEqual([
      {fromStatus:'PENDING',toStatus:'PUBLISHED'},
      {fromStatus:'PUBLISHED',toStatus:'UNLISTED'},
      {fromStatus:'UNLISTED',toStatus:'PUBLISHED'},
    ]);
    expect(await db.notification.count({where:{targetId:id}})).toBe(0);
    const check=()=>app.inject({method:'POST',url:'/api/me/checkin',headers:reader.headers});
    expect((await Promise.all([check(),check()])).map(item=>item.json())).toEqual([{checked:true},{checked:true}]);
    expect(await db.checkin.count({where:{userId:reader.id}})).toBe(1);
  }finally{
    await db.pulse.deleteMany({where:{authorId:{in:ids}}});
    await db.user.deleteMany({where:{id:{in:ids}}});
    await app.close();await db.$disconnect();
  }
});
