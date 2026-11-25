import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from '@playwright/test';
import pg from 'pg';

const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:5173';
const articleId=randomUUID(),pulseId=randomUUID();
const articleTitle='通知验收文章 '+articleId.slice(0,8),pulseTitle='通知验收沸点 '+pulseId.slice(0,8);
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
const browser=await chromium.launch();
await db.connect();
let createdFollow=false;
let authorId,readerId;
async function login(username,password,path='/login') {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto(base+path);
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码',{exact:true}).fill(password);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.waitForURL(path.startsWith('/admin')?base+'/admin/articles':base+'/');
  return page;
}
async function publish(page,path,method,payload) {
  const csrf=await page.request.get(base+'/api/auth/csrf');
  const response=await page.request.fetch(base+path,{method,data:payload,headers:{origin:base,'x-csrf-token':(await csrf.json()).csrfToken}});
  assert.equal(response.status(),200,await response.text());
}
try{
  const people=(await db.query('SELECT id,username FROM users WHERE username=ANY($1)',[['author_alpha','reader_beta']])).rows;
  authorId=people.find(row=>row.username==='author_alpha')?.id;
  readerId=people.find(row=>row.username==='reader_beta')?.id;
  assert(authorId && readerId,'Demo author and reader required');
  createdFollow=(await db.query('INSERT INTO user_follows(follower_id,followee_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[readerId,authorId])).rowCount===1;
  await db.query("INSERT INTO articles(id,author_id,title,body_markdown,review_status,updated_at) VALUES($1,$2,$3,'通知验收正文','PENDING',now())",[articleId,authorId,articleTitle]);
  await db.query("INSERT INTO pulses(id,author_id,body,status) VALUES($1,$2,$3,'PENDING')",[pulseId,authorId,pulseTitle]);

  const reader=await login('reader_beta',process.env.DEMO_BETA_PASSWORD);
  const initial=(await (await reader.request.get(base+'/api/me/notifications/unread')).json()).count;
  const bell=reader.locator('.notification-bell');
  await bell.waitFor();
  const admin=await login('admin_demo',process.env.DEMO_ADMIN_PASSWORD,'/admin/login');
  await publish(admin,'/api/admin/articles/'+articleId+'/review','POST',{version:1,action:'APPROVE'});
  await publish(admin,'/api/admin/pulses/'+pulseId+'/status','PATCH',{expectedStatus:'PENDING',status:'PUBLISHED'});
  await reader.waitForFunction(count=>document.querySelector('.notification-bell')?.getAttribute('aria-label')==='通知，'+count+' 条未读',initial+2,{timeout:22000});
  await bell.click();
  await reader.getByRole('navigation',{name:'通知分类'}).getByRole('link',{name:/沸点发布/}).click();
  await reader.waitForURL(/kind=PULSE_PUBLISHED/);
  assert.equal(await reader.getByText(articleTitle,{exact:true}).count(),0);
  await reader.getByRole('button',{name:new RegExp(pulseTitle)}).click();
  await reader.waitForURL(base+'/pulses/'+pulseId);
  await reader.getByText(pulseTitle,{exact:true}).waitFor();
  assert.equal((await (await reader.request.get(base+'/api/me/notifications/unread')).json()).count,initial+1);

  await reader.goto(base+'/notifications?kind=ARTICLE_PUBLISHED');
  await reader.getByRole('button',{name:new RegExp(articleTitle)}).click();
  await reader.waitForURL(base+'/articles/'+articleId);
  assert.equal((await (await reader.request.get(base+'/api/me/notifications/unread')).json()).count,initial);
  await reader.goto(base+'/notifications');
  await reader.getByRole('heading',{name:'通知',exact:true}).waitFor();
  for(const width of [1440,768,390,320]){
    await reader.setViewportSize({width,height:800});
    assert(await reader.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),String(width));
  }
  console.log('Notification bell polling, category menu, article/pulse navigation and read state passed.');
}finally{
  await browser.close();
  try {
    await db.query('DELETE FROM notifications WHERE target_id=ANY($1::uuid[])',[[articleId,pulseId]]);
    await db.query('DELETE FROM article_review_logs WHERE article_id=$1',[articleId]);
    await db.query('DELETE FROM articles WHERE id=$1',[articleId]);
    await db.query('DELETE FROM pulses WHERE id=$1',[pulseId]);
    if(createdFollow)await db.query('DELETE FROM user_follows WHERE follower_id=$1 AND followee_id=$2',[readerId,authorId]);
  }finally{await db.end();}
}
