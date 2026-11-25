import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chromium } from '@playwright/test';
import pg from 'pg';

const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:5173';
const title='创作者验收 '+randomBytes(5).toString('hex');
const browser=await chromium.launch();
let articleId;
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto(base+'/');
  assert.equal((await page.request.get(base+'/api/me/creator')).status(),401);
  await page.getByRole('link',{name:'创作者中心',exact:true}).click();
  await page.getByLabel('用户名').fill('author_alpha');
  await page.getByLabel('密码',{exact:true}).fill(process.env.DEMO_ALPHA_PASSWORD);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.waitForURL(base+'/creator');
  await page.getByText('数据概览',{exact:true}).waitFor();
  const overview=await page.request.get(base+'/api/me/creator');
  assert.equal(overview.status(),200);
  assert.equal(typeof (await overview.json()).stats.views,'number');
  await page.getByRole('button',{name:'沸点',exact:true}).click();
  await page.getByText(/Markdown 里可能有两个同名标题/).waitFor();
  await page.getByLabel('创作快捷入口').click();
  await page.locator('.creator-menu-panel').getByRole('link',{name:'写文章'}).click();
  await page.getByRole('heading',{name:'写文章',exact:true}).waitFor();
  await page.getByRole('textbox',{name:'标题',exact:true}).fill(title);
  const body=page.getByLabel('Markdown 正文');
  await body.fill('实时预览');
  await body.evaluate(input=>input.setSelectionRange(0,input.value.length));
  await page.getByRole('button',{name:'粗体'}).click();
  await page.locator('.creator-preview-pane strong').getByText('实时预览',{exact:true}).waitFor();
  await page.getByRole('button',{name:'保存草稿'}).click();
  await page.waitForURL(/\/creator\/articles\/.+\/edit/);
  articleId=new URL(page.url()).pathname.split('/').at(-2);
  await page.reload();
  assert.equal(await body.inputValue(),'**实时预览**');
  await page.getByRole('link',{name:'草稿箱',exact:true}).click();
  await page.getByRole('heading',{name:'草稿箱',exact:true}).waitFor();
  await page.getByRole('link',{name:title,exact:true}).click();
  await page.getByRole('button',{name:'提交审核',exact:true}).click();
  await page.getByText(/待审核 · 版本/).waitFor();
  assert.equal((await page.request.get(base+'/api/articles/'+articleId)).status(),404);
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),String(width));
  }
  await page.getByLabel('创作快捷入口').click();
  await page.locator('.creator-menu-panel').getByRole('link',{name:'发沸点'}).click();
  await page.waitForURL(base+'/pulses#publish');
  await page.waitForFunction(()=>document.activeElement?.id==='pulse-body');
  await page.getByLabel('分享动态').fill(title);
  const pulseResponse=page.waitForResponse(response=>response.url()===base+'/api/pulses'&&response.request().method()==='POST');
  await page.getByRole('button',{name:/^(提交审核|发布沸点)$/}).click();
  assert.equal((await pulseResponse).status(),201);
  console.log('Creator menu, account dashboard, live Markdown, draft reload, private review and pulse entry passed.');
} finally {
  await browser.close();
  const db=new pg.Client({connectionString:process.env.DATABASE_URL});
  await db.connect();
  try {
    await db.query('DELETE FROM article_review_logs WHERE article_id IN (SELECT id FROM articles WHERE title=$1)',[title]);
    await db.query('DELETE FROM articles WHERE title=$1',[title]);
    await db.query('DELETE FROM pulses WHERE body=$1',[title]);
  }finally{await db.end();}
}
