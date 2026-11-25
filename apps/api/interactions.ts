import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { PrismaClient } from '../../generated/prisma/client';
import { ApiError, security } from './security';
import { articleSelect, authorSelect, missing, object, uuid } from './articles';

type Params={id:string};
type Toggle={active:boolean};
const params=object({id:uuid});
const toggle=object({active:{type:'boolean'}});
type Tx=Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

async function lockPublished(tx:Tx,id:string) {
  const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM articles WHERE id = ${id}::uuid AND status = 'PUBLISHED' FOR SHARE`;
  if(!rows.length)throw missing();
}
export function registerInteractions(app:FastifyInstance,db:PrismaClient,auth:ReturnType<typeof security>,protectedWrite:preHandlerHookHandler[]) {
  const write=[...protectedWrite,auth.requireUser];
  app.get<{Params:Params}>('/api/articles/:id/comments',{schema:{params}},async request=>{
    const article=await db.article.findFirst({where:{id:request.params.id,status:'PUBLISHED'},select:{comments:{
      where:{status:'VISIBLE'},orderBy:[{createdAt:'asc'},{id:'asc'}],take:100,
      select:{id:true,body:true,createdAt:true,author:{select:authorSelect}},
    }}});
    if(!article)throw missing();
    return article.comments;
  });
  app.post<{Params:Params;Body:{body:string}}>('/api/articles/:id/comments',{
    preHandler:write,schema:{params,body:object({body:{type:'string',minLength:1,maxLength:2000,pattern:'\\S'}})},
  },async(request,reply)=>{
    const articleId=request.params.id,authorId=request.actor!.id;
    const row=await db.$transaction(async tx=>{
      await lockPublished(tx,articleId);
      return tx.comment.create({data:{articleId,authorId,body:request.body.body.trim()},select:{id:true,body:true,createdAt:true,author:{select:authorSelect}}});
    });
    return reply.code(201).send(row);
  });
  app.get<{Params:Params}>('/api/articles/:id/interaction',{schema:{params},preHandler:auth.requireUser},async request=>{
    const userId=request.actor!.id;
    const row=await db.article.findFirst({where:{id:request.params.id,status:'PUBLISHED'},select:{
      likes:{where:{userId},select:{userId:true},take:1},
      bookmarks:{where:{userId},select:{userId:true},take:1},
      author:{select:{followers:{where:{followerId:userId},select:{followerId:true},take:1}}},
    }});
    if(!row)throw missing();
    return {liked:!!row.likes.length,bookmarked:!!row.bookmarks.length,following:!!row.author.followers.length};
  });

  for(const path of ['like','bookmark'] as const) {
    app.put<{Params:Params;Body:Toggle}>('/api/articles/:id/'+path,{preHandler:write,schema:{params,body:toggle}},async request=>{
      const articleId=request.params.id,userId=request.actor!.id,{active}=request.body;
      await db.$transaction(async tx=>{
        if(active)await lockPublished(tx,articleId);
        if(path==='like') {
          if(active)await tx.articleLike.createMany({data:{userId,articleId},skipDuplicates:true});
          else await tx.articleLike.deleteMany({where:{userId,articleId}});
        }else{
          if(active)await tx.articleBookmark.createMany({data:{userId,articleId},skipDuplicates:true});
          else await tx.articleBookmark.deleteMany({where:{userId,articleId}});
        }
      });
      return {active};
    });
  }
  app.put<{Params:Params;Body:Toggle}>('/api/users/:id/follow',{preHandler:write,schema:{params,body:toggle}},async request=>{
    const followerId=request.actor!.id,followeeId=request.params.id,{active}=request.body;
    if(followerId===followeeId)throw new ApiError(400,'SELF_FOLLOW','不能关注自己');
    await db.$transaction(async tx=>{
      if(active) {
        const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM users WHERE id = ${followeeId}::uuid AND status = 'ACTIVE' FOR SHARE`;
        if(!rows.length)throw missing();
        await tx.userFollow.createMany({data:{followerId,followeeId},skipDuplicates:true});
      }else await tx.userFollow.deleteMany({where:{followerId,followeeId}});
    });
    return {active};
  });
  app.get('/api/me/bookmarks',{preHandler:auth.requireUser},async request=>db.article.findMany({
    where:{status:'PUBLISHED',bookmarks:{some:{userId:request.actor!.id}}},select:articleSelect,
    orderBy:[{publishedAt:'desc'},{id:'desc'}],take:100,
  }));
  app.get('/api/me/following',{preHandler:auth.requireUser},async request=>{
    const relations=await db.userFollow.findMany({where:{followerId:request.actor!.id,followee:{status:'ACTIVE'}},select:{followee:{select:authorSelect}},orderBy:{createdAt:'desc'},take:100});
    return relations.map(row=>row.followee);
  });
}
