import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { PrismaClient } from '../../../../generated/prisma/client';
import { security } from '../../shared/security';
import { missing, object, uuid } from '../../shared/http';
import { authorSelect } from '../articles/articles';

const card={id:true,title:true,summary:true,level:true,publishedAt:true,
  category:{select:{id:true,name:true,slug:true}},author:{select:authorSelect},
  _count:{select:{lessons:{where:{status:'PUBLISHED'}}}}} as const;
type Level='BEGINNER'|'ADVANCED';
type Params={id:string};
export function registerCourses(app:FastifyInstance,db:PrismaClient,auth:ReturnType<typeof security>,protectedWrite:preHandlerHookHandler[]) {
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
  const lessonParams=object({id:uuid,lessonId:uuid});
  const commentSelect={id:true,body:true,createdAt:true,author:{select:authorSelect}} as const;
  app.get<{Params:Params&{lessonId:string}}>('/api/courses/:id/lessons/:lessonId/comments',{
    schema:{params:lessonParams},
  },async request=>{
    const {id,lessonId}=request.params;
    const lesson=await db.courseLesson.findFirst({
      where:{id:lessonId,courseId:id,status:'PUBLISHED',course:{status:'PUBLISHED'}},
      select:{comments:{select:commentSelect,orderBy:[{createdAt:'desc'},{id:'desc'}],take:100}},
    });
    if(!lesson)throw missing();
    return lesson.comments.reverse();
  });
  app.post<{Params:Params&{lessonId:string};Body:{body:string}}>('/api/courses/:id/lessons/:lessonId/comments',{
    preHandler:[...protectedWrite,auth.requireUser],
    schema:{params:lessonParams,body:object({body:{type:'string',minLength:1,maxLength:2000,pattern:'\\S'}})},
  },async(request,reply)=>{
    const {id,lessonId}=request.params;
    const comment=await db.$transaction(async tx=>{
      const courses=await tx.$queryRaw<{id:string}[]>`
        SELECT id FROM courses WHERE id = ${id}::uuid AND status = 'PUBLISHED' FOR SHARE`;
      if(!courses.length)throw missing();
      const lessons=await tx.$queryRaw<{id:string}[]>`
        SELECT id FROM course_lessons
        WHERE id = ${lessonId}::uuid AND course_id = ${id}::uuid AND status = 'PUBLISHED' FOR SHARE`;
      if(!lessons.length)throw missing();
      return tx.courseLessonComment.create({
        data:{lessonId,authorId:request.actor!.id,body:request.body.body.trim()},select:commentSelect,
      });
    });
    return reply.code(201).send(comment);
  });

}
