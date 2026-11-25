import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:5173';
const url=new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
if(!url.pathname.endsWith('_test'))throw new Error('A dedicated database ending in _test is required');
const db=new pg.Client({connectionString:url.href});
const id=randomUUID(), article=randomUUID(), pulse=randomUUID();
const name='关注自测 '+id.slice(0,8), title='文章 '+name, body='沸点 '+name;
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||undefined});
try{
 await db.connect();
 await db.query('INSERT INTO users(id,username,display_name,password_hash,updated_at) VALUES ($1,$2,$3,$4,now())',[id,'follow_'+id.slice(0,8),name,'fixture']);
 await db.query("INSERT INTO articles(id,author_id,title,body_markdown,status,review_status,published_at,updated_at) VALUES ($1,$2,$3,'关注测试','PUBLISHED','APPROVED',now(),now())",[article,id,title]);
 await db.query("INSERT INTO pulses(id,author_id,body,status) VALUES ($1,$2,$3,'PUBLISHED')",[pulse,id,body]);
 async function login(username,key){
  const page=await browser.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(base+'/login?next=/pulses');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码',{exact:true}).fill(process.env[key]);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.waitForURL(base+'/pulses');
  return page;
 }
 const beta=await login('reader_beta','DEMO_BETA_PASSWORD');
 const gamma=await login('reader_gamma','DEMO_GAMMA_PASSWORD');
 const followTab=beta.getByRole('button',{name:'关注',exact:true});
 const card=beta.locator('.pulse-card').filter({hasText:body});
 const initialFeed=beta.waitForResponse(response=>response.url().includes('/api/pulses?tab=following'));
 await followTab.click();
 assert(!(await (await initialFeed).json()).some(row=>row.id===pulse));
 await expect(beta.locator('nav[aria-label="沸点排序"] button[aria-pressed=true]')).toHaveText('关注');
 await beta.getByRole('link',{name:'文章',exact:true}).click();
 await beta.getByRole('link',{name:title,exact:true}).click();
 await beta.getByRole('button',{name:'关注作者',exact:true}).click();
 await expect(beta.getByRole('button',{name:'取消关注',exact:true})).toBeVisible();
 await beta.getByRole('link',{name:'沸点',exact:true}).click();
 await followTab.click();
 await expect(card).toBeVisible({timeout:3500});
 await expect(card.getByRole('button',{name:'取消关注',exact:true})).toBeVisible();
 await beta.reload();
 await expect(card).toBeVisible();
 const list=await beta.request.get(base+'/api/me/following');
 assert((await list.json()).some(row=>row.id===id));
 const other=await gamma.request.get(base+'/api/me/following');
 assert(!(await other.json()).some(row=>row.id===id));
 await beta.goto(base+'/me/following');
 await expect(beta.getByText(name,{exact:false}).first()).toBeVisible();
 await beta.getByRole('link',{name:'文章',exact:true}).click();
 await beta.getByRole('link',{name:title,exact:true}).click();
 await expect(beta.getByRole('button',{name:'取消关注',exact:true})).toBeVisible();
 await beta.getByRole('link',{name:'沸点',exact:true}).click();
 await followTab.click();
 await card.getByRole('button',{name:'取消关注',exact:true}).click();
 await expect(card).toHaveCount(0);
 await beta.getByRole('link',{name:'文章',exact:true}).click();
 await beta.getByRole('link',{name:title,exact:true}).click();
 await expect(beta.getByRole('button',{name:'关注作者',exact:true})).toBeVisible({timeout:3500});
 const stored=await db.query('SELECT 1 FROM user_follows WHERE followee_id=$1',[id]);
 assert.equal(stored.rowCount,0);
 const csrf=await beta.request.get(base+'/api/auth/csrf');
 const me=await (await beta.request.get(base+'/api/auth/me')).json();
 const self=await beta.request.put(base+'/api/users/'+me.id+'/follow',{
   headers:{origin:base,'x-csrf-token':(await csrf.json()).csrfToken},data:{active:true},
 });
 assert.equal(self.status(),400);
 console.log('关注、关注流、个人关注列表、刷新、跨账号隔离、取消与自关注校验已通过');
}finally{
 await browser.close();
 await db.query('DELETE FROM articles WHERE id=$1',[article]);
 await db.query('DELETE FROM pulses WHERE id=$1',[pulse]);
 await db.query('DELETE FROM users WHERE id=$1',[id]);
 await db.end();
}
