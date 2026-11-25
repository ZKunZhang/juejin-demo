import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { expect,test } from 'vitest';
import { buildApp } from '../apps/api/app/app';
import { connectDatabase } from '../apps/api/shared/db';
import { digest,sessionName } from '../apps/api/shared/security';

const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('A dedicated TEST_DATABASE_URL ending in _test is required');

test('admin date filters include the entire Beijing day and stay compatible with source filters',async()=>{
  const db=connectDatabase(url);
  const app=await buildApp(db,{origins:[]});
  const token=randomBytes(32).toString('hex');
  const admin=await db.user.create({data:{username:'date_'+randomBytes(8).toString('hex'),displayName:'日期验收',passwordHash:'fixture',role:'ADMIN',
    sessions:{create:{tokenHash:digest(token),expiresAt:new Date(Date.now()+60000)}}}});
  const headers={cookie:sessionName+'='+token};
  const first=new Date('2040-03-19T16:00:00Z'), last=new Date('2040-03-20T15:59:59.999Z'), outside=new Date('2040-03-20T16:00:00Z');
  const day='from=2040-03-20&to=2040-03-20';
  async function list(path:string,query=day) {
    const result=await app.inject({url:path+'?'+query,headers});
    expect(result.statusCode).toBe(200);
    return result.json().items.map((row:{id:string})=>row.id);
  }
  try{
    const articles=await Promise.all([first,last,outside].map((createdAt,index)=>db.article.create({data:{authorId:admin.id,title:'日期文章'+index,bodyMarkdown:'测试',createdAt}})));
    const pulses=await Promise.all([first,last,outside].map((createdAt,index)=>db.pulse.create({data:{authorId:admin.id,body:'日期沸点'+index,createdAt}})));
    const activities=await Promise.all([first,last,outside].map((createdAt,index)=>db.activity.create({data:{editorId:admin.id,title:'日期活动'+index,summary:'测试',createdAt}})));
    const comments=await Promise.all([first,last,outside].map(createdAt=>db.comment.create({data:{articleId:articles[0].id,authorId:admin.id,body:'日期文章评论',createdAt}})));
    const pulseComments=await Promise.all([first,last,outside].map(createdAt=>db.pulseComment.create({data:{pulseId:pulses[0].id,authorId:admin.id,body:'日期沸点评论',createdAt}})));
    for(const [path,rows,query] of [
      ['/api/admin/articles',articles,day+'&status=DRAFT'],
      ['/api/admin/pulses',pulses,day+'&status=PENDING'],
      ['/api/admin/activities',activities,day],
      ['/api/admin/comments',comments,day+'&articleId='+articles[0].id],
      ['/api/admin/pulse-comments',pulseComments,day+'&pulseId='+pulses[0].id],
    ] as const){
      const ids=await list(path,query);
      expect(ids).toContain(rows[0].id);
      expect(ids).toContain(rows[1].id);
      expect(ids).not.toContain(rows[2].id);
      expect((await app.inject({url:path+'?from=2040-02-30',headers})).statusCode).toBe(400);
      expect((await app.inject({url:path+'?from=2040-03-21&to=2040-03-20',headers})).statusCode).toBe(400);
    }
    expect(await list('/api/admin/comments',day+'&articleId='+articles[1].id)).toEqual([]);
    expect(await list('/api/admin/pulse-comments',day+'&pulseId='+pulses[1].id)).toEqual([]);
    expect((await app.inject('/api/admin/articles?'+day)).statusCode).toBe(401);
  }finally{
    await db.comment.deleteMany({where:{authorId:admin.id}});
    await db.article.deleteMany({where:{authorId:admin.id}});
    await db.pulse.deleteMany({where:{authorId:admin.id}});
    await db.activity.deleteMany({where:{editorId:admin.id}});
    await db.user.delete({where:{id:admin.id}});
    await app.close();await db.$disconnect();
  }
});
