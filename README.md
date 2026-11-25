# 码栈开发者社区

码栈包含文章、沸点、课程小册、评论与互动、创作者中心和内容管理后台。用户前台和管理后台用 React 与 Vite 构建，共用 Fastify API 和 PostgreSQL。数据库通过 Prisma 迁移维护。

## 本地启动

需要 Node.js 24 或更新版本、npm 和 PostgreSQL。在项目根目录执行。

```sh
npm ci
npm run db:generate
cp -n .env.example .env
```

以下数据库启动方式选一种。

| 方式 | 命令 | 默认端口 |
| --- | --- | --- |
| Docker Compose | `docker compose up -d postgres` | `5432` |
| 本地嵌入式 PostgreSQL | 在独立终端运行 `npm run db:local` | `55432` |

在 `.env` 中确认 `DATABASE_URL` 与选用的数据库端口一致。嵌入式数据库默认将数据保存在 `data/postgres/`。数据库就绪后执行 `npm run db:migrate`。

在两个终端分别运行 `npm run api` 和 `npm run dev`。

| 入口 | 地址 |
| --- | --- |
| 用户前台 | [127.0.0.1:5173](http://127.0.0.1:5173/) |
| 管理后台 | [127.0.0.1:5173/admin](http://127.0.0.1:5173/admin/) |
| OpenAPI 描述 | [127.0.0.1:3000/api/openapi.json](http://127.0.0.1:3000/api/openapi.json) |

Vite 将同源的 `/api` 请求转发到 `127.0.0.1:3000`。如果更换前端端口，将实际来源加入 `.env` 的 `APP_ORIGINS`。API 地址变动时，在启动 Vite 的环境里设置 `API_PROXY_TARGET`。

## 演示账号与数据

在本地 `.env` 设置 `ENABLE_DEMO_SEED=true`，给四个演示账号各配置一个不同的密码。种子脚本要求目标是本地且名称以 `_dev` 或 `_test` 结尾的数据库。

| 账号 | 角色 | 密码变量 |
| --- | --- | --- |
| `admin_demo` | 管理员 | `DEMO_ADMIN_PASSWORD` |
| `author_alpha` | 作者 | `DEMO_ALPHA_PASSWORD` |
| `reader_beta` | 读者 | `DEMO_BETA_PASSWORD` |
| `reader_gamma` | 读者 | `DEMO_GAMMA_PASSWORD` |

```sh
ENABLE_DEMO_ARTICLES=true ENABLE_DEMO_PULSES=true ENABLE_DEMO_COURSES=true npm run db:seed
```

密码放在本地 `.env`，数据库保存密码哈希。多账号联调使用独立浏览器上下文。

## 验证

```sh
npm run typecheck
npm run build
node --test scripts/test-docs.mjs
```

数据库集成测试使用已创建、库名以 `_test` 结尾的独立 PostgreSQL 数据库。先将连接串设为 `TEST_DATABASE_URL`，再执行以下命令。

```sh
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
npm test
```

浏览器验收先启动连接同一个测试库的 API 与 Vite，并按场景初始化演示数据。使用 Playwright 自带 Chromium 时可在项目忽略目录安装。

```sh
export PLAYWRIGHT_BROWSERS_PATH="$PWD/data/playwright"
npx playwright install chromium
npm run test:browser:auth
npm run test:browser:community
npm run test:browser:activities
npm run test:browser:pulses
node --env-file=.env scripts/browser-courses.mjs
```

上述浏览器命令在默认地址运行。若使用独立测试端口，将 `BROWSER_BASE_URL` 设置为对应的 Vite 地址，并通过环境变量将 `DATABASE_URL` 指向测试库。脚本会创建和清理测试业务数据。

## 部署

`npm run build` 生成 `dist/index.html` 和 `dist/admin/index.html`。网关将各自的页面深链接回退至相应入口，并将 `/api/*` 转发到同一个 API。HTTPS 部署设置 `NODE_ENV=production`、实际 `APP_ORIGINS` 和正式数据库连接。

新增导航与数据库设计见 [1.3 设计](docs/1.3/README.md)。

## 项目结构

```text
apps/
  web/                  用户前台
    main.tsx            HTML 挂载入口
    app/                应用配置、导航、路由与全局主题
    features/           文章、沸点、课程、搜索、创作及个人功能
  admin/                管理后台
    main.tsx            HTML 挂载入口
    app/                后台导航、路由、权限入口与全局样式
    features/           文章审核、评论审核、沸点、排行和活动
    shared/             后台通用弹窗、日期筛选和分页
  api/
    start.ts、seed.ts   API 启动与演示数据入口
    app/                Fastify 应用组装
    features/           按业务模块组织接口
    shared/             数据库连接、会话、校验和通用查询规则
  shared/               前后台共用的 API 客户端、认证、内容类型、控件和基础样式
prisma/                 数据模型及 PostgreSQL 迁移
tests/                  API 与数据库集成测试
scripts/                浏览器和文档验收脚本
docs/                   按版本保留项目设计
```

当前源码组织见 [1.3 分层设计](docs/1.3/README.md)，业务模块见 [1.2 模块设计](docs/1.2/README.md)，原设计见 [1.1 设计快照](docs/1.1/README.md)。项目协作约定见 [agent.md](agent.md)。
