import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { PrismaClient } from '../../generated/prisma/client';
import { ApiError, digest } from './security';

const viewerCookie='mazhan_viewer';
const valid=(value:string|undefined):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function viewerKey(request:FastifyRequest) {
  const viewer=request.cookies[viewerCookie];
  return valid(viewer) ? digest(viewer) : null;
}
export function assureViewer(request:FastifyRequest,reply:FastifyReply,secure:boolean) {
  if(!valid(request.cookies[viewerCookie])) {
    reply.setCookie(viewerCookie,randomBytes(32).toString('hex'),{httpOnly:true,sameSite:'lax',secure,path:'/'});
  }
}
export function registerArticleViews(app:FastifyInstance,db:PrismaClient,write:preHandlerHookHandler[]) {
  app.post<{Params:{id:string}}>('/api/articles/:id/views',{preHandler:write,schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',format:'uuid'}}}}},async request=>{
    const {id}=request.params;
    const viewer=viewerKey(request);
    if(!viewer)throw new ApiError(400,'MISSING_VIEWER','请先加载文章详情');
    return db.$transaction(async tx=>{
      const rows=await tx.$queryRaw<{view_count:number}[]>`SELECT view_count FROM articles WHERE id=${id}::uuid AND status='PUBLISHED' FOR UPDATE`;
      if(!rows.length)throw new ApiError(404,'NOT_FOUND','内容不存在');
      const now=new Date();
      const counted=await tx.$executeRaw`
        INSERT INTO article_view_windows(article_id,viewer_key,last_counted_at)
        VALUES (${id}::uuid,${viewer},${now})
        ON CONFLICT (article_id,viewer_key) DO UPDATE SET last_counted_at=EXCLUDED.last_counted_at
        WHERE article_view_windows.last_counted_at <= EXCLUDED.last_counted_at - interval '30 minutes'
      `;
      if(!counted)return {viewCount:rows[0].view_count};
      const [updated]=await tx.$queryRaw<{view_count:number}[]>`UPDATE articles SET view_count=view_count+1 WHERE id=${id}::uuid RETURNING view_count`;
      return {viewCount:updated.view_count};
    });
  });
}
