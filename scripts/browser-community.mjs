import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:5173';
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||undefined});
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
await db.connect();
const title='审核验收 '+randomUUID().slice(0,8);
let articleId;
let otherArticleId;
const demoUsers=await db.query("SELECT id,username FROM users WHERE username IN ('author_alpha','reader_beta','reader_gamma')");
const ids=Object.fromEntries(demoUsers.rows.map(user=>[user.username,user.id]));
const followBefore=await db.query('SELECT follower_id,followee_id,created_at FROM user_follows WHERE followee_id=$1 AND follower_id IN ($2,$3)',[ids.author_alpha,ids.reader_beta,ids.reader_gamma]);
async function login(username,password,path='/login',fromComments=false){
  const page=await browser.newPage();
  await page.goto(base+path);
  if(fromComments)await page.getByRole('link',{name:'登录后发表评论'}).click();
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码',{exact:true}).fill(password);
  const loginResponse=page.waitForResponse(response=>response.url().endsWith('/api/auth/login')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'登录',exact:true}).click();
  assert.equal((await loginResponse).status(),200);
  await page.waitForURL(fromComments ? base+path+'#article-comments' : path.startsWith('/admin') ? base+'/admin/articles' : base+'/');
  assert.equal((await page.request.get(base+'/api/auth/me')).status(),200);
  return page;
}
try {
  const author=await login('author_alpha',process.env.DEMO_ALPHA_PASSWORD);
  const admin=await login('admin_demo',process.env.DEMO_ADMIN_PASSWORD,'/admin/login');
  const guest=await browser.newPage();
  await author.goto(base+'/creator/articles/new');
  await author.getByLabel('标题').fill(title);
  await author.getByText('发布设置',{exact:true}).click();
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
  const drafts=base+'/creator/articles?status=draft';
  await author.goto(drafts);
  await author.getByRole('link',{name:title,exact:true}).click();
  await author.getByText('处理原因：请补充摘要').waitFor();
  await author.getByText('发布设置',{exact:true}).click();
  await author.getByLabel('摘要').fill('已补充摘要');
  await author.getByRole('button',{name:'提交审核'}).click();
  await author.waitForURL(drafts);
  await author.getByRole('link',{name:title,exact:true}).waitFor({state:'hidden'});
  await author.getByRole('link',{name:'全部文章',exact:true}).click();
  await author.getByRole('listitem').filter({hasText:title}).getByText('待审核',{exact:true}).waitFor();
  await admin.reload();
  await admin.getByRole('button',{name:'审核通过',exact:true}).click();
  await admin.getByText('审核通过成功',{exact:true}).waitFor();
  await guest.goto(base+'/articles/'+articleId);
  await guest.getByRole('heading',{name:title,exact:true}).waitFor();
  assert.deepEqual(await guest.locator('.markdown h2').evaluateAll(nodes=>nodes.map(n=>n.id)),['section-中文目录','section-中文目录-2']);
  const rows=await db.query('SELECT action FROM article_review_logs WHERE article_id=$1 ORDER BY article_version',[articleId]);
  assert.deepEqual(rows.rows.map(row=>row.action),['SUBMIT','REJECT','SUBMIT','APPROVE']);
  const commentPath=base+'/api/articles/'+articleId+'/comments';
  const empty=await guest.request.get(commentPath);
  assert.deepEqual(await empty.json(),[]);
  const guestCsrf=await guest.request.get(base+'/api/auth/csrf');
  assert.equal((await guest.request.post(commentPath,{
    headers:{origin:base,'x-csrf-token':(await guestCsrf.json()).csrfToken},data:{body:'游客评论'},
  })).status(),401);
  const beta=await login('reader_beta',process.env.DEMO_BETA_PASSWORD,'/articles/'+articleId,true);
  const betaCsrf=(await (await beta.request.get(base+'/api/auth/csrf')).json()).csrfToken;
  for(const body of ['   ','x'.repeat(2001)]){
    assert.equal((await beta.request.post(commentPath,{
      headers:{origin:base,'x-csrf-token':betaCsrf},data:{body},
    })).status(),400);
  }
  await db.query(
    "INSERT INTO comments (id,article_id,author_id,body,created_at,updated_at) SELECT gen_random_uuid(),$1,$2,'较早的评论 '||n,now()-interval '1 day',now() FROM generate_series(1,100) n",
    [articleId,ids.author_alpha],
  );
  const gamma=await login('reader_gamma',process.env.DEMO_GAMMA_PASSWORD);
  const readers=[beta,gamma];
  const comments=['Beta 的验收评论 '+title,'Gamma 的验收评论 '+title];
  for(const [i,reader] of readers.entries()){
    await reader.goto(base+'/articles/'+articleId);
    await reader.getByLabel('发表评论').fill(comments[i]);
    await reader.getByRole('button',{name:'发表评论'}).click();
    await reader.getByText(comments[i],{exact:true}).waitFor();
    for(const [name,changed] of [['点赞','取消点赞'],['关注作者','取消关注']]){
      await reader.getByRole('button',{name,exact:true}).click();
      await reader.getByRole('button',{name:changed,exact:true}).waitFor();
    }
    await reader.getByRole('button',{name:'收藏',exact:true}).click();
    await reader.getByRole('button',{name:'保存到合集',exact:true}).click();
    await reader.getByRole('button',{name:'管理收藏',exact:true}).waitFor();
  }
  const visible=await (await guest.request.get(commentPath)).json();
  assert.equal(visible.length,100);
  assert.deepEqual(visible.slice(-2).map(({body,author})=>[body,author.username]),[
    [comments[0],'reader_beta'],[comments[1],'reader_gamma'],
  ]);
  const root=visible.at(-2);
  const replyText='Gamma 的二级回复 '+title;
  const thread=gamma.getByRole('listitem').filter({has:gamma.getByText(comments[0],{exact:true})}).first();
  await thread.getByRole('button',{name:'回复',exact:true}).click();
  await thread.getByLabel('回复评论').fill(replyText);
  const postedReply=gamma.waitForResponse(response=>response.url()===commentPath&&response.request().method()==='POST');
  await thread.getByRole('button',{name:'发送回复',exact:true}).click();
  const replyResponse=await postedReply;
  assert.equal(replyResponse.status(),201);
  assert.equal((await replyResponse.json()).parentId,root.id);
  await thread.getByRole('list',{name:'二级回复'}).getByText(replyText,{exact:true}).waitFor();
  const publishedThreads=await (await guest.request.get(commentPath)).json();
  const [reply]=publishedThreads.find(item=>item.id===root.id).replies;
  assert.equal(reply.body,replyText);
  assert.equal(reply.author.username,'reader_gamma');
  assert.equal((await beta.request.post(commentPath,{
    headers:{origin:base,'x-csrf-token':betaCsrf},data:{body:'不允许三级回复',parentId:reply.id},
  })).status(),404);
  const ownReplyText='Gamma 回复自己的评论 '+title;
  const ownThread=gamma.getByRole('listitem').filter({has:gamma.getByText(comments[1],{exact:true})}).first();
  await ownThread.getByRole('button',{name:'回复',exact:true}).click();
  await ownThread.getByLabel('回复评论').fill(ownReplyText);
  await ownThread.getByRole('button',{name:'发送回复',exact:true}).click();
  await ownThread.getByRole('list',{name:'二级回复'}).getByText(ownReplyText,{exact:true}).waitFor();
  await gamma.reload();
  await ownThread.getByRole('list',{name:'二级回复'}).getByText(ownReplyText,{exact:true}).waitFor();
  const ownThreads=await (await guest.request.get(commentPath)).json();
  const ownRoot=ownThreads.find(item=>item.body===comments[1]);
  const ownReply=ownRoot.replies.find(item=>item.body===ownReplyText);
  assert.equal(ownReply.author.id,ownRoot.author.id);
  assert.equal(ownReply.parentId,ownRoot.id);
  const rootLikePath=commentPath+'/'+root.id+'/like';
  assert.equal((await guest.request.put(rootLikePath,{
    headers:{origin:base,'x-csrf-token':(await guestCsrf.json()).csrfToken},data:{active:true},
  })).status(),401);
  const betaRoot=beta.locator('.comment-list > li').filter({has:beta.getByText(comments[0],{exact:true})});
  const betaRootLike=betaRoot.locator(':scope > .comment-controls button[aria-pressed]');
  await betaRootLike.click();
  await expect(betaRootLike).toHaveText('1');
  const repeated=await beta.request.put(rootLikePath,{
    headers:{origin:base,'x-csrf-token':betaCsrf},data:{active:true},
  });
  assert.deepEqual(await repeated.json(),{liked:true,likeCount:1});
  const gammaRoot=gamma.locator('.comment-list > li').filter({has:gamma.getByText(comments[0],{exact:true})});
  const gammaRootLike=gammaRoot.locator(':scope > .comment-controls button[aria-pressed]');
  await gamma.reload();
  await expect(gammaRootLike).toHaveText('1');
  await gammaRootLike.click();
  await expect(gammaRootLike).toHaveText('2');
  const ownReplyLike=ownThread.getByRole('list',{name:'二级回复'}).getByRole('button',{name:'点赞评论'});
  await ownReplyLike.click();
  await expect(ownThread.getByRole('list',{name:'二级回复'}).getByRole('button',{name:'取消评论点赞'})).toHaveText('1');
  await gamma.reload();
  await expect(gammaRootLike).toHaveText('2');
  await expect(ownThread.getByRole('list',{name:'二级回复'}).getByRole('button',{name:'取消评论点赞'})).toHaveText('1');
  await beta.reload();
  await expect(betaRootLike).toHaveText('2');
  await betaRootLike.click();
  await expect(betaRootLike).toHaveText('1');
  const guestThreads=await (await guest.request.get(commentPath)).json();
  assert.equal(guestThreads.find(item=>item.id===root.id).liked,false);
  assert.equal(guestThreads.find(item=>item.id===root.id).likeCount,1);
  const storedLikes=await db.query('SELECT user_id FROM comment_likes WHERE comment_id=$1',[root.id]);
  assert.deepEqual(storedLikes.rows,[{user_id:ids.reader_gamma}]);
  otherArticleId=randomUUID();
  await db.query(
    "INSERT INTO articles (id,author_id,title,body_markdown,status,review_status,published_at,updated_at) VALUES ($1,$2,$3,'另一篇文章','PUBLISHED','APPROVED',now(),now())",
    [otherArticleId,ids.author_alpha,title+' 另一篇'],
  );
  assert.equal((await beta.request.post(base+'/api/articles/'+otherArticleId+'/comments',{
    headers:{origin:base,'x-csrf-token':betaCsrf},data:{body:'不允许跨文章回复',parentId:root.id},
  })).status(),404);
  const readCommentCount=async()=> (await (await guest.request.get(base+'/api/articles/'+articleId)).json())._count.comments;
  assert.equal(await readCommentCount(),104);
  for(const table of ['article_likes','article_bookmarks']){
    const rows=await db.query('SELECT count(*)::integer count FROM '+table+' WHERE article_id=$1',[articleId]);
    assert.equal(rows.rows[0].count,2);
  }
  await beta.getByRole('button',{name:'取消点赞',exact:true}).click();
  await beta.getByRole('button',{name:'点赞',exact:true}).waitFor();
  await beta.getByRole('button',{name:'管理收藏',exact:true}).click();
  await beta.getByRole('dialog',{name:'管理收藏'}).getByRole('button',{name:'取消收藏',exact:true}).click();
  await beta.getByRole('button',{name:'收藏',exact:true}).waitFor();
  await gamma.reload();
  await gamma.getByRole('button',{name:'取消点赞',exact:true}).waitFor();
  await gamma.getByRole('button',{name:'管理收藏',exact:true}).waitFor();
  await gamma.goto(base+'/me/bookmarks?collection=default');
  await gamma.getByRole('link',{name:title,exact:true}).waitFor();
  await beta.goto(base+'/me/bookmarks?collection=default');
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
  assert.equal(await guest.getByText(replyText,{exact:true}).count(),0);
  assert.equal(await readCommentCount(),102);
  assert.equal((await beta.request.put(commentPath+'/'+reply.id+'/like',{
    headers:{origin:base,'x-csrf-token':betaCsrf},data:{active:true},
  })).status(),404);
  assert.equal((await beta.request.post(commentPath,{
    headers:{origin:base,'x-csrf-token':betaCsrf},data:{body:'不允许回复已隐藏评论',parentId:root.id},
  })).status(),404);
  await comment.getByRole('button',{name:'恢复评论'}).click();
  await comment.getByRole('button',{name:'隐藏评论'}).waitFor();
  await guest.reload();
  await guest.getByText(comments[0],{exact:true}).waitFor();
  await guest.getByText(replyText,{exact:true}).waitFor();
  assert.equal(await readCommentCount(),104);
  await admin.goto(base+'/admin/articles/'+articleId);
  await admin.getByLabel('审核原因').fill('测试下架');
  await admin.getByRole('button',{name:'下架',exact:true}).click();
  await admin.getByText('下架成功',{exact:true}).waitFor();
  assert.equal((await guest.request.get(base+'/api/articles/'+articleId)).status(),404);
  assert.equal((await guest.request.get(commentPath)).status(),404);
  assert.equal((await beta.request.post(commentPath,{headers:{origin:base,'x-csrf-token':betaCsrf},data:{body:'下架后的评论'}})).status(),404);
  console.log('Browser submission, rejection, approval, two-reader interactions, comment moderation and unlisting passed.');
} finally {
  await browser.close();
  if(otherArticleId)await db.query('DELETE FROM articles WHERE id=$1',[otherArticleId]);
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
