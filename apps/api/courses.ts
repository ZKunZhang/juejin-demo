import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../generated/prisma/client';
import { authorSelect,missing,object,uuid } from './articles';

const card={id:true,title:true,summary:true,level:true,publishedAt:true,
  category:{select:{id:true,name:true,slug:true}},author:{select:authorSelect},
  _count:{select:{lessons:{where:{status:'PUBLISHED'}}}}} as const;
type Level='BEGINNER'|'ADVANCED';
type Params={id:string};
export function registerCourses(app:FastifyInstance,db:PrismaClient) {
  app.get('/api/courses/categories',async()=>db.courseCategory.findMany({
    where:{courses:{some:{status:'PUBLISHED'}}},select:{id:true,slug:true,name:true},orderBy:[{sortOrder:'asc'},{id:'asc'}],
  }));
  app.get<{Querystring:{categoryId?:string;level?:Level}}>('/api/courses',{
    schema:{querystring:object({categoryId:uuid,level:{enum:['BEGINNER','ADVANCED']}},[])},
  },async request=>db.course.findMany({where:{status:'PUBLISHED',categoryId:request.query.categoryId,level:request.query.level},
    select:card,orderBy:[{publishedAt:'desc'},{id:'desc'}],take:100}));
  app.get<{Params:Params}>('/api/courses/:id',{schema:{params:object({id:uuid})}},async request=>{
    const course=await db.course.findFirst({where:{id:request.params.id,status:'PUBLISHED'},select:{...card,description:true,
      lessons:{where:{status:'PUBLISHED'},select:{id:true,title:true,position:true},orderBy:{position:'asc'}}}});
    if(!course)throw missing();
    const index=[{publishedAt:'desc'},{id:'desc'}] as const;
    const orderBy=[...index];
    const same=await db.course.findMany({where:{id:{not:course.id},categoryId:course.category.id,status:'PUBLISHED'},select:card,orderBy,take:3});
    const others=same.length<3?await db.course.findMany({where:{categoryId:{not:course.category.id},status:'PUBLISHED'},select:card,orderBy,take:3-same.length}):[];
    return {...course,related:[...same,...others]};
  });
  app.get<{Params:Params&{lessonId:string}}>('/api/courses/:id/lessons/:lessonId',{
    schema:{params:object({id:uuid,lessonId:uuid})},
  },async request=>{
    const {id,lessonId}=request.params;
    const lesson=await db.courseLesson.findFirst({where:{id:lessonId,courseId:id,status:'PUBLISHED',course:{status:'PUBLISHED'}},
      select:{id:true,title:true,body:true,position:true,course:{select:{id:true,title:true}}}});
    if(!lesson)throw missing();
    return lesson;
  });
}
