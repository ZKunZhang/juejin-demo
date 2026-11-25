import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { PrismaClient } from '../../generated/prisma/client';
import { ApiError, security } from './security';
import { conflict, missing, object, uuid, versionSchema } from './articles';

type ActivityInput={
  title:string; summary:string; url:string|null; status:'DRAFT'|'PUBLISHED'|'UNLISTED';
  sortOrder:number; visibleFrom:string|null; visibleTo:string|null;
};
const params=object({id:uuid});
const nullable=(schema:Record<string,unknown>)=>({anyOf:[schema,{type:'null'}]});
const input={
  title:{type:'string',minLength:1,maxLength:120,pattern:'\\S'},
  summary:{type:'string',minLength:1,maxLength:300,pattern:'\\S'},
  url:nullable({type:'string',maxLength:1000}),
  status:{enum:['DRAFT','PUBLISHED','UNLISTED']},
  sortOrder:{type:'integer',minimum:0,maximum:9999},
  visibleFrom:nullable({type:'string',format:'date-time'}),
  visibleTo:nullable({type:'string',format:'date-time'}),
};
const safeFields={id:true,title:true,summary:true,url:true} as const;
const adminFields={...safeFields,status:true,sortOrder:true,visibleFrom:true,visibleTo:true,version:true,updatedAt:true} as const;

function normalize(input:ActivityInput) {
  const from=input.visibleFrom ? new Date(input.visibleFrom) : null;
  const to=input.visibleTo ? new Date(input.visibleTo) : null;
  if (from && to && !(from<to)) throw new ApiError(400,'INVALID_ACTIVITY_WINDOW','展示结束时间必须晚于开始时间');
  let url=null;
  if(input.url?.trim()) {
    try {
      const target=new URL(input.url.trim());
      if (!['http:','https:'].includes(target.protocol)||target.username||target.password)throw new Error();
      url=target.href;
    } catch {throw new ApiError(400,'INVALID_ACTIVITY_URL','请输入有效的 HTTP 或 HTTPS 地址');}
  }
  return {title:input.title.trim(),summary:input.summary.trim(),url,status:input.status,sortOrder:input.sortOrder,visibleFrom:from,visibleTo:to};
}

export function registerActivities(app:FastifyInstance,db:PrismaClient,auth:ReturnType<typeof security>,write:preHandlerHookHandler[]) {
  const admin=[...write,auth.requireAdmin];
  app.get('/api/activities',async()=>{
    const now=new Date();
    return db.activity.findMany({where:{status:'PUBLISHED',AND:[
      {OR:[{visibleFrom:null},{visibleFrom:{lte:now}}]},
      {OR:[{visibleTo:null},{visibleTo:{gt:now}}]},
    ]},select:safeFields,orderBy:[{sortOrder:'asc'},{id:'asc'}],take:5});
  });
  app.get<{Querystring:{page?:string}}>('/api/admin/activities',{
    preHandler:auth.requireAdmin,schema:{querystring:object({page:{type:'string',pattern:'^[1-9][0-9]{0,3}$'}},[])},
  },async request=>{
    const page=Number(request.query.page||1);
    const items=await db.activity.findMany({select:adminFields,orderBy:[{sortOrder:'asc'},{id:'asc'}],skip:(page-1)*30,take:31});
    const hasMore=items.length>30;if(hasMore)items.pop();
    return {items,hasMore};
  });
  app.get<{Params:{id:string}}>('/api/admin/activities/:id',{preHandler:auth.requireAdmin,schema:{params}},async request=>{
    const row=await db.activity.findUnique({where:{id:request.params.id},select:adminFields});
    if(!row)throw missing();
    return row;
  });
  app.post<{Body:ActivityInput}>('/api/admin/activities',{preHandler:admin,schema:{body:object(input)}},async(request,reply)=>{
    const item=await db.activity.create({data:{...normalize(request.body),editorId:request.actor!.id},select:adminFields});
    return reply.code(201).send(item);
  });
  app.patch<{Params:{id:string};Body:ActivityInput&{version:number}}>('/api/admin/activities/:id',{
    preHandler:admin,schema:{params,body:object({...input,version:versionSchema})},
  },request=>db.$transaction(async tx=>{
    const {id}=request.params;
    const result=await tx.activity.updateMany({where:{id,version:request.body.version},data:{
      ...normalize(request.body),editorId:request.actor!.id,version:{increment:1},
    }});
    if(!result.count) {
      if(!(await tx.activity.findUnique({where:{id},select:{id:true}})))throw missing();
      throw conflict();
    }
    return tx.activity.findUniqueOrThrow({where:{id},select:adminFields});
  }));
}
