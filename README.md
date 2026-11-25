# 码栈开发者社区

当前应用使用 Node.js 24、Fastify、Prisma 7、PostgreSQL 和 React。开发实现包括账号、文章、审核、互动、活动、沸点和课程模块。

## 本地运行

1. 运行 `npm ci`。首次安装后运行 `npm run db:generate`。
2. 从 `.env.example` 创建本地 `.env`，填写数据库连接。可用 `docker compose up -d postgres` 启动 PostgreSQL。没有 Docker 时可在单独终端执行 `npm run db:local`，相应连接端口改为 55432。
3. 执行 `npm run db:migrate`。如需演示数据，在本地 `.env` 为四个演示账号分别设置密码并启用 `ENABLE_DEMO_SEED=true`，再执行 `ENABLE_DEMO_ARTICLES=true npm run db:seed`。
4. 分别运行 `npm run api` 与 `npm run dev`。前台为 http://127.0.0.1:5173/ ，后台为 http://127.0.0.1:5173/admin/ ，API 为 http://127.0.0.1:3000/ 。接口描述位于 `/api/openapi.json`。

| 账号 | 角色 | 配置项 |
| --- | --- | --- |
| admin_demo | 管理员 | DEMO_ADMIN_PASSWORD |
| author_alpha | 作者 | DEMO_ALPHA_PASSWORD |
| reader_beta | 读者 | DEMO_BETA_PASSWORD |
| reader_gamma | 读者 | DEMO_GAMMA_PASSWORD |

账号密码位于本机私有 `.env`。数据库中只存哈希。首次演示可用作者提交一篇文章，再用管理员审核。若要分别保持两个账号登录，请使用独立浏览器上下文。

## 验证

- `npm run typecheck` 和 `npm run build`。
- 使用独立 PostgreSQL 数据库，设置以 `_test` 结尾的 `TEST_DATABASE_URL`。用该地址作为 `DATABASE_URL` 应用迁移，然后运行 `npm test`。
- 安装 Playwright 自带 Chromium。可将浏览器保存在项目忽略的目录中。

  ```sh
  export PLAYWRIGHT_BROWSERS_PATH="$PWD/data/playwright"
  npx playwright install chromium
  npm run test:browser:auth
  npm run test:browser:community
  npm run test:browser:activities
  npm run test:browser:pulses
  npm run test:browser:courses
  ```

  浏览器脚本需先运行 API 与前台，并使用本地演示库。它们通过实际页面和接口验收，并清理临时测试文章和交互。四个演示账户的关注关系会恢复为脚本运行前的状态。

## 部署入口

构建分别生成 `dist/index.html` 和 `dist/admin/index.html`。前台深链接由网关回退到前者，`/admin/*` 回退到后者，`/api/*` 反向代理到同一 API。HTTPS 部署设置 `NODE_ENV=production`、`APP_ORIGINS` 和正式数据库连接。演示种子仅用于本地库。

活动由管理员在后台「活动管理」配置，首页读取处于展示时间内的已发布活动。当前模块与数据库设计见 [设计文档版本索引](docs/design/README.md)。

沸点和课程演示数据可通过 `ENABLE_DEMO_PULSES=true ENABLE_DEMO_COURSES=true npm run db:seed` 初始化。
