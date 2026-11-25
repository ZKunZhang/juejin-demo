import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { assureViewer } from './article-views';
import { ApiError, security } from './security';

export const uuid = { type: 'string', format: 'uuid' };
export const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
export const versionSchema = { type: 'integer', minimum: 1 };
const idSchema = object({ id: uuid });
const articleFields = {
  title: { type:'string', maxLength:160 }, bodyMarkdown: { type:'string', maxLength:60000 },
  summary: { type:'string', maxLength:500 }, tagIds: { type:'array', maxItems:10, uniqueItems:true, items:uuid },
};
type EditorInput = { title: string; bodyMarkdown: string; summary?: string; tagIds: string[] };
type Identified = { id: string };
export const authorSelect = { id:true,displayName:true,username:true } as const;
export const articleSelect = {
  id:true,title:true,summary:true,author:{select:authorSelect},
  tags:{select:{tag:{select:{id:true,name:true,slug:true}}}},
  publishedAt:true,updatedAt:true,viewCount:true,
  _count:{select:{likes:true,comments:{where:{status:"VISIBLE",OR:[{parentId:null},{parent:{status:"VISIBLE"}}]}}}},
} satisfies Prisma.ArticleSelect;
export const draftSelect = { ...articleSelect, bodyMarkdown:true, status:true, reviewStatus:true, version:true } as const;
export const conflict = () => new ApiError(409,'STATE_CONFLICT','状态已变化，请刷新后重试');
export const missing = () => new ApiError(404,'NOT_FOUND','内容不存在');
type FeedTab='recommended'|'latest'|'following';
const decodeCursor = (value: string, tag: string, word: string, tab:FeedTab) => {
  try {
    const [date, id, cursorTag, cursorWord, cursorTab='latest', rank] = JSON.parse(Buffer.from(value,'base64url').toString());
    if (typeof date !== 'string' || !Number.isFinite(Date.parse(date)) || typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) || cursorTag !== tag || cursorWord !== word || cursorTab !== tab || (tab==='recommended' && (!Number.isSafeInteger(rank)||rank<0||rank>2147483647))) throw new Error();
    return { date: new Date(date), id, rank: rank as number };
  } catch { throw new ApiError(400,'INVALID_CURSOR','分页参数无效'); }
};

