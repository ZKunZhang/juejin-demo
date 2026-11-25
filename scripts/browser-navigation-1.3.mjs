import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const base = process.env.BROWSER_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  await page.goto(base);
  const primary = page.getByRole('navigation', { name: '主导航' });
  await primary.getByRole('link', { name: 'APP', exact: true }).click();
  await expect(page).toHaveURL(base + '/download#feature');
  await expect(page.getByRole('heading', { name: '码栈客户端' })).toBeVisible();
  await page.getByRole('button', { name: 'APP', exact: true }).click();
  await expect(page.getByRole('heading', { name: '随时打开码栈' })).toBeVisible();
  await page.getByText('现在如何使用码栈？', {exact:true}).click();
  await expect(page.getByText('在手机或电脑的浏览器里打开码栈网页版即可使用。')).toBeVisible();
  await page.getByRole('link', {name:'打开码栈网页版'}).click();
  await expect(page).toHaveURL(base + '/');
  await primary.getByRole('link', { name: 'AI 用量', exact: true }).click();
  const workspace = page.getByRole('navigation', { name: 'AI 用量导航' });
  await expect(workspace.getByRole('link', { name: '用量', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('main').getByRole('link', { name: '登录', exact: true }).click();
  await page.getByLabel('用户名').fill('reader_beta');
  await page.getByLabel('密码', { exact:true }).fill(process.env.DEMO_BETA_PASSWORD);
  await page.getByRole('button', { name:'登录', exact:true }).click();
  await expect(page.getByRole('heading', { name:'每日用量' })).toBeVisible();
  await page.getByRole('button', { name: '近 7 天' }).click();
  await expect(page).toHaveURL(base + '/ai-usage?period=7d');
  await page.reload();
  await expect(page.getByRole('button', { name: '近 7 天' })).toHaveAttribute('aria-pressed', 'true');
  await workspace.getByRole('link', { name: '排行榜' }).click();
  await expect(page.getByRole('heading', { name: '用户排行榜' })).toBeVisible();
  await workspace.getByRole('link', { name: '模型价格' }).click();
  await expect(page.getByRole('heading', { name: '模型价格' })).toBeVisible();
  await expect(page.getByRole('table', { name:'模型价格列表' }).getByText('编程模型（演示）',{exact:true})).toBeVisible();
  await primary.getByRole('link',{ name:'专家标注',exact:true }).click();
  await expect(page.getByRole('heading',{name:'文章摘要质量标注'})).toBeVisible();
  await expect(page.getByRole('button',{name:'领取任务'}).first()).toBeVisible();

  for (const width of [1280, 1051, 1050, 768, 375]) {
    await page.setViewportSize({ width, height: 850 });
    for (const [link, route] of [['作品广场', '/projects'], ['专家标注', '/expert-annotation'], ['AI 用量', '/ai-usage']]) {
      await primary.getByRole('link', { name: link, exact: true }).click();
      await expect(page).toHaveURL(base + route);
      await expect(page.getByRole('heading', { name: link, exact: true })).toBeVisible();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route + ' at ' + width);
    }
  }
  console.log('v1.3 navigation, usage views, period state and responsive layouts passed.');
} finally {
  await browser.close();
}
