import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const base = process.env.BROWSER_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  await page.goto(base);
  const primary = page.getByRole('navigation', { name: '主导航' });
  await expect(primary.getByRole('link', { name: 'APP', exact: true })).toHaveAttribute('href', 'https://juejin.cn/download#feature');
  await primary.getByRole('link', { name: 'AI 用量', exact: true }).click();
  const workspace = page.getByRole('navigation', { name: 'AI 用量导航' });
  await expect(workspace.getByRole('link', { name: '用量', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: '近 7 天' }).click();
  await expect(page).toHaveURL(base + '/ai-usage?period=7d');
  await page.reload();
  await expect(page.getByRole('button', { name: '近 7 天' })).toHaveAttribute('aria-pressed', 'true');
  await workspace.getByRole('link', { name: '排行榜' }).click();
  await expect(page.getByRole('heading', { name: '用户排行榜' })).toBeVisible();
  await workspace.getByRole('link', { name: '模型价格' }).click();
  await expect(page.getByRole('heading', { name: '模型价格' })).toBeVisible();

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
