import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { buildApp } from '../apps/api/app/app';
import { connectDatabase } from '../apps/api/shared/db';
import { digest, sessionName } from '../apps/api/shared/security';

const origin='http://127.0.0.1:5173';
const testUrl=process.env.TEST_DATABASE_URL;
if(!testUrl||!new URL(testUrl).pathname.endsWith('_test'))throw new Error('Use a dedicated TEST_DATABASE_URL ending in _test');

test('expert tasks enforce private claims, atomic submission and open-task visibility',async()=>{
  const db=connectDatabase(testUrl);
  const app=await buildApp(db,{origins:[origin]});
  const run=randomBytes(6).toString('hex');
  const users:string[]=[];
  const tasks:string[]=[];
  async function identity(suffix:string){
    const token=randomBytes(32).toString('hex');
    const user=await db.user.create({data:{username:'expert_'+run+suffix,displayName:suffix,passwordHash:'test-fixture',
      sessions:{create:{tokenHash:digest(token),expiresAt:new Date(Date.now()+60000)}}}});
    users.push(user.id);
    const cookie=sessionName+'='+token;
    const csrf=await app.inject({method:'GET',url:'/api/auth/csrf',headers:{cookie}});
    return {cookie:[cookie,...[csrf.headers['set-cookie']||[]].flat().map(value=>value.split(';')[0])].join('; '),origin,'x-csrf-token':csrf.json().csrfToken};
  }
  try{
    const owner=await identity('owner'),other=await identity('other');
    const task=await db.expertTask.create({data:{title:'标注验收 '+run,summary:'核对匿名开发建议',instructions:'检查文本是否包含依据，并说明理由。',isDemo:true}});
    tasks.push(task.id);
    const base='/api/expert/tasks/'+task.id;
    const claim=(headers=owner)=>app.inject({method:'POST',url:base+'/claim',headers});
    const submit=(response:string,headers=owner)=>app.inject({method:'POST',url:base+'/submit',headers,payload:{response}});
    expect((await app.inject({method:'GET',url:base})).json().isDemo).toBe(true);
    expect((await app.inject({method:'POST',url:base+'/claim',headers:{origin}})).statusCode).toBe(403);
    expect((await app.inject({method:'GET',url:'/api/me/expert/annotations'})).statusCode).toBe(401);
    expect((await submit('无领取记录',other)).statusCode).toBe(404);
    const claims=await Promise.all([claim(),claim()]);
    expect(claims.map(result=>result.statusCode)).toEqual([200,200]);
    expect(await db.expertAnnotation.count({where:{taskId:task.id}})).toBe(1);
    const own=await app.inject({method:'GET',url:'/api/me/expert/annotations',headers:owner});
    expect(own.headers['cache-control']).toBe('private, no-store');
    expect(own.json().items.map((row:{taskId:string})=>row.taskId)).toContain(task.id);
    expect((await app.inject({method:'GET',url:'/api/me/expert/annotations',headers:other})).json().items).toEqual([]);
    expect((await submit('  ')).statusCode).toBe(400);
    const submitted=await Promise.all([submit('建议包含操作步骤，可作为参考。'),submit('另一份结果')]);
    expect(submitted.map(result=>result.statusCode).sort()).toEqual([200,409]);
    expect((await claim()).json().status).toBe('SUBMITTED');
    const stored=await db.expertAnnotation.findUniqueOrThrow({where:{taskId_userId:{taskId:task.id,userId:users[0]}}});
    expect(stored.status).toBe('SUBMITTED');
    expect(stored.submittedAt).not.toBeNull();
    await expect(db.$executeRaw`UPDATE expert_annotations SET response=NULL WHERE task_id=${task.id}::uuid AND user_id=${users[0]}::uuid`).rejects.toThrow();
    await db.expertTask.update({where:{id:task.id},data:{status:'CLOSED'}});
    expect((await app.inject({method:'GET',url:base})).statusCode).toBe(404);
    expect((await claim(other)).statusCode).toBe(404);
    expect((await submit('关闭任务',other)).statusCode).toBe(404);
  }finally{
    await db.expertTask.deleteMany({where:{id:{in:tasks}}});
    await db.user.deleteMany({where:{id:{in:users}}});
    await app.close();await db.$disconnect();
  }
});
