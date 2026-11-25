import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { expect,test } from 'vitest';
import { buildApp } from '../apps/api/app';
import { connectDatabase } from '../apps/api/db';
import { digest,sessionName } from '../apps/api/security';

const origin='http://127.0.0.1:5173';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('A dedicated TEST_DATABASE_URL ending in _test is required');
test('pulse publish, image validation, tag, followed feed, like and day check-in persist',async()=>{
  const db=connectDatabase(url);
  const app=await buildApp(db,{origins:[origin]});
  const ids:string[]=[];
  const key=randomBytes(5).toString('hex');
  async function actor(suffix:string) {
    const token=randomBytes(32).toString('hex');
    const row=await db.user.create({data:{username:'pulse_'+key+suffix,displayName:suffix,passwordHash:'fixture',sessions:{create:{tokenHash:digest(token),expiresAt:new Date(Date.now()+60000)}}}});
    ids.push(row.id);
    const csrf=await app.inject({method:'GET',url:'/api/auth/csrf'});
    const cookie=[sessionName+'='+token,...[csrf.headers['set-cookie']||[]].flat().map(value=>value.split(';')[0])].join('; ');
    return {id:row.id,headers:{cookie,origin,'x-csrf-token':csrf.json().csrfToken}};
  }
  try{
    const author=await actor('author'), reader=await actor('reader');
    const tag=await db.tag.findUniqueOrThrow({where:{slug:'work-break'}});
    expect((await app.inject('/api/tags')).json()).not.toContainEqual(expect.objectContaining({id:tag.id}));
    expect((await app.inject('/api/pulses/topics')).json()).toContainEqual(expect.objectContaining({id:tag.id,name:'上班摸鱼'}));
    const blocked=await app.inject({method:'POST',url:'/api/articles',headers:author.headers,payload:{title:'文章测试',bodyMarkdown:'正文',tagIds:[tag.id]}});
    expect(blocked.statusCode).toBe(400);
    expect(await db.article.count({where:{authorId:author.id}})).toBe(0);
    const input={body:'',images:['https://example.com/pulse.png'],tagId:tag.id};
    const create=(payload:typeof input)=>app.inject({method:'POST',url:'/api/pulses',headers:author.headers,payload});
    expect((await create({...input,images:[]})).statusCode).toBe(400);
    expect((await create({...input,images:['http://example.com/p.png']})).statusCode).toBe(400);
    const published=await create(input);
    expect(published.statusCode).toBe(201);
    const {id}=published.json();
    expect((await app.inject('/api/pulses?tab=following')).statusCode).toBe(401);
    await db.userFollow.create({data:{followerId:reader.id,followeeId:author.id}});
    const feed=await app.inject({url:'/api/pulses?tab=following&tagId='+tag.id,headers:reader.headers});
    expect(feed.json()).toEqual([expect.objectContaining({id,images:input.images,following:true,author:expect.objectContaining({displayName:'author',avatarUrl:null}),_count:{likes:0}})]);
    const like=()=>app.inject({method:'PUT',url:'/api/pulses/'+id+'/like',headers:reader.headers,payload:{active:true}});
    expect((await Promise.all([like(),like()])).map(item=>item.statusCode)).toEqual([200,200]);
    expect(await db.pulseLike.count({where:{pulseId:id}})).toBe(1);
    expect((await app.inject('/api/pulses/leaderboard')).json()).toContainEqual({id:author.id,displayName:'author',likes:1,pulses:1});
    const check=()=>app.inject({method:'POST',url:'/api/me/checkin',headers:reader.headers});
    expect((await Promise.all([check(),check()])).map(item=>item.json())).toEqual([{checked:true},{checked:true}]);
    expect(await db.checkin.count({where:{userId:reader.id}})).toBe(1);
  }finally{
    await db.pulse.deleteMany({where:{authorId:{in:ids}}});
    await db.user.deleteMany({where:{id:{in:ids}}});
    await app.close();await db.$disconnect();
  }
});
