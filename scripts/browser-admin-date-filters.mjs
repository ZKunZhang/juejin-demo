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
 const navigation=page.getByRole('navigation',{name:'管理导航'});
 await navigation.locator('.ant-menu-item-selected').getByRole('link',{name:'文章管理'}).waitFor();
 await navigation.getByRole('link',{name:'精选沸点'}).click();
 await page.waitForURL(base+'/admin/pulses/featured');
 await navigation.locator('.ant-menu-item-selected').getByRole('link',{name:'精选沸点'}).waitFor();
 await page.setViewportSize({width:375,height:800});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.setViewportSize({width:1440,height:900});
 await navigation.getByRole('link',{name:'评论管理'}).click();
 await page.waitForURL(base+'/admin/comments');

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
   const start=page.getByLabel('开始日期');
   const end=page.getByLabel('结束日期');
   await start.fill('1900-01-01');
   await start.press('Enter');
   await end.fill('1900-01-01');
   const applied=page.waitForResponse(response=>{
     const url=new URL(response.url());
     return url.pathname===path && url.searchParams.get('from')==='1900-01-01' && url.searchParams.get('to')==='1900-01-01';
   });
   await end.press('Enter');
   const result=await applied;
   assert.equal(result.status(),200,await result.text());
   assert.deepEqual((await result.json()).items,[]);
   await page.getByText(empty,{exact:true}).waitFor();
   const reset=page.waitForResponse(response=>new URL(response.url()).pathname===path&&!new URL(response.url()).searchParams.has('from'));
   await page.locator('.admin-date-range .ant-picker').hover();
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
   if(pagePath!=='/admin/comments'){
     const paging=page.getByRole('navigation',{name:'列表分页'});
     await paging.getByText('第 1 页',{exact:true}).waitFor();
     assert(await paging.getByRole('button',{name:'上一页'}).isDisabled());
   }
   await checkRange(path,empty);
 }
 const calendarStart=page.getByLabel('开始日期');
 await calendarStart.click();
 const calendar=page.locator('.ant-picker-dropdown:visible');
 const today=calendar.locator('.ant-picker-cell-today');
 const date=await today.getAttribute('title');
 assert.match(date,/^\d{4}-\d{2}-\d{2}$/);
 await today.click();
 const calendarApplied=page.waitForResponse(response=>{
   const url=new URL(response.url());
   return url.pathname==='/api/admin/activities' && url.searchParams.get('from')===date && url.searchParams.get('to')===date;
 });
 await calendar.locator(`[title="${date}"]`).click();
 assert.equal((await calendarApplied).status(),200);
 console.log('Admin navigation, first-page controls, calendar selection and five date filters passed');
}finally{await browser.close();}
