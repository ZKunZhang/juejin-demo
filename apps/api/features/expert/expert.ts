import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { PrismaClient } from '../../../../generated/prisma/client';
import { security } from '../../shared/security';
import { conflict, missing, object, uuid } from '../../shared/http';

const taskFields = { id:true, title:true, summary:true, instructions:true, status:true, isDemo:true, createdAt:true } as const;
const annotationFields = { taskId:true, status:true, response:true, claimedAt:true, submittedAt:true } as const;
const params = object({id:uuid});

export function registerExpert(app:FastifyInstance, db:PrismaClient, auth:ReturnType<typeof security>, protectedWrite:preHandlerHookHandler[]) {
  const write = [...protectedWrite, auth.requireUser];
  app.get('/api/expert/tasks', async () => ({items:await db.expertTask.findMany({
    where:{status:'OPEN'}, select:taskFields, orderBy:[{createdAt:'desc'},{id:'desc'}],
  })}));
  app.get<{Params:{id:string}}>('/api/expert/tasks/:id', {schema:{params}}, async request => {
    const task=await db.expertTask.findFirst({where:{id:request.params.id,status:'OPEN'},select:taskFields});
    if (!task) throw missing();
    return task;
  });
  app.get('/api/me/expert/annotations', {preHandler:auth.requireUser}, async (request, reply) => {
    reply.header('Cache-Control','private, no-store');
    return {items:await db.expertAnnotation.findMany({where:{userId:request.actor!.id},
      select:{...annotationFields, task:{select:taskFields}}, orderBy:[{claimedAt:'desc'},{taskId:'desc'}]})};
  });
  app.post<{Params:{id:string}}>('/api/expert/tasks/:id/claim', {preHandler:write,schema:{params}}, async request => db.$transaction(async tx => {
    const taskId=request.params.id;
    const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM expert_tasks WHERE id=${taskId}::uuid AND status='OPEN' FOR UPDATE`;
    if (!rows.length) throw missing();
    const userId=request.actor!.id;
    await tx.expertAnnotation.createMany({data:{taskId,userId},skipDuplicates:true});
    return tx.expertAnnotation.findUniqueOrThrow({where:{taskId_userId:{taskId,userId}},select:annotationFields});
  }));
  app.post<{Params:{id:string};Body:{response:string}}>('/api/expert/tasks/:id/submit', {
    preHandler:write,
    schema:{params,body:object({response:{type:'string',minLength:1,maxLength:10000,pattern:'\\S'}})},
  }, async request => db.$transaction(async tx => {
    const taskId=request.params.id;
    const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM expert_tasks WHERE id=${taskId}::uuid AND status='OPEN' FOR UPDATE`;
    if (!rows.length) throw missing();
    const userId=request.actor!.id;
    const existing=await tx.expertAnnotation.findUnique({where:{taskId_userId:{taskId,userId}},select:{status:true}});
    if (!existing) throw missing();
    const updated=await tx.expertAnnotation.updateMany({where:{taskId,userId,status:'CLAIMED'},
      data:{status:'SUBMITTED',response:request.body.response.trim(),submittedAt:new Date()}});
    if (!updated.count) throw conflict();
    return tx.expertAnnotation.findUniqueOrThrow({where:{taskId_userId:{taskId,userId}},select:annotationFields});
  }));
}
