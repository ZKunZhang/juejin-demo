import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { expect,test } from 'vitest';
import { buildApp } from '../apps/api/app';
import { connectDatabase } from '../apps/api/db';

const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('A dedicated TEST_DATABASE_URL ending in _test is required');
test('courses combine filters, hide drafts and recommend the same category before fallback',async()=>{
  const db=connectDatabase(url);
  const app=await buildApp(db,{origins:[]});
  const key=randomBytes(6).toString('hex');
  const user=await db.user.create({data:{username:'course_'+key,displayName:'小册作者',passwordHash:'fixture'}});
  const categories:string[]=[];
  const createCategory=async(suffix:string)=>{
    const row=await db.courseCategory.create({data:{name:suffix,slug:key+suffix}});
    categories.push(row.id);return row.id;
  };
  try{
    const main=await createCategory('main'),other=await createCategory('other'),draftOnly=await createCategory('draft');
    const common={authorId:user.id,title:'演示课程',summary:'课程说明',description:'## 课程介绍',publishedAt:new Date()};
    const book=await db.course.create({data:{...common,categoryId:main,level:'BEGINNER',status:'PUBLISHED',lessons:{create:[
      {position:3,title:'第三章',body:'第三章正文',status:'PUBLISHED'},
      {position:1,title:'第一章',body:'第一章正文',status:'PUBLISHED'},
      {position:2,title:'草稿章',body:'未发布章节',status:'DRAFT'},
    ]}},include:{lessons:true}});
    const same=await db.course.create({data:{...common,categoryId:main,level:'ADVANCED',status:'PUBLISHED'}});
    await db.course.create({data:{...common,categoryId:other,level:'BEGINNER',status:'PUBLISHED'}});
    const draft=await db.course.create({data:{...common,categoryId:draftOnly,level:'BEGINNER',status:'DRAFT'}});
    const path='/api/courses/'+book.id;
    const rows=(await app.inject('/api/courses?categoryId='+main+'&level=BEGINNER')).json();
    expect(rows.map((row:{id:string})=>row.id)).toEqual([book.id]);
    const detail=(await app.inject(path)).json();
    expect(detail.lessons.map((item:{position:number})=>item.position)).toEqual([1,3]);
    expect(detail._count.lessons).toBe(2);
    expect(detail.related[0].id).toBe(same.id);
    expect(detail.related.map((item:{id:string})=>item.id)).not.toContain(book.id);
    expect((await app.inject('/api/courses/'+draft.id)).statusCode).toBe(404);
    expect((await app.inject(path+'/lessons/'+book.lessons.find(row=>row.position===2)!.id)).statusCode).toBe(404);
    expect((await app.inject(path+'/lessons/'+book.lessons.find(row=>row.position===1)!.id)).json().body).toBe('第一章正文');
    expect((await app.inject('/api/courses?level=UNKNOWN')).statusCode).toBe(400);
    const listed=(await app.inject('/api/courses/categories')).json();
    expect(listed.some((row:{id:string})=>row.id===draftOnly)).toBe(false);
  }finally{
    await db.course.deleteMany({where:{authorId:user.id}});
    await db.courseCategory.deleteMany({where:{id:{in:categories}}});
    await db.user.delete({where:{id:user.id}});
    await app.close();await db.$disconnect();
  }
});
