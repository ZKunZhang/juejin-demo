import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const base = process.env.BROWSER_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 850 } });
  const data = await page.request.get(base + '/api/articles?tab=recommended');
  assert.equal(data.status(), 200);
  const [article] = (await data.json()).items;
  assert(article?.title, '搜索验收需要一篇已发布文章');
  const keyword = Array.from(article.title.trim()).slice(0, 6).join('');
  await page.goto(base);
  const input = page.getByRole('searchbox', { name: '搜索文章' });
  await input.fill(keyword);
  const suggestions = page.getByRole('list', { name: '文章搜索建议' });
  await expect(suggestions.locator('mark').first()).toHaveText(keyword, { ignoreCase: true });
  await input.press('Escape');
  await expect(suggestions).toBeHidden();
  await input.press('Enter');
  await expect(page.getByRole('heading', { name: /搜索结果/ })).toContainText(keyword);
  const results = page.getByRole('region', { name: '文章结果' });
  await expect(results.locator('h2 mark').first()).toHaveText(keyword, { ignoreCase: true });
  const sort = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/articles' && url.searchParams.get('tab') === 'latest' && url.searchParams.get('q') === keyword;
  });
  await page.getByRole('button', { name: '最新优先' }).click();
  assert.equal((await sort).status(), 200);
  await expect(page.getByRole('button', { name: '最新优先' })).toHaveAttribute('aria-pressed', 'true');
  const tags = await page.request.get(base + '/api/tags');
  assert.equal(tags.status(), 200);
  const [tag] = await tags.json();
  assert(tag?.name, '搜索验收需要一个文章标签');
  await input.fill(tag.name);
  await input.press('Enter');
  await page.getByRole('button', { name: '标签', exact: true }).click();
  const tagResult = page.getByRole('region', { name: '标签结果' }).getByRole('button', { name: tag.name, exact: true });
  await expect(tagResult).toBeVisible();
  await tagResult.click();
  await expect(page.getByRole('button', { name: tag.name, exact: true }).first()).toHaveAttribute('aria-pressed','true');
  await page.setViewportSize({ width: 375, height: 800 });
  await input.fill(keyword);
  await expect(suggestions).toBeVisible();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await suggestions.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/articles\/[a-f0-9-]+$/);
  console.log('Search suggestions, article and tag results, sorting, and mobile layout passed.');
} finally {
  await browser.close();
}
