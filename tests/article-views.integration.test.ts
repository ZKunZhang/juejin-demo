import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { expect,test } from 'vitest';
import { buildApp } from '../apps/api/app/app';
import { connectDatabase } from '../apps/api/shared/db';

const origin='http://127.0.0.1:5173';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('A dedicated TEST_DATABASE_URL ending in _test is required');

test('article views are persisted once per session and window, including concurrent requests',async()=>{
  const db=connectDatabase(url);
  const app=await buildApp(db,{origins:[origin]});
  const user=await db.user.create({data:{username:'views_'+randomBytes(8).toString('hex'),displayName:'作者',passwordHash:'fixture'}});
  try {
    const article=await db.article.create({data:{authorId:user.id,title:'浏览量测试',bodyMarkdown:'# 测试',status:'PUBLISHED',reviewStatus:'APPROVED',publishedAt:new Date()}});
    const detail='/api/articles/'+article.id;
    async function visitor() {
      const opened=await app.inject({method:'GET',url:detail});
      const csrf=await app.inject({method:'GET',url:'/api/auth/csrf'});
      const cookie=[opened,csrf].flatMap(response=>[response.headers['set-cookie']??[]].flat().map(value=>value.split(';')[0])).join('; ');
      return {cookie,origin,'x-csrf-token':csrf.json().csrfToken};
    }
    const first=await visitor(), second=await visitor();
    const post=(headers:typeof first)=>app.inject({method:'POST',url:detail+'/views',headers});
    const concurrent=await Promise.all([post(first),post(first)]);
    expect(concurrent.map(response=>response.json())).toEqual([{viewCount:1},{viewCount:1}]);
    expect((await post(second)).json()).toEqual({viewCount:2});
    expect((await app.inject(detail)).json().viewCount).toBe(2);
    await db.articleViewWindow.updateMany({where:{articleId:article.id},data:{lastCountedAt:new Date(Date.now()-31*60*1000)}});
    expect((await post(first)).json()).toEqual({viewCount:3});
    expect(await db.articleViewWindow.count({where:{articleId:article.id}})).toBe(2);
    await db.article.update({where:{id:article.id},data:{status:'UNLISTED'}});
    expect((await post(second)).statusCode).toBe(404);
    expect((await db.article.findUnique({where:{id:article.id}}))?.viewCount).toBe(3);
  }finally{
    await db.article.deleteMany({where:{authorId:user.id}});
    await db.user.delete({where:{id:user.id}});
    await app.close();await db.$disconnect();
  }
});
