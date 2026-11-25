import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:5173';
const browser=await chromium.launch();
try {
  const page=await browser.newPage();
  await page.goto(base+'/courses');
  await page.getByLabel('分类').selectOption({label:'前端'});
  await page.getByLabel('难度').selectOption({label:'进阶'});
  const selected=page.getByRole('link',{name:'React 前端工程实践'});
  await selected.waitFor();
  await page.waitForURL(/categoryId=.*level=ADVANCED/);
  await page.reload();
  await selected.waitFor();
  await selected.click();
  await page.getByRole('heading',{name:'学习方式'}).waitFor();
  await page.getByRole('button',{name:'目录'}).click();
  await page.getByRole('link',{name:'接通接口与缓存'}).click();
  await page.getByRole('heading',{name:'接通接口与缓存',level:1}).waitFor();
  await page.getByRole('link',{name:'返回《React 前端工程实践》目录'}).click();
  await page.getByRole('heading',{name:'推荐小册'}).waitFor();
  assert.match(await page.url(),/tab=directory/);
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  console.log('Playwright course filters, detail, directory, chapters and responsive layouts passed.');
}finally{await browser.close();}
