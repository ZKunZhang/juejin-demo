import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { PrismaClient } from '../../generated/prisma/client';
import { ApiError, security } from './security';
import { authorSelect, missing, object, uuid } from './articles';

type PulseInput={body:string;images:string[];tagId?:string};
type Query={tab?:'latest'|'recommended'|'following'|'featured';tagId?:string};
const pulseSelect={id:true,body:true,images:true,featured:true,createdAt:true,author:{select:{...authorSelect,avatarUrl:true}},
  tags:{select:{tag:{select:{id:true,name:true,slug:true}}}},_count:{select:{likes:true}}} as const;

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
export function registerPulses(app:FastifyInstance,db:PrismaClient,auth:ReturnType<typeof security>,protectedWrite:preHandlerHookHandler[]) {
  const write=[...protectedWrite,auth.requireUser];
  app.get('/api/pulses/leaderboard',async()=>db.$queryRaw<Array<{id:string;displayName:string;likes:number;pulses:number}>>`
    SELECT u.id, u.display_name AS "displayName",
           count(pl.user_id)::integer AS likes, count(DISTINCT p.id)::integer AS pulses
    FROM pulses p
    JOIN users u ON u.id=p.author_id AND u.status='ACTIVE'
    LEFT JOIN pulse_likes pl ON pl.pulse_id=p.id
    GROUP BY u.id
    ORDER BY likes DESC, pulses DESC, u.id ASC
    LIMIT 5
  `);
  app.get('/api/pulses/topics',async()=>db.tag.findMany({
    where:{scope:{not:'ARTICLE'}},select:{id:true,name:true,slug:true,_count:{select:{pulses:true}}},
    orderBy:[{scope:'desc'},{createdAt:'asc'},{id:'asc'}],
  }));
  app.get<{Querystring:Query}>('/api/pulses',{
    schema:{querystring:object({tab:{enum:['latest','recommended','following','featured']},tagId:uuid},[])},
  },async request=>{
    const {tab='recommended',tagId}=request.query;
    const actor=await auth.findActor(request);
    if(tab==='following'&&!actor)throw new ApiError(401,'UNAUTHENTICATED','请登录查看关注沸点');
    const rows=await db.pulse.findMany({where:{
      ...(tagId?{tags:{some:{tagId}}}:{}),
      ...(tab==='featured'?{featured:true}:{}),
      ...(tab==='following'?{author:{followers:{some:{followerId:actor!.id}}}}:{}),
    },select:{...pulseSelect,likes:actor?{where:{userId:actor.id},select:{userId:true},take:1}:false},
    orderBy:tab==='recommended'?[{featured:'desc'},{likes:{_count:'desc'}},{createdAt:'desc'},{id:'desc'}]:[{createdAt:'desc'},{id:'desc'}],
    take:tab==='featured'?5:50});
    const followed=new Set(actor?(await db.userFollow.findMany({
      where:{followerId:actor.id,followeeId:{in:rows.map(row=>row.author.id)}},select:{followeeId:true},
    })).map(row=>row.followeeId):[]);
    return rows.map(({likes,...row})=>({...row,liked:!!likes?.length,following:followed.has(row.author.id)}));
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
  app.put<{Params:{id:string};Body:{active:boolean}}>('/api/pulses/:id/like',{
    preHandler:write,schema:{params:object({id:uuid}),body:object({active:{type:'boolean'}})},
  },async request=>{
    const pulseId=request.params.id,userId=request.actor!.id,{active}=request.body;
    if(!await db.pulse.findUnique({where:{id:pulseId},select:{id:true}}))throw missing();
    if(active)await db.pulseLike.createMany({data:{pulseId,userId},skipDuplicates:true});
    else await db.pulseLike.deleteMany({where:{pulseId,userId}});
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
