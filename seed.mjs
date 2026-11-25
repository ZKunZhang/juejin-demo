export function seed(db) {
  if (db.prepare('SELECT id FROM tags LIMIT 1').get()) return;
  db.exec('BEGIN');
  try {
    const user = db.prepare('INSERT INTO users(id,handle,name,bio,avatar,website) VALUES(?,?,?,?,?,?)');
    user.run(1,'linxi','林夕','写代码，也记录写代码的过程。','林','https://example.com');
    user.run(2,'chenmo','陈默','关注系统设计与工程效率。','陈','');
    user.run(3,'zhouye','周野','在前端和设计之间工作。','周','');
    const tag = db.prepare('INSERT INTO tags(id,name,icon) VALUES(?,?,?)');
    [['前端','◈'],['后端','▤'],['人工智能','✦'],['移动开发','▯'],['开发工具','⌘'],['程序员生活','☕']].forEach(([name,icon],i)=>tag.run(i+1,name,icon));
    const post = db.prepare('INSERT INTO posts(id,user_id,kind,title,body,image,featured,views,series) VALUES(?,?,?,?,?,?,?,?,?)');
    const topics = [
      [1,1,'把复杂页面拆成可维护的组件','组件拆分的边界是什么？从数据依赖和交互状态出发，看看如何让页面在迭代中保持清晰。',1,386,'前端工程笔记'],
      [2,2,'从一条慢查询开始理解 SQLite 索引','用查询计划定位一次全表扫描，并结合读写成本讨论复合索引的顺序。',2,268,'数据实践'],
      [3,3,'给 AI 应用补上可观测性','记录模型请求中的耗时、失败率和输入输出规模，让调试有迹可循。',3,192,''],
      [4,1,'用 TypeScript 表达 UI 的加载状态','把加载、失败和成功建模为可辨识联合，让渲染逻辑更直观。',1,146,'前端工程笔记'],
      [5,2,'几个值得保留的 Git 日常习惯','从小粒度提交到可读的变更说明，减少协作里的意外成本。',5,118,''],
      [6,3,'移动端表单的细节清单','整理键盘类型、错误提示与触控区域，让输入过程更顺手。',4,95,'']
    ];
    const link = db.prepare('INSERT INTO post_tags VALUES(?,?)');
    for (const [id,uid,title,intro,tagId,views,series] of topics) {
      post.run(id,uid,'article',title,intro+'\n\n## 从问题出发\n先记录当前行为和预期，再选一个最小场景做验证。\n\n## 实践步骤\n- 明确输入与输出\n- 保留可重现的例子\n- 验证异常与边界\n\n### 小结\n把可验证的结果写进工程笔记。','',0,views,series);
      link.run(id,tagId);
    }
    post.run(7,3,'pulse','','给周末的小项目做了一版视觉稿。最近你们在折腾什么？','/sample.png',1,0,'');
    post.run(8,2,'pulse','','今天把两条慢查询从全表扫描改成了索引查找。下一步想把过程写成笔记。','',1,0,'');
    post.run(9,1,'pulse','','收集一些你愿意推荐给同事的开发工具。','',0,0,'');
    link.run(7,6);link.run(8,2);link.run(9,5);
    db.exec("INSERT INTO comments(post_id,user_id,body) VALUES(1,2,'组件边界按状态归属划分，这个思路很实用。'); INSERT INTO likes VALUES (2,1),(3,1),(1,7),(2,7);");
    const course = db.prepare('INSERT INTO courses VALUES(?,?,?,?,?,?,?,?)');
    const lesson = db.prepare('INSERT INTO lessons(course_id,position,title,body) VALUES(?,?,?,?)');
    [
      ['前端工程化实践','前端','进阶','林夕','从项目结构到交付流程，整理前端工程常用实践。','indigo'],
      ['SQLite 应用开发入门','后端','入门','陈默','用一个社区项目掌握关系建模、事务与查询计划。','teal'],
      ['构建你的第一个 AI 工具','人工智能','入门','周野','从界面原型到可观测的服务，搭建小型应用。','violet'],
      ['移动端交互设计手册','移动开发','进阶','周野','围绕常用组件练习布局、触控与反馈。','blue']
    ].forEach(([title,category,level,author,summary,color],i)=>{
      course.run(i+1,title,category,level,author,summary,summary+'\n\n## 学习内容\n从可运行的示例开始，通过练习巩固每一章。',color);
      ['准备与目标','动手实现','验证与复盘'].forEach((name,j)=>lesson.run(i+1,j+1,name,'## '+name+'\n\n围绕「'+title+'」记录目标、执行步骤和验证结果。'));
    });
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}
