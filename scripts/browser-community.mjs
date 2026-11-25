import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:5173';
const browser=await chromium.launch();
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
await db.connect();
const title='审核验收 '+randomUUID().slice(0,8);
let articleId;
const demoUsers=await db.query("SELECT id,username FROM users WHERE username IN ('author_alpha','reader_beta','reader_gamma')");
const ids=Object.fromEntries(demoUsers.rows.map(user=>[user.username,user.id]));
const followBefore=await db.query('SELECT follower_id,followee_id,created_at FROM user_follows WHERE followee_id=$1 AND follower_id IN ($2,$3)',[ids.author_alpha,ids.reader_beta,ids.reader_gamma]);
async function login(username,password,path='/login'){
  const page=await browser.newPage();
  await page.goto(base+path);
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码',{exact:true}).fill(password);
  const loginResponse=page.waitForResponse(response=>response.url().endsWith('/api/auth/login')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'登录',exact:true}).click();
  assert.equal((await loginResponse).status(),200);
  await page.waitForURL(path.startsWith('/admin') ? base+'/admin/articles' : base+'/');
  assert.equal((await page.request.get(base+'/api/auth/me')).status(),200);
  return page;
}
try {
  const author=await login('author_alpha',process.env.DEMO_ALPHA_PASSWORD);
  const admin=await login('admin_demo',process.env.DEMO_ADMIN_PASSWORD,'/admin/login');
  const guest=await browser.newPage();
  await author.goto(base+'/creator/articles/new');
  await author.getByLabel('标题').fill(title);
  await author.getByRole('checkbox',{name:'前端'}).check();
  await author.getByLabel('Markdown 正文').fill('## 中文目录\n\n这是验收文章。\n\n## 中文目录\n\n第二节。');
  await author.getByRole('button',{name:'提交审核'}).click();
  await author.waitForURL(/\/creator\/articles\/.+\/edit/);
  articleId=author.url().split('/').at(-2);
  assert.equal((await guest.request.get(base+'/api/articles/'+articleId)).status(),404);
  assert.equal((await author.request.get(base+'/api/admin/articles')).status(),403);
  await admin.goto(base+'/admin/articles');
  await admin.getByRole('link',{name:title,exact:true}).click();
  await admin.getByLabel('审核原因').fill('请补充摘要');
  await admin.getByRole('button',{name:'驳回',exact:true}).click();
  await admin.getByText('驳回成功',{exact:true}).waitFor();
  await author.reload();
  await author.getByText('处理原因：请补充摘要').waitFor();
  await author.getByLabel('摘要').fill('已补充摘要');
  await author.getByRole('button',{name:'提交审核'}).click();
  await author.getByText('已提交审核',{exact:true}).waitFor();
  await admin.reload();
  await admin.getByRole('button',{name:'审核通过',exact:true}).click();
  await admin.getByText('审核通过成功',{exact:true}).waitFor();
  await guest.goto(base+'/articles/'+articleId);
  await guest.getByRole('heading',{name:title,exact:true}).waitFor();
  assert.deepEqual(await guest.locator('.markdown h2').evaluateAll(nodes=>nodes.map(n=>n.id)),['section-中文目录','section-中文目录-2']);
  const rows=await db.query('SELECT action FROM article_review_logs WHERE article_id=$1 ORDER BY article_version',[articleId]);
  assert.deepEqual(rows.rows.map(row=>row.action),['SUBMIT','REJECT','SUBMIT','APPROVE']);
  const beta=await login('reader_beta',process.env.DEMO_BETA_PASSWORD);
  const gamma=await login('reader_gamma',process.env.DEMO_GAMMA_PASSWORD);
  const readers=[beta,gamma];
  const comments=['Beta 的验收评论 '+title,'Gamma 的验收评论 '+title];
  for(const [i,reader] of readers.entries()){
    await reader.goto(base+'/articles/'+articleId);
    try { await reader.getByLabel('发表评论').fill(comments[i], {timeout:8000}); } catch(error) {console.error(reader.url(), await reader.locator('body').innerText());throw error;}
    await reader.getByRole('button',{name:'发表评论'}).click();
    await reader.getByText(comments[i],{exact:true}).waitFor();
    for(const [name,changed] of [['点赞','取消点赞'],['收藏','取消收藏'],['关注作者','取消关注']]){
      await reader.getByRole('button',{name,exact:true}).click();
      await reader.getByRole('button',{name:changed,exact:true}).waitFor();
    }
  }
  for(const table of ['article_likes','article_bookmarks']){
    const rows=await db.query('SELECT count(*)::integer count FROM '+table+' WHERE article_id=$1',[articleId]);
    assert.equal(rows.rows[0].count,2);
  }
  await beta.getByRole('button',{name:'取消点赞',exact:true}).click();
  await beta.getByRole('button',{name:'点赞',exact:true}).waitFor();
  await beta.getByRole('button',{name:'取消收藏',exact:true}).click();
  await beta.getByRole('button',{name:'收藏',exact:true}).waitFor();
  await gamma.reload();
  await gamma.getByRole('button',{name:'取消点赞',exact:true}).waitFor();
  await gamma.getByRole('button',{name:'取消收藏',exact:true}).waitFor();
  await gamma.goto(base+'/me/bookmarks');
  await gamma.getByRole('link',{name:title,exact:true}).waitFor();
  await beta.goto(base+'/me/bookmarks');
  await beta.getByRole('heading',{name:'我的收藏'}).waitFor();
  assert.equal(await beta.getByRole('link',{name:title,exact:true}).count(),0);
  await gamma.goto(base+'/me/following');
  await gamma.getByText('@author_alpha',{exact:true}).waitFor();
  await admin.goto(base+'/admin/comments');
  const comment=admin.locator('article').filter({hasText:comments[0]});
  await comment.getByLabel('隐藏原因').fill('测试隐藏');
  await comment.getByRole('button',{name:'隐藏评论'}).click();
  await comment.getByRole('button',{name:'恢复评论'}).waitFor();
  await guest.reload();
  await guest.getByText(comments[1],{exact:true}).waitFor();
  assert.equal(await guest.getByText(comments[0],{exact:true}).count(),0);
  await comment.getByRole('button',{name:'恢复评论'}).click();
  await comment.getByRole('button',{name:'隐藏评论'}).waitFor();
  await admin.goto(base+'/admin/articles/'+articleId);
  await admin.getByLabel('审核原因').fill('测试下架');
  await admin.getByRole('button',{name:'下架',exact:true}).click();
  await admin.getByText('下架成功',{exact:true}).waitFor();
  assert.equal((await guest.request.get(base+'/api/articles/'+articleId)).status(),404);
  console.log('Browser submission, rejection, approval, two-reader interactions, comment moderation and unlisting passed.');
} finally {
  await browser.close();
  if(articleId){
    await db.query('DELETE FROM comment_moderation_logs WHERE comment_id IN (SELECT id FROM comments WHERE article_id=$1)',[articleId]);
    await db.query('DELETE FROM comments WHERE article_id=$1',[articleId]);
    await db.query('DELETE FROM article_review_logs WHERE article_id=$1',[articleId]);
    await db.query('DELETE FROM articles WHERE id=$1',[articleId]);
  }
  await db.query('DELETE FROM user_follows WHERE followee_id=$1 AND follower_id IN ($2,$3)',[ids.author_alpha,ids.reader_beta,ids.reader_gamma]);
  for(const row of followBefore.rows)await db.query('INSERT INTO user_follows(follower_id,followee_id,created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',[row.follower_id,row.followee_id,row.created_at]);
  await db.end();
}
