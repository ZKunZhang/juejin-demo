import { chromium, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';

const base = process.env.BROWSER_BASE_URL || 'http://127.0.0.1:5173';
const username = 'browser_' + randomBytes(6).toString('hex');
const password = randomBytes(16).toString('base64url');
const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.goto(base + '/?q=测试');
  const login = page.getByRole('link', { name: '登录', exact: true });
  const dialog = page.getByRole('dialog');
  await login.click();
  await expect(dialog.getByLabel('用户名')).toBeFocused();
  await dialog.getByRole('link', { name: '去注册' }).click();
  await expect(dialog.getByLabel('昵称')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('searchbox')).toHaveValue('测试');
  await expect(login).toBeFocused();
  await page.goto(base + '/register');
  await expect(dialog).toBeVisible();
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('昵称').fill('浏览器验收');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.waitForURL(base + '/');
  await page.getByText('浏览器验收', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('浏览器验收', { exact: true }).waitFor();
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await page.getByRole('link', { name: '登录', exact: true }).click();
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL(base + '/');
  await page.getByText('浏览器验收', { exact: true }).waitFor();
  for (const width of [1440,1024,768,390,320]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), 'Home overflow at '+width);
    await page.goto(base + '/register');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), 'Register overflow at '+width);
    await page.goto(base + '/');
  }
  console.log('Browser auth flow and five viewports passed');
} finally {
  await browser.close();
  const db = new pg.Client({connectionString:process.env.DATABASE_URL});
  await db.connect();
  try { await db.query('DELETE FROM users WHERE username = $1',[username]); }
  finally { await db.end(); }
}
