import { chromium } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';

const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:5173';
const title='活动验收 '+randomUUID().slice(0,8);
const browser=await chromium.launch();
try {
  const adminContext=await browser.newContext();
  const admin=await adminContext.newPage();
  const guest=await browser.newPage();
  await admin.goto(base+'/admin/activities/new');
  await admin.getByLabel('用户名').fill('admin_demo');
  await admin.getByLabel('密码',{exact:true}).fill(process.env.DEMO_ADMIN_PASSWORD);
  await admin.getByRole('button',{name:'登录',exact:true}).click();
  await admin.waitForURL(base+'/admin/articles');
  await admin.getByRole('link',{name:'活动管理',exact:true}).click();
  await admin.getByRole('link',{name:'新建活动',exact:true}).click();
  await admin.getByLabel('活动标题').fill(title);
  await admin.getByLabel('活动摘要').fill('通过后台创建和发布');
  await admin.getByRole('button',{name:'保存活动'}).click();
  await admin.waitForURL(/\/admin\/activities\/[a-f0-9-]{36}$/);
  await guest.goto(base+'/');
  assert(!(await (await guest.request.get(base+'/api/activities')).json()).some(row=>row.title===title));
  const stale=await adminContext.newPage();
  await stale.goto(admin.url());
  await stale.getByLabel('活动标题').waitFor();
  await admin.getByLabel('发布状态').selectOption('PUBLISHED');
  await admin.getByRole('button',{name:'保存活动'}).click();
  await admin.getByText('活动已保存',{exact:true}).waitFor();
  await guest.reload();
  await guest.getByText(title,{exact:true}).waitFor();
  await stale.getByRole('button',{name:'保存活动'}).click();
  await stale.getByRole('button',{name:'放弃当前修改并加载最新版本'}).click();
  await stale.waitForFunction(()=>document.querySelector('#activity-status')?.value==='PUBLISHED');
  await admin.getByLabel('发布状态').selectOption('UNLISTED');
  await admin.getByRole('button',{name:'保存活动'}).click();
  await admin.getByText('活动已保存',{exact:true}).waitFor();
  await guest.reload();
  assert(!(await (await guest.request.get(base+'/api/activities')).json()).some(row=>row.title===title));
  console.log('Playwright: admin configured, published and unlisted an activity; public homepage visibility passed.');
} finally {
  await browser.close();
  const client=new pg.Client({connectionString:process.env.DATABASE_URL});
  await client.connect();
  try {await client.query('DELETE FROM activities WHERE title=$1',[title]);}
  finally{await client.end();}
}
