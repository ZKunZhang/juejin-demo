import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import pg from 'pg';

const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:5173';
const database=new URL(process.env.DATABASE_URL);
assert(['127.0.0.1','localhost','[::1]'].includes(database.hostname) && /_(dev|test)$/.test(database.pathname));
const title='作品验收 '+randomUUID().slice(0,8);
const browser=await chromium.launch();
try {
  const author=await browser.newPage();
  const admin=await browser.newPage();
  const guest=await browser.newPage({viewport:{width:375,height:800}});
  async function login(page,path,username,password) {
    await page.goto(base+path);
    await page.getByLabel('用户名').fill(username);
    await page.getByLabel('密码',{exact:true}).fill(password);
    await page.getByRole('button',{name:'登录',exact:true}).click();
  }
  await login(author,'/login?next=/creator/projects','author_alpha',process.env.DEMO_ALPHA_PASSWORD);
  await expect(author.getByRole('heading',{name:'我的作品'})).toBeVisible();
  await author.getByRole('button',{name:'发布作品',exact:true}).click();
  await author.getByLabel('作品名称').fill(title);
  await author.getByLabel('作品简介').fill('浏览器端到端验收');
  await author.getByLabel('作品链接').fill('https://example.com');
  await author.getByLabel('作品介绍（Markdown）').fill('## 作品介绍');
  await author.getByRole('button',{name:'保存草稿'}).click();
  await expect(author.getByText('草稿已保存',{exact:true})).toBeVisible();
  await author.getByRole('button',{name:'提交审核'}).click();
  await expect(author.getByText('已提交，等待审核',{exact:true})).toBeVisible();

  await guest.goto(base+'/projects?q='+encodeURIComponent(title));
  await expect(guest.getByText(title,{exact:true})).toHaveCount(0);
  await login(admin,'/admin/login','admin_demo',process.env.DEMO_ADMIN_PASSWORD);
  await admin.getByRole('link',{name:'作品审核',exact:true}).click();
  const row=admin.getByRole('row').filter({hasText:title});
  await row.getByRole('button',{name:'审核作品'}).click();
  const dialog=admin.getByRole('dialog');
  await dialog.getByRole('button',{name:'审核通过'}).click();
  await expect(dialog).toBeHidden();
  await guest.reload();
  await guest.getByRole('link',{name:title,exact:true}).click();
  await expect(guest.getByRole('heading',{name:title,exact:true})).toBeVisible();
  assert(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await expect(guest.getByText('1 浏览',{exact:true})).toBeVisible();

  const detail=new URL(guest.url()).pathname;
  await author.goto(base+detail);
  await author.getByRole('button',{name:/^点赞/}).click();
  await expect(author.getByRole('button',{name:/取消点赞/})).toHaveAttribute('aria-pressed','true');
  await row.getByRole('button',{name:'管理作品'}).click();
  await dialog.getByLabel('处理原因').fill('浏览器验收下架');
  await dialog.getByRole('button',{name:'下架作品'}).click();
  await expect(admin.getByText('作品已下架',{exact:true})).toBeVisible();
  assert.equal((await guest.request.get(base+'/api'+detail)).status(),404);
  await row.getByRole('button',{name:'管理作品'}).click();
  await dialog.getByRole('button',{name:'上架作品'}).click();
  await expect(admin.getByText('作品已重新上架',{exact:true})).toBeVisible();
  assert.equal((await guest.request.get(base+'/api'+detail)).status(),200);
  await row.getByRole('button',{name:'管理作品'}).click();
  await dialog.getByRole('button',{name:'删除作品'}).click();
  await dialog.getByRole('button',{name:'取消删除'}).click();
  assert.equal((await guest.request.get(base+'/api'+detail)).status(),200);
  await dialog.getByRole('button',{name:'删除作品'}).click();
  await dialog.getByRole('button',{name:'确认删除'}).click();
  await expect(admin.getByText('作品已删除',{exact:true})).toBeVisible();
  assert.equal((await guest.request.get(base+'/api'+detail)).status(),404);
  await expect(row).toHaveCount(0);
  console.log('Project draft, approval, interactions, unlist, relist and confirmed deletion passed.');
} finally {
  await browser.close();
  const client=new pg.Client({connectionString:database.href});
  await client.connect();
  try { await client.query('delete from projects where title=$1',[title]); }
  finally { await client.end(); }
}