export function registerArticles(app: FastifyInstance, db: PrismaClient, auth: ReturnType<typeof security>, protectedWrite: preHandlerHookHandler[], secure: boolean) {
  const write = [...protectedWrite,auth.requireUser];
  const tagCheck = async (tagIds: string[]) => {
    if (await db.tag.count({where:{id:{in:tagIds},scope:{not:'PULSE'}}}) !== tagIds.length) throw new ApiError(400,'UNKNOWN_TAG','存在无效标签');
  };
  const owned = async (id:string, userId:string) => {
    const row = await db.article.findUnique({where:{id}, select:{authorId:true,title:true,bodyMarkdown:true}});
    if (!row) throw missing();
    if (row.authorId !== userId) throw new ApiError(403,'FORBIDDEN','无权修改此文章');
    return row;
  };
  app.get('/api/tags', async () => db.tag.findMany({where:{scope:{not:'PULSE'}},select:{id:true,name:true,slug:true},orderBy:{createdAt:'asc'}}));
  app.get<{ Querystring:{tagId?:string; cursor?:string; limit?:string; q?:string; tab?:FeedTab} }>('/api/articles', {
    schema:{querystring:object({tagId:uuid,cursor:{type:'string',maxLength:1000},limit:{type:'string',pattern:'^(?:[1-9]|[1-4][0-9]|50)$'},q:{type:'string',maxLength:100},tab:{enum:['recommended','latest','following']}},[])},
  }, async (request,reply) => {
    const {tagId,cursor,limit='20',q='',tab='latest'} = request.query;
    const word = q.trim();
    const actor=tab==='following'?await auth.findActor(request):null;
    if(tab==='following'&&!actor)throw new ApiError(401,'UNAUTHENTICATED','请登录查看关注文章');
    if(actor)reply.header('Cache-Control','private, no-store');
    const after = cursor ? decodeCursor(cursor,tagId||'',word,tab) : null;
    const orderedByDate:Prisma.ArticleWhereInput[] = after?[{publishedAt:{lt:after.date}},{publishedAt:after.date,id:{lt:after.id}}]:[];
    const cursorFilter:Prisma.ArticleWhereInput = !after?{}:tab==='recommended'?{
      OR:[{viewCount:{lt:after.rank}},{viewCount:after.rank,OR:orderedByDate}],
    }:{OR:orderedByDate};
    const items = await db.article.findMany({
      where:{ status:'PUBLISHED',
        ...(tagId ? {tags:{some:{tagId}}} : {}),
        ...(word ? {AND:[{OR:[{title:{contains:word,mode:'insensitive'}},{bodyMarkdown:{contains:word,mode:'insensitive'}}]}]} : {}),
        ...cursorFilter,
        ...(actor?{author:{followers:{some:{followerId:actor.id}}}}:{}),
      }, select:articleSelect, orderBy:[...(tab==='recommended'?[{viewCount:'desc' as const}]:[]),{publishedAt:'desc'},{id:'desc'}], take:Number(limit)+1,
    });
    const extra = items.length > Number(limit);
    if (extra) items.pop();
    const last = items.at(-1);
    return {items,nextCursor:extra&&last ? Buffer.from(JSON.stringify([last.publishedAt,last.id,tagId||'',word,tab,last.viewCount])).toString('base64url') : null};
  });
  app.get<{Params:Identified}>('/api/articles/:id',{schema:{params:idSchema}},async (request,reply)=>{
    const row = await db.article.findFirst({where:{id:request.params.id,status:'PUBLISHED'},select:{...articleSelect,bodyMarkdown:true}});
    if (!row) throw missing();
    assureViewer(request,reply,secure);
    reply.header('Cache-Control','private, no-store');
    const related = await db.article.findMany({where:{status:'PUBLISHED',id:{not:row.id},tags:{some:{tagId:{in:row.tags.map(entry=>entry.tag.id)}}}},select:{id:true,title:true},orderBy:{publishedAt:'desc'},take:4});
    return {...row,related};
  });
  app.get<{Querystring:{status?:'draft'; page?:string}}>('/api/me/articles',{
    preHandler:auth.requireUser,
    schema:{querystring:object({status:{enum:['draft']},page:{type:'string',pattern:'^[1-9][0-9]{0,3}$'}},[])},
  },async request=>db.article.findMany({
    where:{authorId:request.actor!.id,...(request.query.status==='draft'?{status:'DRAFT',reviewStatus:{in:['NOT_SUBMITTED','REJECTED']}}:{})},
    select:{...articleSelect,status:true,reviewStatus:true,version:true},orderBy:[{updatedAt:'desc'},{id:'desc'}],
    skip:(Number(request.query.page||1)-1)*100,take:100,
  }));
  app.get<{Params:Identified}>('/api/me/articles/:id',{preHandler:auth.requireUser,schema:{params:idSchema}},async request=>{
    const row=await db.article.findFirst({where:{id:request.params.id,authorId:request.actor!.id},select:draftSelect});
    if (!row) throw missing();
    const review = await db.articleReview.findFirst({where:{articleId:row.id,action:{in:['REJECT','UNLIST']}},orderBy:{articleVersion:'desc'},select:{reason:true}});
    return {...row,reason:review?.reason ?? null};
  });
  app.post<{Body:EditorInput}>('/api/articles',{preHandler:write,schema:{body:object(articleFields,['title','bodyMarkdown','tagIds'])}},async(request,reply)=>{
    const {title,bodyMarkdown,summary,tagIds}=request.body;
    await tagCheck(tagIds);
    const row=await db.article.create({data:{authorId:request.actor!.id,title:title.trim(),bodyMarkdown,summary:summary?.trim(),
      tags:{create:tagIds.map(tagId=>({tagId}))}},select:draftSelect});
    return reply.code(201).send(row);
  });
  app.patch<{Params:Identified;Body:Partial<EditorInput>&{version:number}}>('/api/articles/:id',{
    preHandler:write,schema:{params:idSchema,body:object({...articleFields,version:versionSchema},['version'])},
  },async request=>{
    const {id}=request.params;
    const {version,tagIds,title,summary,bodyMarkdown}=request.body;
    const authorId=request.actor!.id;
    await owned(id,authorId);
    if (tagIds) await tagCheck(tagIds);
    return db.$transaction(async tx=>{
      const updated=await tx.article.updateMany({where:{id,authorId,version,status:'DRAFT',reviewStatus:{in:['NOT_SUBMITTED','REJECTED']}},
        data:{title:title?.trim(),summary:summary?.trim(),bodyMarkdown,version:{increment:1}}});
      if (!updated.count) throw conflict();
      if (tagIds) {
        await tx.articleTag.deleteMany({where:{articleId:id}});
        await tx.articleTag.createMany({data:tagIds.map(tagId=>({articleId:id,tagId}))});
      }
      return tx.article.findUniqueOrThrow({where:{id},select:draftSelect});
    });
  });
}
