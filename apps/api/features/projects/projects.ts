import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { Prisma, PrismaClient, ProjectStatus } from '../../../../generated/prisma/client';
import { adminCreatedAt, adminDateSchema, type AdminDateQuery } from '../../shared/admin-date-range';
import { conflict, missing, object, uuid, versionSchema } from '../../shared/http';
import { ApiError, security } from '../../shared/security';
import { assureViewer, viewerKey } from '../articles/article-views';

const statuses = ['DRAFT', 'PENDING', 'PUBLISHED', 'REJECTED', 'UNLISTED'] as const;
const pageSchema = { type:'string', pattern:'^[1-9][0-9]{0,3}$' };
const idSchema = object({id:uuid});
const text = (maxLength:number) => ({type:'string', minLength:1, maxLength, pattern:'\\S'});
const nullableUrl = {anyOf:[text(2000), {type:'null'}]};
const taxonomyIds = {type:'array', items:uuid, maxItems:10, uniqueItems:true};
const form = {
  title:text(120), summary:text(400), bodyMarkdown:{type:'string',maxLength:30000},
  projectUrl:text(2000), coverUrl:nullableUrl, repositoryUrl:nullableUrl,
  categoryIds:taxonomyIds, platformIds:taxonomyIds,
};
type Form = {
  title:string; summary:string; bodyMarkdown:string; projectUrl:string; coverUrl:string|null; repositoryUrl:string|null;
  categoryIds:string[]; platformIds:string[];
};
type Identified = {id:string};
const catalog = {id:true,slug:true,name:true} as const;
const detail = {
  id:true,title:true,summary:true,bodyMarkdown:true,projectUrl:true,coverUrl:true,repositoryUrl:true,
  author:{select:{id:true,displayName:true}}, status:true, version:true, submittedAt:true, publishedAt:true,
  categoryLinks:{select:{category:{select:catalog}}}, platformLinks:{select:{platform:{select:catalog}}},
  _count:{select:{likes:true,viewWindows:true}},
} satisfies Prisma.ProjectSelect;
type Row = Prisma.ProjectGetPayload<{select:typeof detail}>;
const pageSize = 16;
function item({categoryLinks,platformLinks,_count,...project}:Row) {
  return {
    ...project,categories:categoryLinks.map(link=>link.category),platforms:platformLinks.map(link=>link.platform),
    viewCount:_count.viewWindows,likeCount:_count.likes,
  };
}

function safeUrl(raw:string, httpsOnly:boolean) {
  try {
    const url = new URL(raw.trim());
    if (!(httpsOnly ? url.protocol === 'https:' : ['http:','https:'].includes(url.protocol)) || url.username || url.password) throw new Error();
    return url.href;
  } catch {
    throw new ApiError(400,'INVALID_PROJECT_URL',httpsOnly ? '封面需要有效的 HTTPS 地址' : '请输入有效的 HTTP 或 HTTPS 地址');
  }
}

async function projectData(db:Prisma.TransactionClient, form:Form) {
  const {categoryIds,platformIds,projectUrl,coverUrl,repositoryUrl,...content} = form;
  const [categories,platforms] = await Promise.all([
    db.projectCategory.count({where:{id:{in:categoryIds},active:true}}),
    db.projectPlatform.count({where:{id:{in:platformIds},active:true}}),
  ]);
  if (categories!==categoryIds.length || platforms!==platformIds.length) throw new ApiError(400,'INVALID_PROJECT_TAXONOMY','分类或平台无效');
  return {
    ...content,title:content.title.trim(),summary:content.summary.trim(),
    projectUrl:safeUrl(projectUrl,false),coverUrl:coverUrl ? safeUrl(coverUrl,true) : null,
    repositoryUrl:repositoryUrl ? safeUrl(repositoryUrl,false) : null,
  };
}

async function replaceTaxonomies(db:Prisma.TransactionClient, projectId:string, form:Form) {
  await db.projectCategoryLink.deleteMany({where:{projectId}});
  await db.projectPlatformLink.deleteMany({where:{projectId}});
  if (form.categoryIds.length) await db.projectCategoryLink.createMany({data:form.categoryIds.map(categoryId=>({projectId,categoryId}))});
  if (form.platformIds.length) await db.projectPlatformLink.createMany({data:form.platformIds.map(platformId=>({projectId,platformId}))});
}

async function lockPublished(db:Prisma.TransactionClient, id:string) {
  const rows=await db.$queryRaw<{id:string}[]>`SELECT id FROM projects WHERE id=${id}::uuid AND status='PUBLISHED' FOR UPDATE`;
  if (!rows.length) throw missing();
}

