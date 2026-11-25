import { chromium } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';

const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:5173';
const username='pulse_browser_'+randomBytes(6).toString('hex');
const name='沸点浏览器 '+Date.now();
const browser=await chromium.launch();
try {
  const page=await browser.newPage();
  await page.goto(base+'/register?next=/pulses');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('昵称').fill(name);
  await page.getByLabel('密码',{exact:true}).fill(randomBytes(12).toString('hex'));
  await page.getByRole('button',{name:'注册',exact:true}).click();
  await page.waitForURL(base+'/pulses');
  await page.getByLabel('分享动态').fill(name);
  await page.getByLabel('图片地址').fill('https://example.com/image.png');
  await page.getByRole('button',{name:'发布沸点',exact:true}).click();
  const item=page.locator('.pulse-card').filter({hasText:name});
  await item.getByRole('img').waitFor();
  await item.getByRole('button',{name:'点赞 · 0',exact:true}).click();
  await item.getByRole('button',{name:'取消点赞 · 1',exact:true}).waitFor();
  await page.getByRole('button',{name:'今日签到',exact:true}).click();
  await page.getByRole('button',{name:'今日已签到',exact:true}).waitFor();
  await page.reload();
  await item.getByRole('button',{name:'取消点赞 · 1',exact:true}).waitFor();
  await page.getByRole('button',{name:'今日已签到',exact:true}).waitFor();
  await page.setViewportSize({width:320,height:720});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log('Playwright pulse publish, image markup, likes, check-in and narrow layout passed.');
} finally {
  await browser.close();
  const db=new pg.Client({connectionString:process.env.DATABASE_URL});
  await db.connect();
  try {
    await db.query('DELETE FROM pulses WHERE author_id=(SELECT id FROM users WHERE username=$1)',[username]);
    await db.query('DELETE FROM users WHERE username=$1',[username]);
  }finally{await db.end();}
}
