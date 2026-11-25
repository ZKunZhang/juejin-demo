import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../generated/prisma/client';
import type { security } from './security';

export function registerCreator(app:FastifyInstance,db:PrismaClient,auth:ReturnType<typeof security>) {
  app.get('/api/me/creator',{preHandler:auth.requireUser},async(request,reply)=>{
    const authorId=request.actor!.id;
    const article={authorId,status:'PUBLISHED' as const};
    const [profile,followers,following,views,likes,comments,bookmarks,recentArticles,recentPulses]=await db.$transaction([
      db.user.findUniqueOrThrow({where:{id:authorId},select:{avatarUrl:true,createdAt:true}}),
      db.userFollow.count({where:{followeeId:authorId,follower:{status:'ACTIVE'}}}),
      db.userFollow.count({where:{followerId:authorId,followee:{status:'ACTIVE'}}}),
      db.article.aggregate({where:article,_sum:{viewCount:true}}),
      db.articleLike.count({where:{article}}),
      db.comment.count({where:{article,status:'VISIBLE',OR:[{parentId:null},{parent:{status:'VISIBLE'}}]}}),
      db.articleBookmark.count({where:{article}}),
      db.article.findMany({where:{authorId},select:{id:true,title:true,status:true,reviewStatus:true,updatedAt:true},orderBy:[{updatedAt:'desc'},{id:'desc'}],take:6}),
      db.pulse.findMany({where:{authorId},select:{id:true,body:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:6}),
    ]);
    reply.header('Cache-Control','private, no-store');
    return {profile,stats:{followers,following,views:views._sum.viewCount??0,likes,comments,bookmarks},recentArticles,recentPulses};
  });
}
