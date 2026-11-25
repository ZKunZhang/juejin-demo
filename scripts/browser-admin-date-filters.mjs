import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:5175';
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+'/admin/login');
 await page.getByLabel('用户名').fill('admin_demo');
 await page.getByLabel('密码',{exact:true}).fill(process.env.DEMO_ADMIN_PASSWORD);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/admin/articles');
 await page.goto(base+'/admin/comments');

 async function chooseSource(label,path,param,kind) {
   const response=await page.request.get(base+path+'/sources');
   assert.equal(response.status(),200);
   const [source]=await response.json();
   assert(source,kind+' demo comments required');
   await page.getByRole('combobox',{name:label,exact:true}).click();
   const request=page.waitForResponse(response=>new URL(response.url()).pathname===path&&new URL(response.url()).searchParams.get(param)===source.id);
   await page.getByRole('option',{name:source.label,exact:true}).first().click();
   assert.equal((await request).status(),200);
 }
 await chooseSource('文章来源','/api/admin/comments','articleId','Article');
 await page.getByRole('combobox',{name:'内容类型',exact:true}).click();
 await page.getByRole('option',{name:'沸点',exact:true}).click();
 await page.waitForURL(/comments\?type=pulse/);
 await chooseSource('沸点来源','/api/admin/pulse-comments','pulseId','Pulse');

 async function checkRange(path,empty) {
   await page.getByLabel('开始日期').fill('1900-01-01');
   await page.getByLabel('结束日期').fill('1900-01-01');
   const applied=page.waitForResponse(response=>new URL(response.url()).pathname===path&&new URL(response.url()).searchParams.has('from'));
   await page.getByRole('button',{name:'按日期筛选'}).click();
   const result=await applied;
   assert.equal(result.status(),200,await result.text());
   assert.deepEqual((await result.json()).items,[]);
   await page.getByText(empty,{exact:true}).waitFor();
   const reset=page.waitForResponse(response=>new URL(response.url()).pathname===path&&!new URL(response.url()).searchParams.has('from'));
   await page.getByRole('button',{name:'清除日期'}).click();
   assert.equal((await reset).status(),200);
 }
 await checkRange('/api/admin/pulse-comments','没有匹配的沸点评论');
 for(const [pagePath,path,empty] of [
   ['/admin/comments','/api/admin/comments','没有匹配的文章评论'],
   ['/admin/pulses','/api/admin/pulses','没有匹配的沸点'],
   ['/admin/articles','/api/admin/articles','没有匹配的文章'],
   ['/admin/activities','/api/admin/activities','没有匹配的活动'],
 ]){
   await page.goto(base+pagePath);
   await checkRange(path,empty);
 }
 console.log('Five admin date filters and linked comment source dropdowns passed on 5175');
}finally{await browser.close();}
