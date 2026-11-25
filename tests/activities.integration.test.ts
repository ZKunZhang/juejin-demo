import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { buildApp } from '../apps/api/app';
import { connectDatabase } from '../apps/api/db';
import { digest, sessionName } from '../apps/api/security';

const origin='http://127.0.0.1:5173';
const testUrl=process.env.TEST_DATABASE_URL;
if(!testUrl||!new URL(testUrl).pathname.endsWith('_test'))throw new Error('A dedicated TEST_DATABASE_URL ending in _test is required');

test('activity roles, schedule, sorting, validation and stale writes against PostgreSQL', async()=>{
  const db=connectDatabase(testUrl);
  const app=await buildApp(db,{origins:[origin]});
  const key=randomBytes(6).toString('hex');
  const userIds:string[]=[];
  const adminPath='/api/admin/activities';
  async function identity(role:'ADMIN'|'USER') {
    const raw=randomBytes(32).toString('hex');
    const actor=await db.user.create({data:{username:'activity_'+key+'_'+role.toLowerCase(),displayName:role,passwordHash:'test-fixture',role,
      sessions:{create:{tokenHash:digest(raw),expiresAt:new Date(Date.now()+60_000)}}}});
    userIds.push(actor.id);
    const cookie=sessionName+'='+raw;
    const csrf=await app.inject({method:'GET',url:'/api/auth/csrf',headers:{cookie}});
    const values=[csrf.headers['set-cookie']||[]].flat();
    return {cookie:[cookie,...values.map(value=>value.split(';')[0])].join('; '),origin,'x-csrf-token':csrf.json().csrfToken};
  }
  async function publicRows() {
    const result=await app.inject({method:'GET',url:'/api/activities'});
    expect(result.statusCode).toBe(200);
    return result.json() as {id:string;title:string;summary:string;url:string|null}[];
  }
  try {
    const admin=await identity('ADMIN'), user=await identity('USER');
    const input={title:'活动测试 '+key,summary:'活动摘要',url:null,coverUrl:'https://example.com/event.png',status:'DRAFT',sortOrder:0,visibleFrom:null,visibleTo:null};
    const post=(payload:unknown,headers=admin)=>app.inject({method:'POST',url:adminPath,headers,payload:payload as object});
    expect((await app.inject({method:'GET',url:adminPath})).statusCode).toBe(401);
    expect((await post(input,user)).statusCode).toBe(403);
    expect((await post({...input,coverUrl:'http://example.com/img.png'})).statusCode).toBe(400);
    expect((await post({...input,url:'javascript:alert(1)'})).statusCode).toBe(400);
    expect((await post({...input,visibleFrom:'2030-02-01T00:00:00Z',visibleTo:'2030-01-01T00:00:00Z'})).statusCode).toBe(400);
    const created=await post(input);
    expect(created.statusCode).toBe(201);
    const {id,version}=created.json();
    expect((await app.inject({method:'GET',url:adminPath+'/'+id,headers:user})).statusCode).toBe(403);
    expect((await app.inject({method:'PATCH',url:adminPath+'/'+id,headers:user,payload:{...input,version}})).statusCode).toBe(403);
    const {cookie}=admin;
    expect((await app.inject({method:'PATCH',url:adminPath+'/'+id,headers:{cookie,origin},payload:{...input,version}})).statusCode).toBe(403);
    expect((await publicRows()).some(row=>row.id===id)).toBe(false);
    const update=(payload:unknown)=>app.inject({method:'PATCH',url:adminPath+'/'+id,headers:admin,payload:payload as object});
    const published=await update({...input,status:'PUBLISHED',version});
    expect(published.statusCode).toBe(200);
    expect((await update({...input,status:'UNLISTED',version})).statusCode).toBe(409);
    const other=await post({...input,title:'较后活动',status:'PUBLISHED',sortOrder:5});
    const future=await post({...input,title:'未来活动',status:'PUBLISHED',visibleFrom:new Date(Date.now()+86400000).toISOString()});
    const past=await post({...input,title:'过期活动',status:'PUBLISHED',visibleTo:new Date(Date.now()-86400000).toISOString()});
    expect([other.statusCode,future.statusCode,past.statusCode]).toEqual([201,201,201]);
    const rows=(await publicRows()).filter(row=>[id,other.json().id,future.json().id,past.json().id].includes(row.id));
    expect(rows.map(row=>row.id)).toEqual([id,other.json().id]);
    expect(rows[0]).toHaveProperty('coverUrl',input.coverUrl);
    expect(Object.keys(rows[0]).sort()).toEqual(['coverUrl','id','summary','title','url']);
    expect((await update({...input,status:'UNLISTED',version:published.json().version})).statusCode).toBe(200);
    expect((await publicRows()).some(row=>row.id===id)).toBe(false);
  } finally {
    await db.activity.deleteMany({where:{editorId:{in:userIds}}});
    await db.user.deleteMany({where:{id:{in:userIds}}});
    await app.close();
    await db.$disconnect();
  }
});
