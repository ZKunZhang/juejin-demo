import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { buildApp } from '../apps/api/app/app';
import { connectDatabase } from '../apps/api/shared/db';
import { digest, sessionName } from '../apps/api/shared/security';

const origin='http://127.0.0.1:5173';
const testUrl=process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test')) throw new Error('Use a dedicated TEST_DATABASE_URL ending in _test');

test('works persist through submission, moderation, public filters and interactions',async()=>{
  const db=connectDatabase(testUrl);
  const app=await buildApp(db,{origins:[origin]});
  const run=randomBytes(5).toString('hex');
  const userIds:string[]=[];
  let projectId:string|undefined;
  async function identity(suffix:string,role:'USER'|'ADMIN'='USER') {
    const raw=randomBytes(32).toString('hex');
    const user=await db.user.create({data:{username:'work_'+run+suffix,displayName:suffix,role,passwordHash:'test-fixture',
      sessions:{create:{tokenHash:digest(raw),expiresAt:new Date(Date.now()+60000)}}}});
    userIds.push(user.id);
    const cookie=sessionName+'='+raw;
    const csrf=await app.inject({method:'GET',url:'/api/auth/csrf',headers:{cookie}});
    const cookies=[csrf.headers['set-cookie']||[]].flat().map(value=>value.split(';')[0]);
    return {cookie:[cookie,...cookies].join('; '),origin,'x-csrf-token':csrf.json().csrfToken};
  }
  try {
    const [owner,other,admin]=await Promise.all([identity('owner'),identity('other'),identity('admin','ADMIN')]);
    const get=(url:string,headers?:typeof owner)=>app.inject({method:'GET',url,headers});
    const options=await get('/api/project-options');
    expect(options.statusCode).toBe(200);
    const {categories,platforms}=options.json();
    const body={title:'项目 '+run,summary:'技术作品',bodyMarkdown:'# 项目',projectUrl:'https://example.com',
      coverUrl:null as string|null,repositoryUrl:null,categoryIds:[categories[0].id],platformIds:[platforms[0].id]};
    const create=(payload:typeof body,headers=owner)=>app.inject({method:'POST',url:'/api/me/projects',payload,headers});
    expect((await create({...body,projectUrl:'javascript:alert(1)'})).statusCode).toBe(400);
    expect((await create({...body,coverUrl:'http://example.com/cover.png'})).statusCode).toBe(400);
    const created=await create(body);
    expect(created.statusCode).toBe(201);
    const {id,version}=created.json();
    projectId=id;
    const mine='/api/me/projects/'+id;
    const publicPath='/api/projects/'+id;
    const statusPath='/api/admin/projects/'+id+'/status';
    expect((await get(publicPath)).statusCode).toBe(404);
    expect((await get('/api/me/projects',other)).json().items).toEqual([]);
    expect((await get('/api/admin/projects',owner)).statusCode).toBe(403);
    const submit=(headers=owner)=>app.inject({method:'POST',url:mine+'/submit',headers,payload:{version}});
    expect((await submit(other)).statusCode).toBe(404);
    const submitted=await submit();
    expect(submitted.statusCode).toBe(200);
    expect((await app.inject({method:'PATCH',url:mine,headers:owner,payload:{...body,version:submitted.json().version}})).statusCode).toBe(409);
    expect((await get('/api/admin/projects?from=1900-01-01&to=1900-01-01',admin)).json().items).toEqual([]);
    const moderate=(status:string,v:number,headers=admin,reason?:string)=>app.inject({method:'PATCH',url:statusPath,headers,
      payload:{status,version:v,...(reason?{reason}:{})}});
    expect((await moderate('PUBLISHED',submitted.json().version,other)).statusCode).toBe(403);
    expect((await moderate('REJECTED',submitted.json().version)).statusCode).toBe(400);
    const approvals=await Promise.all([moderate('PUBLISHED',submitted.json().version),moderate('PUBLISHED',submitted.json().version)]);
    expect(approvals.map(response=>response.statusCode).sort()).toEqual([200,409]);
    const approved=approvals.find(response=>response.statusCode===200)!.json();
    expect(await db.projectReview.count({where:{projectId:id,nextStatus:'PUBLISHED'}})).toBe(1);
    const filter=new URLSearchParams({q:run,categoryId:categories[0].id,platformId:platforms[0].id,days:'7',sort:'latest'});
    expect((await get('/api/projects?'+filter)).json().items.map((row:{id:string})=>row.id)).toEqual([id]);
    filter.set('platformId',platforms[1].id);
    expect((await get('/api/projects?'+filter)).json().items).toEqual([]);
    const publicDetail=await get(publicPath,other);
    expect(publicDetail.statusCode).toBe(200);
    const viewer=([publicDetail.headers['set-cookie']||[]].flat()).find(cookie=>cookie.startsWith('mazhan_viewer='))!.split(';')[0];
    const view=()=>app.inject({method:'POST',url:publicPath+'/views',headers:{...other,cookie:other.cookie+'; '+viewer}});
    expect((await Promise.all([view(),view()])).map(response=>response.json().viewCount)).toEqual([1,1]);
    const like=()=>app.inject({method:'PUT',url:publicPath+'/like',headers:other});
    expect((await Promise.all([like(),like()])).map(response=>response.json().likeCount)).toEqual([1,1]);
    expect((await get(publicPath,other)).json().liked).toBe(true);
    const unlisted=await moderate('UNLISTED',approved.version,admin,'演示下架');
    expect(unlisted.statusCode).toBe(200);
    expect((await get(publicPath)).statusCode).toBe(404);
    expect((await view()).statusCode).toBe(404);
    expect((await like()).statusCode).toBe(404);
    expect(await db.projectViewWindow.count({where:{projectId:id}})).toBe(1);
    expect(await db.projectLike.count({where:{projectId:id}})).toBe(1);
    const relisted=await moderate('PUBLISHED',unlisted.json().version);
    expect(relisted.statusCode).toBe(200);
    expect(relisted.json().publishedAt).toBe(approved.publishedAt);
    expect((await get(publicPath)).statusCode).toBe(200);
    expect((await moderate('DELETED',relisted.json().version,other)).statusCode).toBe(403);
    expect((await moderate('DELETED',approved.version)).statusCode).toBe(409);
    const deleted=await moderate('DELETED',relisted.json().version);
    expect(deleted.statusCode).toBe(200);
    expect((await get(publicPath)).statusCode).toBe(404);
    expect((await get('/api/me/projects',owner)).json().items).toEqual([]);
    expect((await get('/api/admin/projects',admin)).json().items.some((row:{id:string})=>row.id===id)).toBe(false);
    expect((await get('/api/admin/projects?status=DELETED',admin)).json().items.some((row:{id:string})=>row.id===id)).toBe(true);
    expect((await moderate('PUBLISHED',deleted.json().version)).statusCode).toBe(404);
    expect(await db.projectReview.count({where:{projectId:id,action:{in:['RELIST','DELETE']}}})).toBe(2);

    const comments=await db.$queryRaw<{count:bigint}[]>`
      SELECT count(*) FROM pg_class WHERE relname IN ('projects','project_categories','project_platforms',
      'project_category_links','project_platform_links','project_likes','project_view_windows','project_reviews')
      AND relnamespace='public'::regnamespace AND obj_description(oid,'pg_class') IS NOT NULL`;
    expect(comments[0].count).toBe(8n);
    const fields=await db.$queryRaw<{missing:bigint}[]>`
      SELECT count(*) AS missing FROM pg_attribute
      WHERE attrelid='public.projects'::regclass AND attnum>0 AND NOT attisdropped
      AND col_description(attrelid,attnum) IS NULL`;
    expect(fields[0].missing).toBe(0n);
  } finally {
    if (projectId) await db.project.deleteMany({where:{id:projectId}});
    await db.user.deleteMany({where:{id:{in:userIds}}});
    await app.close();
    await db.$disconnect();
  }
});
