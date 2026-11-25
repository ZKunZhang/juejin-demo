import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { PrismaClient } from '../../generated/prisma/client';
import { ApiError, security } from './security';
import { articleSelect, authorSelect, conflict, draftSelect, missing, object, uuid, versionSchema } from './articles';

type Status='DRAFT'|'PUBLISHED'|'UNLISTED';
type Review='NOT_SUBMITTED'|'PENDING'|'APPROVED'|'REJECTED';
type Action='SUBMIT'|'APPROVE'|'REJECT'|'UNLIST'|'RETURN_TO_DRAFT';
type Params={id:string};
type Change={version:number;reason?:string};
type CommentStatus='VISIBLE'|'HIDDEN';
const params=object({id:uuid});
const reasonSchema={type:'string',maxLength:1000};
const commentStatus={enum:['VISIBLE','HIDDEN']};
const pageSchema={type:'string',pattern:'^[1-9][0-9]{0,3}$'};
const transitions:Record<Action,{from:Status;review:Review[];to:Status;next:Review}> = {
  SUBMIT:{from:'DRAFT',review:['NOT_SUBMITTED','REJECTED'],to:'DRAFT',next:'PENDING'},
  APPROVE:{from:'DRAFT',review:['PENDING'],to:'PUBLISHED',next:'APPROVED'},
  REJECT:{from:'DRAFT',review:['PENDING'],to:'DRAFT',next:'REJECTED'},
  UNLIST:{from:'PUBLISHED',review:['APPROVED'],to:'UNLISTED',next:'APPROVED'},
  RETURN_TO_DRAFT:{from:'UNLISTED',review:['APPROVED'],to:'DRAFT',next:'NOT_SUBMITTED'},
};
export function registerModeration(app:FastifyInstance,db:PrismaClient,auth:ReturnType<typeof security>,write:preHandlerHookHandler[]) {
  async function transition(id:string,actorId:string,action:Action,{version,reason:raw}:Change) {
    const rule=transitions[action];
    const reason=raw?.trim()||null;
    if ((action==='REJECT'||action==='UNLIST')&&!reason) throw new ApiError(400,'REASON_REQUIRED','请填写操作原因');
    return db.$transaction(async tx=>{
      const row=await tx.article.findUnique({where:{id}});
      if (!row) throw missing();
      if ((action==='SUBMIT'||action==='RETURN_TO_DRAFT')&&row.authorId!==actorId) throw new ApiError(403,'FORBIDDEN','无权修改此文章');
      if (row.version!==version||row.status!==rule.from||!rule.review.includes(row.reviewStatus)) throw conflict();
      if (action==='SUBMIT'&&(!row.title.trim()||!row.bodyMarkdown.trim())) throw new ApiError(400,'INCOMPLETE_ARTICLE','请填写标题和正文');
      const updated=await tx.article.updateMany({
        where:{id,version,status:row.status,reviewStatus:row.reviewStatus},
        data:{status:rule.to,reviewStatus:rule.next,version:{increment:1},publishedAt:action==='APPROVE'?new Date():undefined},
      });
      if (!updated.count) throw conflict();
      await tx.articleReview.create({data:{articleId:id,actorId,articleVersion:version,
        action,fromStatus:row.status,toStatus:rule.to,fromReviewStatus:row.reviewStatus,toReviewStatus:rule.next,reason}});
      return tx.article.findUniqueOrThrow({where:{id},select:draftSelect});
    });
  }

  for (const [path,action] of [['submit','SUBMIT'],['return-to-draft','RETURN_TO_DRAFT']] as const) {
    app.post<{Params:Params;Body:Change}>('/api/articles/:id/'+path,{
      preHandler:[...write,auth.requireUser],schema:{params,body:object({version:versionSchema})},
    },request=>transition(request.params.id,request.actor!.id,action,request.body));
  }
  app.get<{Querystring:{status?:Status;reviewStatus?:Review;page?:string}}>('/api/admin/articles',{
    preHandler:auth.requireAdmin,schema:{querystring:object({status:{enum:['DRAFT','PUBLISHED','UNLISTED']},reviewStatus:{enum:['NOT_SUBMITTED','PENDING','APPROVED','REJECTED']},page:pageSchema},[])},
  },async request=>{
    const page=Number(request.query.page||1);
    const items=await db.article.findMany({where:{status:request.query.status,reviewStatus:request.query.reviewStatus},
      select:{...articleSelect,status:true,reviewStatus:true,version:true},orderBy:[{updatedAt:'desc'},{id:'desc'}],skip:(page-1)*30,take:31});
    const hasMore=items.length>30;if(hasMore)items.pop();
    return {items,hasMore};
  });
  app.get<{Params:Params}>('/api/admin/articles/:id',{preHandler:auth.requireAdmin,schema:{params}},async request=>{
    const item=await db.article.findUnique({where:{id:request.params.id},select:{...draftSelect,
      reviews:{select:{articleVersion:true,action:true,reason:true,createdAt:true,actor:{select:authorSelect}},orderBy:{articleVersion:'desc'},take:30}}});
    if(!item)throw missing();
    return item;
  });
  app.post<{Params:Params;Body:Change&{action:'APPROVE'|'REJECT'}}>('/api/admin/articles/:id/review',{
    preHandler:[...write,auth.requireAdmin],schema:{params,body:object({version:versionSchema,action:{enum:['APPROVE','REJECT']},reason:reasonSchema},['version','action'])},
  },request=>transition(request.params.id,request.actor!.id,request.body.action,request.body));
  app.post<{Params:Params;Body:Change}>('/api/admin/articles/:id/unlist',{
    preHandler:[...write,auth.requireAdmin],schema:{params,body:object({version:versionSchema,reason:reasonSchema})},
  },request=>transition(request.params.id,request.actor!.id,'UNLIST',request.body));

  app.get<{Querystring:{articleId?:string;status?:CommentStatus;page?:string}}>('/api/admin/comments',{
    preHandler:auth.requireAdmin,schema:{querystring:object({articleId:uuid,status:commentStatus,page:pageSchema},[])},
  },async request=>{
    const page=Number(request.query.page||1);
    const items=await db.comment.findMany({where:{articleId:request.query.articleId,status:request.query.status},
      select:{id:true,body:true,status:true,createdAt:true,parent:{select:{id:true,status:true}},author:{select:authorSelect},article:{select:{id:true,title:true}}},
      orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*30,take:31});
    const hasMore=items.length>30;if(hasMore)items.pop();
    return {items,hasMore};
  });
  app.patch<{Params:Params;Body:{expectedStatus:CommentStatus;status:CommentStatus;reason?:string}}>('/api/admin/comments/:id/status',{
    preHandler:[...write,auth.requireAdmin],schema:{params,body:object({expectedStatus:commentStatus,status:commentStatus,reason:reasonSchema},['expectedStatus','status'])},
  },request=>{
    const {id}=request.params;
    const {expectedStatus,status,reason:raw}=request.body;
    const reason=raw?.trim()||null;
    if(status===expectedStatus)throw new ApiError(400,'INVALID_TRANSITION','请选择不同的目标状态');
    if(status==='HIDDEN'&&!reason)throw new ApiError(400,'REASON_REQUIRED','请输入隐藏原因');
    return db.$transaction(async tx=>{
      const updated=await tx.comment.updateMany({where:{id,status:expectedStatus},data:{status}});
      if(!updated.count) {
        if(!(await tx.comment.findUnique({where:{id},select:{id:true}}))) throw missing();
        throw conflict();
      }
      await tx.commentModeration.create({data:{commentId:id,adminId:request.actor!.id,fromStatus:expectedStatus,toStatus:status,reason}});
      return {id,status};
    });
  });
}
