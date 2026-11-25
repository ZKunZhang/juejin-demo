import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { PrismaClient } from '../../generated/prisma/client';
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
  publishedAt:true,updatedAt:true,
} as const;
export const draftSelect = { ...articleSelect, bodyMarkdown:true, status:true, reviewStatus:true, version:true } as const;
export const conflict = () => new ApiError(409,'STATE_CONFLICT','状态已变化，请刷新后重试');
export const missing = () => new ApiError(404,'NOT_FOUND','内容不存在');
const decodeCursor = (value: string, tag: string, word: string) => {
  try {
    const [date, id, cursorTag, cursorWord] = JSON.parse(Buffer.from(value,'base64url').toString());
    if (typeof date !== 'string' || !Number.isFinite(Date.parse(date)) || typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) || cursorTag !== tag || cursorWord !== word) throw new Error();
    return { date: new Date(date), id };
  } catch { throw new ApiError(400,'INVALID_CURSOR','分页参数无效'); }
};

export function registerArticles(app: FastifyInstance, db: PrismaClient, auth: ReturnType<typeof security>, protectedWrite: preHandlerHookHandler[], directPublish: boolean) {
  const write = [...protectedWrite,auth.requireUser];
  const tagCheck = async (tagIds: string[]) => {
    if (await db.tag.count({where:{id:{in:tagIds}}}) !== tagIds.length) throw new ApiError(400,'UNKNOWN_TAG','存在无效标签');
  };
  const owned = async (id:string, userId:string) => {
    const row = await db.article.findUnique({where:{id}, select:{authorId:true,title:true,bodyMarkdown:true}});
    if (!row) throw missing();
    if (row.authorId !== userId) throw new ApiError(403,'FORBIDDEN','无权修改此文章');
    return row;
  };
  app.get('/api/tags', async () => db.tag.findMany({select:{id:true,name:true,slug:true},orderBy:{createdAt:'asc'}}));
  app.get<{ Querystring:{tagId?:string; cursor?:string; limit?:string; q?:string} }>('/api/articles', {
    schema:{querystring:object({tagId:uuid,cursor:{type:'string',maxLength:1000},limit:{type:'string',pattern:'^(?:[1-9]|[1-4][0-9]|50)$'},q:{type:'string',maxLength:100}},[])},
  }, async request => {
    const {tagId,cursor,limit='20',q=''} = request.query;
    const word = q.trim();
    const after = cursor ? decodeCursor(cursor,tagId||'',word) : null;
    const items = await db.article.findMany({
      where:{ status:'PUBLISHED',
        ...(tagId ? {tags:{some:{tagId}}} : {}),
        ...(word ? {AND:[{OR:[{title:{contains:word,mode:'insensitive'}},{bodyMarkdown:{contains:word,mode:'insensitive'}}]}]} : {}),
        ...(after ? {OR:[{publishedAt:{lt:after.date}},{publishedAt:after.date,id:{lt:after.id}}]} : {}),
      }, select:articleSelect, orderBy:[{publishedAt:'desc'},{id:'desc'}], take:Number(limit)+1,
    });
    const extra = items.length > Number(limit);
    if (extra) items.pop();
    const last = items.at(-1);
    return {items,nextCursor:extra&&last ? Buffer.from(JSON.stringify([last.publishedAt,last.id,tagId||'',word])).toString('base64url') : null};
  });
  app.get<{Params:Identified}>('/api/articles/:id',{schema:{params:idSchema}},async request=>{
    const row = await db.article.findFirst({where:{id:request.params.id,status:'PUBLISHED'},select:{...articleSelect,bodyMarkdown:true}});
    if (!row) throw missing();
    const related = await db.article.findMany({where:{status:'PUBLISHED',id:{not:row.id},tags:{some:{tagId:{in:row.tags.map(entry=>entry.tag.id)}}}},select:{id:true,title:true},orderBy:{publishedAt:'desc'},take:4});
    return {...row,related};
  });
  app.get('/api/me/articles',{preHandler:auth.requireUser},async request=>db.article.findMany({
    where:{authorId:request.actor!.id},select:{...articleSelect,status:true,reviewStatus:true,version:true},orderBy:{updatedAt:'desc'},take:100,
  }));
  app.get<{Params:Identified}>('/api/me/articles/:id',{preHandler:auth.requireUser,schema:{params:idSchema}},async request=>{
    const row=await db.article.findFirst({where:{id:request.params.id,authorId:request.actor!.id},select:draftSelect});
    if (!row) throw missing();
    return row;
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
  if (directPublish) app.post<{Params:Identified;Body:{version:number}}>('/api/dev/articles/:id/publish',{
    preHandler:write,schema:{params:idSchema,body:object({version:versionSchema})},
  },async request=>{
    const {id}=request.params;
    const {version}=request.body;
    const authorId=request.actor!.id;
    const row=await owned(id,authorId);
    if (!row.title.trim() || !row.bodyMarkdown.trim()) throw new ApiError(400,'INCOMPLETE_ARTICLE','请填写标题和正文');
    const updated=await db.article.updateMany({where:{id,authorId,version,status:'DRAFT',reviewStatus:'NOT_SUBMITTED'},
      data:{status:'PUBLISHED',reviewStatus:'APPROVED',publishedAt:new Date(),version:{increment:1}}});
    if (!updated.count) throw conflict();
    return db.article.findUniqueOrThrow({where:{id},select:draftSelect});
  });
}
