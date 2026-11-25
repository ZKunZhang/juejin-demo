import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { expect,test } from 'vitest';
import { buildApp } from '../apps/api/app/app';
import { connectDatabase } from '../apps/api/shared/db';
import { digest,sessionName } from '../apps/api/shared/security';

const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('A dedicated TEST_DATABASE_URL ending in _test is required');

test('creator metrics and draft lists stay scoped to the signed-in author',async()=>{
  const db=connectDatabase(url);
  const app=await buildApp(db,{origins:[]});
  const key=randomBytes(6).toString('hex');
  const ids:string[]=[];
  async function account(suffix:string) {
    const token=randomBytes(32).toString('hex');
    const user=await db.user.create({data:{displayName:suffix,username:'creator_'+key+suffix,passwordHash:'fixture',
      sessions:{create:{tokenHash:digest(token),expiresAt:new Date(Date.now()+60000)}}}});
    ids.push(user.id);
    return {id:user.id,headers:{cookie:sessionName+'='+token}};
  }
  try{
    const author=await account('author'),reader=await account('reader');
    const visible=await db.article.create({data:{title:'文章',bodyMarkdown:'正文',authorId:author.id,status:'PUBLISHED',reviewStatus:'APPROVED',publishedAt:new Date(),viewCount:12}});
    await db.article.create({data:{title:'下架文章',bodyMarkdown:'正文',authorId:author.id,status:'UNLISTED',reviewStatus:'APPROVED',viewCount:100}});
    await db.article.create({data:{title:'其他作者',bodyMarkdown:'正文',authorId:reader.id,status:'PUBLISHED',reviewStatus:'APPROVED',publishedAt:new Date(),viewCount:7}});
    const draft=await db.article.create({data:{title:'早期草稿',bodyMarkdown:'草稿',authorId:author.id,updatedAt:new Date(0)}});
    await db.article.createMany({data:Array.from({length:101},()=>({title:'待审核',authorId:author.id,bodyMarkdown:'待审核',reviewStatus:'PENDING' as const}))});
    await db.userFollow.create({data:{followerId:reader.id,followeeId:author.id}});
    await db.articleLike.create({data:{userId:reader.id,articleId:visible.id}});
    await db.articleBookmark.create({data:{userId:reader.id,articleId:visible.id}});
    await db.comment.createMany({data:[
      {authorId:reader.id,articleId:visible.id,body:'可见评论',status:'VISIBLE'},
      {authorId:reader.id,articleId:visible.id,body:'隐藏评论',status:'HIDDEN'},
    ]});
    expect((await app.inject('/api/me/creator')).statusCode).toBe(401);
    const overview=(await app.inject({url:'/api/me/creator',headers:author.headers})).json();
    const latest=await app.inject('/api/articles?tab=latest');
    expect(latest.statusCode).toBe(200);
    const recommendations=await app.inject('/api/articles?tab=recommended&limit=1');
    expect(recommendations.statusCode).toBe(200);
    const cursor=recommendations.json().nextCursor;
    expect(cursor).toBeTruthy();
    expect((await app.inject('/api/articles?tab=recommended&cursor='+cursor)).statusCode).toBe(200);
    expect((await app.inject('/api/articles?tab=latest&cursor='+cursor)).statusCode).toBe(400);
    expect((await app.inject('/api/articles?tab=following')).statusCode).toBe(401);
    const followed=(await app.inject({url:'/api/articles?tab=following',headers:reader.headers})).json();
    expect(followed.items.map((row:{id:string})=>row.id)).toEqual([visible.id]);
    const other=(await app.inject({url:'/api/me/creator',headers:reader.headers})).json();
    expect(overview.stats).toEqual({followers:1,following:0,views:12,likes:1,comments:1,bookmarks:1});
    expect(other.stats).toEqual({followers:0,following:1,views:7,likes:0,comments:0,bookmarks:0});
    expect(overview.recentArticles.every((row:{title:string})=>row.title!=='其他作者')).toBe(true);
    const drafts=(await app.inject({url:'/api/me/articles?status=draft&page=1',headers:author.headers})).json();
    expect(drafts.map((row:{id:string})=>row.id)).toEqual([draft.id]);
    expect((await app.inject({url:'/api/me/articles?status=draft',headers:reader.headers})).json()).toEqual([]);
  }finally{
    await db.comment.deleteMany({where:{authorId:{in:ids}}});
    await db.article.deleteMany({where:{authorId:{in:ids}}});
    await db.user.deleteMany({where:{id:{in:ids}}});
    await app.close();await db.$disconnect();
  }
});
