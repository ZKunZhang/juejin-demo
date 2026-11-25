import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { PrismaClient } from '../../generated/prisma/client';
import { ApiError, security } from './security';
import { articleSelect, authorSelect, missing, object, uuid } from './articles';

type Params={id:string};
const commentMissing=()=>new ApiError(404,'COMMENT_NOT_FOUND','评论不存在或已隐藏');
type Toggle={active:boolean};
const params=object({id:uuid});
const commentSelect={id:true,body:true,createdAt:true,parentId:true,author:{select:authorSelect}} as const;
const newestComments=[{createdAt:'desc'},{id:'desc'}] as const;
const toggle=object({active:{type:'boolean'}});
type Tx=Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

async function lockPublished(tx:Tx,id:string) {
  const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM articles WHERE id = ${id}::uuid AND status = 'PUBLISHED' FOR SHARE`;
  if(!rows.length)throw missing();
}
export function registerInteractions(app:FastifyInstance,db:PrismaClient,auth:ReturnType<typeof security>,protectedWrite:preHandlerHookHandler[]) {
  const write=[...protectedWrite,auth.requireUser];
  app.get<{Params:Params}>('/api/articles/:id/comments',{schema:{params}},async (request,reply)=>{
    const actor=await auth.findActor(request);
    const select={
      ...commentSelect,
      _count:{select:{likes:true}},
      ...(actor && {likes:{where:{userId:actor.id},select:{userId:true}}}),
    } as const;
    const article=await db.article.findFirst({where:{id:request.params.id,status:'PUBLISHED'},select:{comments:{
      where:{status:'VISIBLE',parentId:null},orderBy:[...newestComments],take:100,
      select:{...select,replies:{
        where:{status:'VISIBLE'},orderBy:[...newestComments],take:20,select,
      }},
    }}});
    if(!article)throw missing();
    function withLikes<T extends { _count:{likes:number}; likes?:{userId:string}[] }>(row:T) {
      const { _count, likes, ...comment }=row;
      return {...comment,likeCount:_count.likes,liked:!!likes?.length};
    }
    reply.header('Cache-Control','private, no-store');
    return article.comments.reverse().map(({replies,...comment})=>({
      ...withLikes(comment),replies:replies.reverse().map(withLikes),
    }));
  });
  app.post<{Params:Params;Body:{body:string;parentId?:string}}>('/api/articles/:id/comments',{
    preHandler:write,schema:{params,body:object({body:{type:'string',minLength:1,maxLength:2000,pattern:'\\S'},parentId:uuid},['body'])},
  },async(request,reply)=>{
    const articleId=request.params.id,authorId=request.actor!.id;
    const {body,parentId}=request.body;
    const row=await db.$transaction(async tx=>{
      await lockPublished(tx,articleId);
      if(parentId){
        const parent=await tx.$queryRaw<{id:string}[]>`
          SELECT id FROM comments
          WHERE id = ${parentId}::uuid AND article_id = ${articleId}::uuid
            AND parent_id IS NULL AND status = 'VISIBLE'
          FOR SHARE`;
        if(!parent.length)throw new ApiError(404,'COMMENT_NOT_FOUND','可回复的评论不存在');
      }
      return tx.comment.create({data:{articleId,authorId,parentId,body:body.trim()},select:commentSelect});
    });
    return reply.code(201).send({...row,likeCount:0,liked:false});
  });
  app.put<{Params:Params & {commentId:string};Body:Toggle}>('/api/articles/:id/comments/:commentId/like',{
    preHandler:write,schema:{params:object({id:uuid,commentId:uuid}),body:toggle},
  },async request=>{
    const {id:articleId,commentId}=request.params;
    const userId=request.actor!.id;
    const {active}=request.body;
    return db.$transaction(async tx=>{
      await lockPublished(tx,articleId);
      const comment=await tx.comment.findFirst({where:{id:commentId,articleId},select:{parentId:true}});
      if(!comment)throw commentMissing();
      const rootId=comment.parentId ?? commentId;
      const visible=await tx.$queryRaw<{id:string}[]>`
        SELECT id FROM comments
        WHERE article_id = ${articleId}::uuid AND status = 'VISIBLE'
          AND id IN (${rootId}::uuid, ${commentId}::uuid)
        ORDER BY id FOR SHARE`;
      if(visible.length !== (comment.parentId ? 2 : 1))throw commentMissing();
      if(active)await tx.commentLike.createMany({data:{userId,commentId},skipDuplicates:true});
      else await tx.commentLike.deleteMany({where:{userId,commentId}});
      return {liked:active,likeCount:await tx.commentLike.count({where:{commentId}})};
    });
  });
  app.get<{Params:Params}>('/api/articles/:id/interaction',{schema:{params},preHandler:auth.requireUser},async request=>{
    const userId=request.actor!.id;
    const row=await db.article.findFirst({where:{id:request.params.id,status:'PUBLISHED'},select:{
      likes:{where:{userId},select:{userId:true},take:1},
      bookmarks:{where:{userId},select:{collectionId:true},take:1},
      author:{select:{followers:{where:{followerId:userId},select:{followerId:true},take:1}}},
    }});
    if(!row)throw missing();
    return {liked:!!row.likes.length,bookmarked:!!row.bookmarks.length,collectionId:row.bookmarks[0]?.collectionId??null,following:!!row.author.followers.length};
  });

  app.put<{Params:Params;Body:Toggle}>('/api/articles/:id/like',{preHandler:write,schema:{params,body:toggle}},async request=>{
    const articleId=request.params.id,userId=request.actor!.id,{active}=request.body;
    await db.$transaction(async tx=>{
      if(active){
        await lockPublished(tx,articleId);
        await tx.articleLike.createMany({data:{userId,articleId},skipDuplicates:true});
      }else await tx.articleLike.deleteMany({where:{userId,articleId}});
    });
    return {active};
  });

  const collectionIdSchema={anyOf:[uuid,{type:'null'}]};
  app.put<{Params:Params;Body:Toggle&{collectionId?:string|null}}>('/api/articles/:id/bookmark',{
    preHandler:write,schema:{params,body:object({active:{type:'boolean'},collectionId:collectionIdSchema},['active'])},
  },async request=>{
    const articleId=request.params.id,userId=request.actor!.id,{active,collectionId}=request.body;
    await db.$transaction(async tx=>{
      if(!active){
        await tx.articleBookmark.deleteMany({where:{userId,articleId}});
        return;
      }
      await lockPublished(tx,articleId);
      if(collectionId===undefined){
        await tx.articleBookmark.createMany({data:{userId,articleId},skipDuplicates:true});
        return;
      }
      if(collectionId && !await tx.bookmarkCollection.findUnique({where:{userId_id:{userId,id:collectionId}},select:{id:true}}))
        throw new ApiError(404,'COLLECTION_NOT_FOUND','收藏合集不存在');
      await tx.$executeRaw`INSERT INTO article_bookmarks (user_id, article_id, collection_id)
        VALUES (${userId}::uuid, ${articleId}::uuid, ${collectionId}::uuid)
        ON CONFLICT (user_id, article_id) DO UPDATE SET collection_id = EXCLUDED.collection_id`;
    });
    return {active};
  });

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
  app.get<{Querystring:{view?:'published'|'courses'|'liked'|'bookmarks'|'pulses'|'likedPulses'|'following'|'followers';page?:string}}>('/api/me/profile',{
    preHandler:auth.requireUser,
    schema:{querystring:object({
      view:{type:'string',enum:['published','courses','liked','bookmarks','pulses','likedPulses','following','followers']},
      page:{type:'string',pattern:'^(?:[1-9][0-9]{0,5}|1000000)$'},
    },[])},
  },async (request,reply)=>{
    const {id}=request.actor!;
    const {view='published',page='1'}=request.query;
    const published={authorId:id,status:'PUBLISHED'} as const;
    const pageSize=12;
    const skip=(Number(page)-1)*pageSize;
    const orderBy=[{publishedAt:'desc'},{id:'desc'}] as const;
    reply.header('Cache-Control','no-store');
    const [user,reads,likes,following,followers,items]=await Promise.all([
      db.user.findUniqueOrThrow({where:{id},select:{avatarUrl:true,createdAt:true}}),
      db.article.aggregate({where:published,_sum:{viewCount:true}}),
      db.articleLike.count({where:{article:published}}),
      db.userFollow.count({where:{followerId:id,followee:{status:'ACTIVE'}}}),
      db.userFollow.count({where:{followeeId:id,follower:{status:'ACTIVE'}}}),
      view==='courses'
        ? db.course.findMany({
          where:published,select:{id:true,title:true,summary:true,level:true,
            category:{select:{name:true}},_count:{select:{lessons:{where:{status:'PUBLISHED'}}}}},
          orderBy:[...orderBy],skip,take:pageSize+1,
        }) : view==='liked'
        ? db.articleLike.findMany({
          where:{userId:id,article:{status:'PUBLISHED'}},select:{article:{select:articleSelect}},
          orderBy:[{createdAt:'desc'},{articleId:'desc'}],skip,take:pageSize+1,
        }).then(rows=>rows.map(row=>row.article))
        : view==='pulses' || view==='likedPulses' ? db.pulse.findMany({
          where:{status:'PUBLISHED',...(view==='pulses'?{authorId:id}:{likes:{some:{userId:id}}})},
          select:{id:true,body:true,images:true,createdAt:true,author:{select:{...authorSelect,avatarUrl:true}},
            _count:{select:{likes:true,comments:{where:{status:'VISIBLE',OR:[{parentId:null},{parent:{status:'VISIBLE'}}]}}}}},
          orderBy:[{createdAt:'desc'},{id:'desc'}],skip,take:pageSize+1,
        }) : view==='following' ? db.userFollow.findMany({
          where:{followerId:id,followee:{status:'ACTIVE'}},select:{followee:{select:{...authorSelect,avatarUrl:true}}},
          orderBy:[{createdAt:'desc'},{followeeId:'desc'}],skip,take:pageSize+1,
        }).then(rows=>rows.map(row=>row.followee))
        : view==='followers' ? db.userFollow.findMany({
          where:{followeeId:id,follower:{status:'ACTIVE'}},select:{follower:{select:{...authorSelect,avatarUrl:true}}},
          orderBy:[{createdAt:'desc'},{followerId:'desc'}],skip,take:pageSize+1,
        }).then(rows=>rows.map(row=>row.follower))
        : db.article.findMany({
          where:view==='bookmarks' ? {status:'PUBLISHED',bookmarks:{some:{userId:id}}} : published,
          select:articleSelect,orderBy:[...orderBy],skip,take:pageSize+1,
        }),
    ]);
    return {avatarUrl:user.avatarUrl,joinedAt:user.createdAt,stats:{likes,reads:reads._sum.viewCount??0,following,followers},
      items:items.slice(0,pageSize),hasMore:items.length>pageSize};
  });
  const savedArticle={status:'PUBLISHED'} as const;
  app.get('/api/me/bookmark-collections',{preHandler:auth.requireUser},async (request,reply)=>{
    const userId=request.actor!.id;
    reply.header('Cache-Control','private, no-store');
    const [named,defaultCount]=await Promise.all([
      db.bookmarkCollection.findMany({where:{userId},select:{id:true,name:true,
        _count:{select:{bookmarks:{where:{article:savedArticle}}}}},
        orderBy:[{createdAt:'desc'},{id:'desc'}]}),
      db.articleBookmark.count({where:{userId,collectionId:null,article:savedArticle}}),
    ]);
    return [{id:null,name:'默认收藏',articleCount:defaultCount},
      ...named.map(item=>({id:item.id,name:item.name,articleCount:item._count.bookmarks}))];
  });
  app.post<{Body:{name:string}}>('/api/me/bookmark-collections',{
    preHandler:write,schema:{body:object({name:{type:'string',minLength:1,maxLength:60,pattern:'\\S'}})},
  },async (request,reply)=>{
    const userId=request.actor!.id;
    const name=request.body.name.trim();
    if(name==='默认收藏')throw new ApiError(400,'RESERVED_COLLECTION_NAME','请使用其他合集名称');
    const collection=await db.bookmarkCollection.upsert({
      where:{userId_name:{userId,name}},create:{userId,name},update:{},select:{id:true,name:true},
    });
    return reply.code(201).send(collection);
  });
  app.get<{Params:Params;Querystring:{page?:string}}>('/api/me/bookmark-collections/:id/articles',{
    preHandler:auth.requireUser,schema:{
      params:object({id:{anyOf:[uuid,{const:'default'}]}}),
      querystring:object({page:{type:'string',pattern:'^[1-9][0-9]{0,5}$'}},[]),
    },
  },async (request,reply)=>{
    const userId=request.actor!.id;
    const id=request.params.id==='default'?null:request.params.id;
    const collection=id ? await db.bookmarkCollection.findUnique({where:{userId_id:{userId,id}},select:{id:true,name:true}})
      : {id:null,name:'默认收藏'};
    if(!collection)throw new ApiError(404,'COLLECTION_NOT_FOUND','收藏合集不存在');
    reply.header('Cache-Control','private, no-store');
    const pageSize=20;
    const rows=await db.articleBookmark.findMany({
      where:{userId,collectionId:id,article:savedArticle},select:{article:{select:articleSelect}},
      orderBy:[{createdAt:'desc'},{articleId:'desc'}],skip:(Number(request.query.page||1)-1)*pageSize,take:pageSize+1,
    });
    return {collection,items:rows.slice(0,pageSize).map(row=>row.article),hasMore:rows.length>pageSize};
  });
  app.get('/api/me/activity',{preHandler:auth.requireUser},async(request,reply)=>{
    const userId=request.actor!.id;
    const take=12;
    reply.header('Cache-Control','private, no-store');
    const [articles,pulses,bookmarks,follows]=await Promise.all([
      db.article.findMany({where:{authorId:userId,status:'PUBLISHED',publishedAt:{not:null}},select:articleSelect,
        orderBy:[{publishedAt:'desc'},{id:'desc'}],take}),
      db.pulse.findMany({where:{authorId:userId,status:'PUBLISHED'},
        select:{id:true,body:true,images:true,createdAt:true,author:{select:{...authorSelect,avatarUrl:true}},
          _count:{select:{likes:true,comments:{where:{status:'VISIBLE',OR:[{parentId:null},{parent:{status:'VISIBLE'}}]}}}}},
        orderBy:[{createdAt:'desc'},{id:'desc'}],take}),
      db.articleBookmark.findMany({where:{userId,article:savedArticle},select:{createdAt:true,article:{select:articleSelect}},
        orderBy:[{createdAt:'desc'},{articleId:'desc'}],take}),
      db.userFollow.findMany({where:{followerId:userId,followee:{status:'ACTIVE'}},
        select:{createdAt:true,followee:{select:{...authorSelect,avatarUrl:true}}},orderBy:[{createdAt:'desc'},{followeeId:'desc'}],take}),
    ]);
    return [
      ...articles.map(item=>({kind:'article',at:item.publishedAt!,item})),
      ...pulses.map(item=>({kind:'pulse',at:item.createdAt,item})),
      ...bookmarks.map(row=>({kind:'bookmark',at:row.createdAt,item:row.article})),
      ...follows.map(row=>({kind:'follow',at:row.createdAt,item:row.followee})),
    ].sort((a,b)=>b.at.getTime()-a.at.getTime()).slice(0,take);
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
