import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { ApiError, security } from './security';
import { authorSelect, missing, object, uuid } from './articles';
import { assureViewer, viewerKey } from './article-views';

type PulseInput={body:string;images:string[];tagId?:string};
type Query={tab?:'latest'|'recommended'|'following'|'featured';tagId?:string};
const pulseSelect={id:true,body:true,images:true,featured:true,status:true,createdAt:true,author:{select:{...authorSelect,avatarUrl:true}},
  tags:{select:{tag:{select:{id:true,name:true,slug:true}}}},_count:{select:{likes:true,comments:{where:{status:'VISIBLE',OR:[{parentId:null},{parent:{status:'VISIBLE'}}]}}}}} satisfies Prisma.PulseSelect;

const commentSelect={id:true,parentId:true,body:true,createdAt:true,author:{select:authorSelect},_count:{select:{likes:true}}} as const;
type Tx=Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
async function lockPublicPulse(tx:Tx,id:string) {
  const found=await tx.$queryRaw<{id:string}[]>`SELECT id FROM pulses WHERE id = ${id}::uuid AND status = 'PUBLISHED' FOR SHARE`;
  if(!found.length)throw missing();
}

function localDate() {
  const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format();
  return new Date(date+'T00:00:00.000Z');
}
function imageUrl(value:string) {
  try {
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password)throw new Error();
    return url.href;
  }catch{throw new ApiError(400,'INVALID_IMAGE','请输入有效的 HTTPS 图片地址');}
}
export function registerPulses(app:FastifyInstance,db:PrismaClient,auth:ReturnType<typeof security>,protectedWrite:preHandlerHookHandler[],secure:boolean) {
  const write=[...protectedWrite,auth.requireUser];
  app.get('/api/pulses/leaderboard',async()=>db.$queryRaw<Array<{id:string;displayName:string;likes:number;pulses:number}>>`
    SELECT u.id, u.display_name AS "displayName",
           count(pl.user_id)::integer AS likes, count(DISTINCT p.id)::integer AS pulses
    FROM pulses p
    JOIN users u ON u.id=p.author_id AND u.status='ACTIVE'
    LEFT JOIN pulse_likes pl ON pl.pulse_id=p.id
    WHERE p.status='PUBLISHED'
    GROUP BY u.id
    ORDER BY likes DESC, pulses DESC, u.id ASC
    LIMIT 50
  `);
  app.get('/api/pulses/topics',async()=>db.tag.findMany({
    where:{scope:{not:'ARTICLE'}},select:{id:true,name:true,slug:true,_count:{select:{pulses:{where:{pulse:{status:"PUBLISHED"}}}}}},
    orderBy:[{scope:'desc'},{createdAt:'asc'},{id:'asc'}],
  }));
  app.get<{Querystring:Query}>('/api/pulses',{
    schema:{querystring:object({tab:{enum:['latest','recommended','following','featured']},tagId:uuid},[])},
  },async (request,reply)=>{
    reply.header('Cache-Control','private, no-store');
    const {tab='recommended',tagId}=request.query;
    const actor=await auth.findActor(request);
    if(tab==='following'&&!actor)throw new ApiError(401,'UNAUTHENTICATED','请登录查看关注沸点');
    const rows=await db.pulse.findMany({where:{status:'PUBLISHED',
      ...(tagId?{tags:{some:{tagId}}}:{}),
      ...(tab==='featured'?{featured:true}:{}),
      ...(tab==='following'?{author:{followers:{some:{followerId:actor!.id}}}}:{}),
    },select:{...pulseSelect,likes:actor?{where:{userId:actor.id},select:{userId:true},take:1}:false},
    orderBy:tab==='recommended'?[{featured:'desc'},{likes:{_count:'desc'}},{createdAt:'desc'},{id:'desc'}]:[{createdAt:'desc'},{id:'desc'}],
    take:tab==='featured'?5:50});
    const followed=new Set(actor?(await db.userFollow.findMany({
      where:{followerId:actor.id,followeeId:{in:rows.map(row=>row.author.id)}},select:{followeeId:true},
    })).map(row=>row.followeeId):[]);
    if(tab!=='featured')assureViewer(request,reply,secure);
    return rows.map(({likes,...row})=>({...row,liked:!!likes?.length,following:followed.has(row.author.id)}));
  });
  app.get<{Params:{id:string}}>('/api/pulses/:id',{schema:{params:object({id:uuid})}},async(request,reply)=>{
    const id=request.params.id;
    const actor=await auth.findActor(request);
    const pulse=await db.pulse.findFirst({where:{id,status:'PUBLISHED'},select:{...pulseSelect,
      likes:actor?{where:{userId:actor.id},select:{userId:true},take:1}:false,
    }});
    if(!pulse)throw missing();
    const {likes,...item}=pulse;
    const following=actor&&await db.userFollow.findUnique({where:{followerId_followeeId:{followerId:actor.id,followeeId:item.author.id}}});
    const related=await db.pulse.findMany({
      where:{id:{not:id},status:'PUBLISHED',tags:{some:{tagId:{in:item.tags.map(({tag})=>tag.id)}}}},
      select:{id:true,body:true,images:true,_count:pulseSelect._count},
      orderBy:[{likes:{_count:'desc'}},{createdAt:'desc'},{id:'desc'}],take:5,
    });
    reply.header('Cache-Control','private, no-store');
    assureViewer(request,reply,secure);
    return {pulse:{...item,liked:!!likes?.length,following:!!following},related};
  });
  app.post<{Params:{id:string}}>('/api/pulses/:id/views',{
    preHandler:protectedWrite,schema:{params:object({id:uuid})},
  },async request=>{
    const {id}=request.params;
    const viewer=viewerKey(request);
    if(!viewer)throw new ApiError(400,'MISSING_VIEWER','请先加载沸点列表');
    return db.$transaction(async tx=>{
      const rows=await tx.$queryRaw<{view_count:number}[]>`SELECT view_count FROM pulses WHERE id=${id}::uuid AND status='PUBLISHED' FOR UPDATE`;
      if(!rows.length)throw missing();
      const recorded=await tx.$executeRaw`
        INSERT INTO pulse_view_windows(pulse_id,viewer_key,last_counted_at)
        VALUES (${id}::uuid,${viewer},now())
        ON CONFLICT (pulse_id,viewer_key) DO UPDATE SET last_counted_at=EXCLUDED.last_counted_at
        WHERE pulse_view_windows.last_counted_at <= EXCLUDED.last_counted_at - interval '30 minutes'
      `;
      if(!recorded)return {viewCount:rows[0].view_count};
      const updated=await tx.pulse.update({where:{id},data:{viewCount:{increment:1}},select:{viewCount:true}});
      return updated;
    });
  });
  app.post<{Body:PulseInput}>('/api/pulses',{preHandler:write,
    schema:{body:object({body:{type:'string',maxLength:2000},images:{type:'array',maxItems:4,uniqueItems:true,items:{type:'string',maxLength:2000}},tagId:uuid},['body','images'])},
  },async(request,reply)=>{
    const {tagId}=request.body;
    const body=request.body.body.trim(),images=request.body.images.map(imageUrl);
    if(!body&&!images.length)throw new ApiError(400,'EMPTY_PULSE','请输入文字或添加图片');
    if(tagId&&!await db.tag.findFirst({where:{id:tagId,scope:{not:'ARTICLE'}},select:{id:true}}))throw new ApiError(400,'UNKNOWN_TAG','标签不存在');
    const pulse=await db.pulse.create({data:{authorId:request.actor!.id,body,images,tags:tagId?{create:{tagId}}:undefined},select:pulseSelect});
    return reply.code(201).send({...pulse,liked:false,following:false});
  });
  app.get('/api/me/pulses/reviews',{preHandler:auth.requireUser},async(request,reply)=>{
    reply.header('Cache-Control','private, no-store');
    return db.pulse.findMany({
      where:{authorId:request.actor!.id,status:{not:'PUBLISHED'}},
      select:{id:true,body:true,status:true,reviewReason:true,createdAt:true},
      orderBy:[{createdAt:'desc'},{id:'desc'}],take:20,
    });
  });
  app.get<{Params:{id:string};Querystring:{page?:string;sort?:'hot'|'latest'}}>('/api/pulses/:id/comments',{
    schema:{params:object({id:uuid}),querystring:object({page:{type:'string',pattern:'^[1-9][0-9]{0,5}$'},sort:{enum:['hot','latest']}},[])},
  },async(request,reply)=>{
    reply.header('Cache-Control','private, no-store');
    const {page,sort}=request.query;
    const actor=await auth.findActor(request);
    const liked=actor?{where:{userId:actor.id},select:{userId:true},take:1} as const:false;
    const fields={...commentSelect,likes:liked};
    const pulse=await db.pulse.findFirst({where:{id:request.params.id,status:'PUBLISHED'},select:{comments:{
      where:{status:'VISIBLE',parentId:null},select:{...fields,replies:{
        where:{status:'VISIBLE'},select:fields,orderBy:[{createdAt:'desc'},{id:'desc'}],take:20,
      }},
      orderBy:[...(sort==='hot'?[{likes:{_count:'desc' as const}}]:[]),{createdAt:'desc'},{id:'desc'}],
      skip:page?(Number(page)-1)*20:0,take:page?21:100,
    }}});
    if(!pulse)throw missing();
    const decorate=<T extends {likes?:unknown[];_count:{likes:number}}>(comment:T)=>{
      const {likes,_count,...publicFields}=comment;
      return {...publicFields,liked:!!likes?.length,likeCount:_count.likes};
    };
    const comments=pulse.comments.map(comment=>{
      const {replies,...root}=comment;
      return {...decorate(root),replies:replies.reverse().map(decorate)};
    });
    return page||sort?comments:comments.reverse();
  });
  app.post<{Params:{id:string};Body:{body:string;parentId?:string}}>('/api/pulses/:id/comments',{
    preHandler:write,schema:{params:object({id:uuid}),body:object({body:{type:'string',minLength:1,maxLength:2000,pattern:'\\S'},parentId:uuid},['body'])},
  },async(request,reply)=>{
    const pulseId=request.params.id, authorId=request.actor!.id, body=request.body.body.trim(),{parentId}=request.body;
    const comment=await db.$transaction(async tx=>{
      await lockPublicPulse(tx,pulseId);
      if(parentId){
        const parent=await tx.$queryRaw<{id:string}[]>`SELECT id FROM pulse_comments WHERE id=${parentId}::uuid AND pulse_id=${pulseId}::uuid AND status='VISIBLE' AND parent_id IS NULL FOR SHARE`;
        if(!parent.length)throw missing();
      }
      return tx.pulseComment.create({data:{pulseId,authorId,body,parentId},select:commentSelect});
    });
    const {_count,...item}=comment;
    return reply.code(201).send({...item,liked:false,likeCount:_count.likes});
  });
  app.put<{Params:{id:string;commentId:string};Body:{active:boolean}}>('/api/pulses/:id/comments/:commentId/like',{
    preHandler:write,schema:{params:object({id:uuid,commentId:uuid}),body:object({active:{type:'boolean'}})},
  },async request=>{
    const {id:pulseId,commentId}=request.params;
    const {active}=request.body;
    const userId=request.actor!.id;
    return db.$transaction(async tx=>{
      await lockPublicPulse(tx,pulseId);
      const target=await tx.$queryRaw<{parent_id:string|null}[]>`SELECT parent_id FROM pulse_comments WHERE id=${commentId}::uuid AND pulse_id=${pulseId}::uuid AND status='VISIBLE' FOR SHARE`;
      if(!target.length)throw missing();
      if(target[0].parent_id){
        const parent=await tx.$queryRaw<{id:string}[]>`SELECT id FROM pulse_comments WHERE id=${target[0].parent_id}::uuid AND pulse_id=${pulseId}::uuid AND status='VISIBLE' FOR SHARE`;
        if(!parent.length)throw missing();
      }
      if(active)await tx.pulseCommentLike.createMany({data:{userId,commentId},skipDuplicates:true});
      else await tx.pulseCommentLike.deleteMany({where:{userId,commentId}});
      return {liked:active,likeCount:await tx.pulseCommentLike.count({where:{commentId}})};
    });
  });
  app.put<{Params:{id:string};Body:{active:boolean}}>('/api/pulses/:id/like',{
    preHandler:write,schema:{params:object({id:uuid}),body:object({active:{type:'boolean'}})},
  },async request=>{
    const pulseId=request.params.id,userId=request.actor!.id,{active}=request.body;
    await db.$transaction(async tx=>{
      await lockPublicPulse(tx,pulseId);
      if(active)await tx.pulseLike.createMany({data:{pulseId,userId},skipDuplicates:true});
      else await tx.pulseLike.deleteMany({where:{pulseId,userId}});
    });
    return {active};
  });
  app.get('/api/me/checkin',{preHandler:auth.requireUser},async request=>{
    const row=await db.checkin.findUnique({where:{userId_localDate:{userId:request.actor!.id,localDate:localDate()}}});
    return {checked:!!row};
  });
  app.post('/api/me/checkin',{preHandler:write},async request=>{
    await db.checkin.createMany({data:{userId:request.actor!.id,localDate:localDate()},skipDuplicates:true});
    return {checked:true};
  });
}
