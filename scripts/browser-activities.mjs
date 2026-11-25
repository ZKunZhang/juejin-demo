import { chromium, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';

const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:5173';
const title='活动验收 '+randomUUID().slice(0,8);
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||undefined});
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
  for (const label of ['活动标题','活动摘要','活动链接','活动封面（HTTPS 图片地址）','展示顺序（由小到大）','展示开始（本地时间）','展示结束（本地时间）']) {
    await expect(admin.getByLabel(label)).toHaveClass(/\bant-input\b/);
  }
  await admin.getByLabel('活动标题').fill(title);
  await admin.getByLabel('活动摘要').fill('通过后台创建和发布');
  const preview=admin.getByRole('complementary',{name:'卡片预览'});
  await expect(preview.getByRole('heading',{name:title,exact:true})).toBeVisible();
  await expect(preview.getByText('通过后台创建和发布',{exact:true})).toBeVisible();
  const coverField=admin.getByLabel('活动封面（HTTPS 图片地址）');
  await coverField.fill('http://example.test/cover.png');
  await expect(preview.getByText('请输入有效的 HTTPS 图片地址')).toBeVisible();
  await admin.route('https://example.test/cover.png',route=>route.fulfill({
    contentType:'image/png',
    body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6WQAAAAASUVORK5CYII=','base64'),
  }));
  await coverField.fill('https://example.test/cover.png');
  await expect.poll(()=>preview.getByRole('img',{name:'活动封面预览'}).evaluate(img=>img.naturalWidth).catch(()=>0)).toBe(1);
  await coverField.clear();
  await expect(preview.getByText('未设置封面')).toBeVisible();
  await admin.setViewportSize({width:390,height:844});
  assert(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await admin.setViewportSize({width:1280,height:800});
  await admin.getByRole('button',{name:'保存活动'}).click();
  await admin.waitForURL(/\/admin\/activities\/[a-f0-9-]{36}$/);
  await guest.goto(base+'/');
  assert(!(await (await guest.request.get(base+'/api/activities')).json()).some(row=>row.title===title));
  const stale=await adminContext.newPage();
  await stale.goto(admin.url());
  await stale.getByLabel('活动标题').waitFor();
  await admin.getByRole('combobox', {name:'发布状态'}).click();
  await admin.getByRole('option', {name:'已发布',exact:true}).click();
  await expect(preview.getByText('已发布',{exact:true})).toBeVisible();
  await admin.getByRole('button',{name:'保存活动'}).click();
  await admin.getByText('活动已保存',{exact:true}).waitFor();
  await guest.reload();
  await guest.getByText(title,{exact:true}).waitFor();
  await stale.getByRole('button',{name:'保存活动'}).click();
  await stale.getByRole('button',{name:'放弃当前修改并加载最新版本'}).click();
  await expect(stale.locator('.app-select')).toContainText('已发布');
  await admin.getByRole('combobox', {name:'发布状态'}).click();
  await admin.getByRole('option', {name:'已下架',exact:true}).click();
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