export function registerProjects(app:FastifyInstance, db:PrismaClient, auth:ReturnType<typeof security>, protectedWrite:preHandlerHookHandler[], secure:boolean) {
  const write=[...protectedWrite,auth.requireUser];
  const adminWrite=[...protectedWrite,auth.requireAdmin];
  app.get('/api/project-options',async()=>{
    const options={where:{active:true},select:catalog,orderBy:[{sortOrder:'asc' as const},{slug:'asc' as const}]};
    const [categories,platforms]=await Promise.all([db.projectCategory.findMany(options),db.projectPlatform.findMany(options)]);
    return {categories,platforms};
  });

  app.get<{Querystring:{q?:string;categoryId?:string;platformId?:string;sort?:'likes'|'views'|'latest';page?:string;days?:'7'|'30'|'90'}}>('/api/projects',{
    schema:{querystring:object({q:{type:'string',maxLength:100},categoryId:uuid,platformId:uuid,sort:{enum:['likes','views','latest']},page:pageSchema,days:{enum:['7','30','90']}},[])},
  },async request=>{
    const {q='',categoryId,platformId,sort='latest',page='1',days}=request.query;
    const word=q.trim();
    const orderBy:Prisma.ProjectOrderByWithRelationInput[]=[
      ...(sort==='likes'?[{likes:{_count:'desc' as const}}]:sort==='views'?[{viewWindows:{_count:'desc' as const}}]:[]),
      {publishedAt:'desc'},{id:'desc'},
    ];
    const rows=await db.project.findMany({
      where:{status:'PUBLISHED',
        publishedAt:days?{gte:new Date(Date.now()-Number(days)*86400000)}:undefined,
        categoryLinks:categoryId?{some:{categoryId}}:undefined,
        platformLinks:platformId?{some:{platformId}}:undefined,
        OR:word?[{title:{contains:word,mode:'insensitive'}},{summary:{contains:word,mode:'insensitive'}}]:undefined,
      },select:detail,orderBy,skip:(Number(page)-1)*pageSize,take:pageSize+1,
    });
    return {items:rows.slice(0,pageSize).map(item),hasMore:rows.length>pageSize};
  });

  app.get<{Params:Identified}>('/api/projects/:id',{schema:{params:idSchema}},async(request,reply)=>{
    const row=await db.project.findFirst({where:{id:request.params.id,status:'PUBLISHED'},select:detail});
    if (!row) throw missing();
    assureViewer(request,reply,secure);
    reply.header('Cache-Control','private, no-store');
    const actor=await auth.findActor(request);
    const liked=!!actor && !!await db.projectLike.findUnique({where:{projectId_userId:{projectId:row.id,userId:actor.id}},select:{userId:true}});
    return {...item(row),liked};
  });

  app.post<{Params:Identified}>('/api/projects/:id/views',{preHandler:protectedWrite,schema:{params:idSchema}},async request=>{
    const id=request.params.id;
    const viewer=viewerKey(request);
    if (!viewer) throw new ApiError(400,'MISSING_VIEWER','请先加载作品详情');
    return db.$transaction(async tx=>{
      await lockPublished(tx,id);
      const now=new Date();
      const latest=await tx.projectViewWindow.findFirst({where:{projectId:id,viewerKey:viewer},orderBy:{windowStart:'desc'},select:{windowStart:true}});
      if (!latest || now.getTime()-latest.windowStart.getTime()>=30*60*1000) {
        await tx.projectViewWindow.create({data:{projectId:id,viewerKey:viewer,windowStart:now}});
      }
      return {viewCount:await tx.projectViewWindow.count({where:{projectId:id}})};
    });
  });

  for (const method of ['PUT','DELETE'] as const) {
    app.route<{Params:Identified}>({method,url:'/api/projects/:id/like',preHandler:write,schema:{params:idSchema},handler:async request=>{
      const projectId=request.params.id;
      const userId=request.actor!.id;
      return db.$transaction(async tx=>{
        await lockPublished(tx,projectId);
        const liked=method==='PUT';
        if (liked) await tx.projectLike.createMany({data:{projectId,userId},skipDuplicates:true});
        else await tx.projectLike.deleteMany({where:{projectId,userId}});
        return {liked,likeCount:await tx.projectLike.count({where:{projectId}})};
      });
    }});
  }

  app.get('/api/me/projects',{preHandler:auth.requireUser},async(request,reply)=>{
    reply.header('Cache-Control','private, no-store');
    const projects=await db.project.findMany({where:{authorId:request.actor!.id},select:detail,orderBy:[{updatedAt:'desc'},{id:'desc'}]});
    return {items:projects.map(item)};
  });

  app.post<{Body:Form}>('/api/me/projects',{preHandler:write,schema:{body:object(form)}},async(request,reply)=>{
    const project=await db.$transaction(async tx=>{
      const data=await projectData(tx,request.body);
      const {id}=await tx.project.create({data:{...data,authorId:request.actor!.id},select:{id:true}});
      await replaceTaxonomies(tx,id,request.body);
      return tx.project.findUniqueOrThrow({where:{id},select:detail});
    });
    return reply.code(201).send(item(project));
  });

  app.patch<{Params:Identified;Body:Form&{version:number}}>('/api/me/projects/:id',{
    preHandler:write,schema:{params:idSchema,body:object({...form,version:versionSchema})},
  },async request=>db.$transaction(async tx=>{
    const id=request.params.id;
    const authorId=request.actor!.id;
    const owned=await tx.project.findFirst({where:{id,authorId},select:{id:true}});
    if (!owned) throw missing();
    const {version,...body}=request.body;
    const data=await projectData(tx,body);
    const updated=await tx.project.updateMany({
      where:{id,authorId,version,status:{in:['DRAFT','REJECTED']}},
      data:{...data,version:{increment:1}},
    });
    if (!updated.count) throw conflict();
    await replaceTaxonomies(tx,id,body);
    return item(await tx.project.findUniqueOrThrow({where:{id},select:detail}));
  }));

  async function transition(id:string, actorId:string, version:number, status:ProjectStatus, reason:string|null, ownerOnly:boolean) {
    return db.$transaction(async tx=>{
      const current=await tx.project.findFirst({where:{id,authorId:ownerOnly?actorId:undefined},select:{status:true}});
      if (!current) throw missing();
      const previous=current.status;
      const allowed=ownerOnly ? previous==='DRAFT' || previous==='REJECTED' :
        previous==='PENDING' ? status==='PUBLISHED' || status==='REJECTED' : previous==='PUBLISHED' && status==='UNLISTED';
      if (!allowed) throw conflict();
      const time=new Date();
      const updated=await tx.project.updateMany({
        where:{id,version,status:previous,authorId:ownerOnly?actorId:undefined},
        data:{status,version:{increment:1},submittedAt:status==='PENDING'?time:undefined,publishedAt:status==='PUBLISHED'?time:undefined},
      });
      if (!updated.count) throw conflict();
      await tx.projectReview.create({data:{
        projectId:id,actorId,version:version+1,action:ownerOnly?'SUBMIT':status==='PUBLISHED'?'APPROVE':status==='REJECTED'?'REJECT':'UNLIST',
        previousStatus:previous,nextStatus:status,reason,
      }});
      return item(await tx.project.findUniqueOrThrow({where:{id},select:detail}));
    });
  }

  app.post<{Params:Identified;Body:{version:number}}>('/api/me/projects/:id/submit',{
    preHandler:write,schema:{params:idSchema,body:object({version:versionSchema})},
  },request=>transition(request.params.id,request.actor!.id,request.body.version,'PENDING',null,true));

  app.get<{Querystring:AdminDateQuery&{status?:ProjectStatus;page?:string}}>('/api/admin/projects',{
    preHandler:auth.requireAdmin,schema:{querystring:object({status:{enum:statuses},page:pageSchema,...adminDateSchema},[])},
  },async(request,reply)=>{
    reply.header('Cache-Control','private, no-store');
    const {status,page='1'}=request.query;
    const rows=await db.project.findMany({where:{status,submittedAt:adminCreatedAt(request.query)},select:detail,
      orderBy:[{submittedAt:{sort:'desc',nulls:'last'}},{id:'desc'}],skip:(Number(page)-1)*pageSize,take:pageSize+1});
    return {items:rows.slice(0,pageSize).map(item),hasMore:rows.length>pageSize};
  });

  app.patch<{Params:Identified;Body:{version:number;status:'PUBLISHED'|'REJECTED'|'UNLISTED';reason?:string}}>('/api/admin/projects/:id/status',{
    preHandler:adminWrite,schema:{params:idSchema,body:object({version:versionSchema,status:{enum:['PUBLISHED','REJECTED','UNLISTED']},reason:text(1000)},['version','status'])},
  },request=>{
    const {version,status,reason}=request.body;
    if (status!=='PUBLISHED' && !reason?.trim()) throw new ApiError(400,'REASON_REQUIRED','请输入审核原因');
    return transition(request.params.id,request.actor!.id,version,status,reason?.trim()||null,false);
  });
}
