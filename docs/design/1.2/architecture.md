# 系统架构与运行拓扑 1.2

## 应用入口

| 层 | 入口 | 职责 |
| --- | --- | --- |
| 用户前台 | `index.html`、`apps/web/main.tsx` | 文章、沸点、课程、个人和创作者页面。React Router 处理站内链接，TanStack Query 管理接口数据。 |
| 管理后台 | `admin/index.html`、`apps/admin/main.tsx` | 在 `/admin/` 下独立运行，检查会话及管理员角色后进入审核、评论、精选和活动管理。 |
| API | `apps/api/start.ts`、`apps/api/app.ts` | Fastify 注册接口、会话、角色、来源和 CSRF 校验，统一处理错误。读取场景按目标状态约束公开范围。 |
| 数据 | `prisma/schema.prisma`、`prisma/migrations/` | Prisma Client 连接 PostgreSQL，版本化迁移包含外键、索引、数据库 CHECK 和触发器。 |

同源 Vite 转发把前后台的 `/api` 请求交给 API 服务。默认 API 监听 `127.0.0.1:3000`，转发目标可由 `API_PROXY_TARGET` 指定。开发 API 只接受 `APP_ORIGINS` 中列出的写请求来源。后台 URL 刷新由 Vite 的管理端 HTML 回退处理。

## 数据流与一致性

1. 页面按路由参数和当前会话查询，组件将加载、空数据、错误和重试表现为明确状态。
2. 写请求先取得 CSRF token，再由同源 Cookie 提供会话。服务端根据会话确定当前用户，并在目标写入前校验权限、发布状态和参数。
3. 评论、关系写入和审核变更提交后返回服务端结果。浏览器刷新对应查询，重新读取计数和公开状态。
4. 状态变更和审核日志写入同一事务。重新上架恢复原关联数据，首次发布通知和重新上架分开处理。
5. 退出或切换账号时清理非会话查询。个人数据端点使用 `private, no-store` 或 `no-store`；前端缓存含会话信息时应按账号区分。

## 本地运行与发布边界

根目录 README 记录 Node、PostgreSQL、迁移和浏览器验证命令。当前本地 PostgreSQL 可以由 `npm run db:local` 在 `55432` 启动，连接地址以 `.env` 的 `DATABASE_URL` 为准。构建产物包含前台和管理后台入口，部署时需为两者配置独立的历史路由回退和同源 `/api` 转发。

旧 `server.mjs`、`schema.sql` 和 `seed.mjs` 属于 SQLite 原型。应用的当前数据迁移及生效约束以 PostgreSQL migration history 为准。

## 1.1 到 1.2

1.2 将待评审方案拆成可追溯的当前模块文档，并区分运行中的接口、数据库约束和暂未实现的设计。前后台的入口、角色检查和同源访问由独立应用共同使用 API。
