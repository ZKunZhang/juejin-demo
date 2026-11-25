import { connectDatabase } from './db';
import { hashPassword } from './security';

const accounts = [
  { username: 'admin_demo', displayName: '演示管理员', role: 'ADMIN', variable: 'DEMO_ADMIN_PASSWORD' },
  { username: 'author_alpha', displayName: '林夕', role: 'USER', variable: 'DEMO_ALPHA_PASSWORD' },
  { username: 'reader_beta', displayName: '陈默', role: 'USER', variable: 'DEMO_BETA_PASSWORD' },
  { username: 'reader_gamma', displayName: '周野', role: 'USER', variable: 'DEMO_GAMMA_PASSWORD' },
] as const;
if (process.env.NODE_ENV === 'production' || process.env.ENABLE_DEMO_SEED !== 'true') throw new Error('Demo seed requires explicit opt-in outside production');
const url = new URL(process.env.DATABASE_URL || '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/_(dev|test)$/.test(url.pathname)) {
  throw new Error('Demo seed requires a local database with a _dev or _test suffix');
}
const db = connectDatabase();
try {
  const credentials = accounts.map(account => {
    const password = process.env[account.variable];
    if (!password || password.length < 8 || password.length > 128) throw new Error(`Set ${account.variable} to an 8–128 character password`);
    return password;
  });
  if (new Set(credentials).size !== credentials.length) throw new Error('Demo accounts require distinct passwords');
  const hashes = await Promise.all(credentials.map(hashPassword));
  await db.$transaction(async tx => {
    for (const [index, account] of accounts.entries()) {
      const row = await tx.user.upsert({
        where: { username: account.username }, update: {},
        create: { username: account.username, displayName: account.displayName, role: account.role, passwordHash: hashes[index] },
      });
      if (row.role !== account.role) throw new Error(`Role conflict for ${account.username}`);
    }
  });
  if (process.env.ENABLE_DEMO_ARTICLES === 'true') {
    const author = await db.user.findUniqueOrThrow({ where: { username: 'author_alpha' } });
    const tags = await db.tag.findMany();
    const fixtures = [
      ['frontend', '把复杂页面拆成可维护的组件', '沿着状态归属和数据依赖划分边界，减少跨组件协作的成本。', '先写清楚状态的拥有者，再判断子组件是否依赖同一组输入。'],
      ['backend', '一次 PostgreSQL 索引排查记录', '从查询计划定位慢查询，比较索引覆盖和写入成本。', '用实际参数运行 EXPLAIN，区分估算行数与真实行数。'],
      ['ai', '给 AI 应用补上可观测性', '记录请求耗时、失败率与输入输出，让故障排查可复现。', '给请求分配关联 ID，在日志中避免记录用户凭据。'],
      ['tools', '团队项目里的 Git 提交习惯', '用小粒度提交和可读的变更说明降低协作成本。', '按可验证的行为切分提交，并把迁移与应用改动一同评审。'],
    ];
    await db.$transaction(async tx => {
      for (const [index, [slug, title, summary, note]] of fixtures.entries()) {
        const tag = tags.find(row => row.slug === slug);
        if (!tag) throw new Error('Apply article migrations before seeding demo articles');
        await tx.article.upsert({
          where: { id: '8c5a7ea9-1066-4e3d-8c49-fa4aaa43100'+(index+1) }, update: {},
          create: {
            id: '8c5a7ea9-1066-4e3d-8c49-fa4aaa43100'+(index+1),
            authorId: author.id, title, summary, bodyMarkdown: summary+'\n\n## 实践思路\n'+note+'\n\n## 验证\n- 固定输入和预期结果\n- 覆盖最常见的边界条件',
            status: 'PUBLISHED', reviewStatus: 'APPROVED', publishedAt: new Date(Date.now() - index * 86400000),
            tags: { create: { tagId: tag.id } },
          },
        });
      }
    });
  }
  console.log('演示账号已初始化：', accounts.map(account => account.username).join('、'));
} finally {
  await db.$disconnect();
}
