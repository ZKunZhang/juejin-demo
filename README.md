# 码栈开发者社区

M1 提供 React 注册登录、Fastify API、Prisma 和 PostgreSQL 用户与会话。先运行 npm ci 和 npm run db:generate。从 .env.example 创建 .env，启动 PostgreSQL，运行 npm run db:migrate。若使用 npm run db:local，将连接端口设为 55432。

分别运行 npm run api 与 npm run dev，然后访问 http://127.0.0.1:5173/。通过本地环境配置启用 npm run db:seed，初始化管理员、作者和两个读者。密码由本地环境变量提供。

集成测试要求独立 PostgreSQL 测试库，迁移后以 TEST_DATABASE_URL 指定。浏览器测试使用 Playwright Chromium，先运行 npx playwright install chromium，再运行 npm run test:browser:auth。

M3 由 /admin/ 提供文章审核与评论管理。文章由作者提交，管理员审核通过后公开。
