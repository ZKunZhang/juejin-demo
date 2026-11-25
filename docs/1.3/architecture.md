# 源码目录分层 1.3

## 入口与组装

| 入口 | 组装层 | 职责 |
| --- | --- | --- |
| [前台挂载](../../apps/web/main.tsx) | [前台应用](../../apps/web/app/web-app.tsx) | 会话、导航、React Router、全局主题与数据 Provider |
| [后台挂载](../../apps/admin/main.tsx) | [后台应用](../../apps/admin/app/admin-app.tsx) | 管理员入口、导航、React Router 及管理布局 |
| [API 启动](../../apps/api/start.ts) | [Fastify 应用](../../apps/api/app/app.ts) | 数据库连接、Fastify 插件、通用错误处理、业务路由注册 |

Vite 的两个 HTML 入口与 API 启动命令沿用原路径。应用组装层向下组合业务模块和通用模块，页面地址和 API 地址保持原契约。

## 业务目录

- `apps/web/features/` 按文章、沸点、课程、搜索、创作、个人页、收藏、互动、通知和扩展入口组织。模块自身的样式和局部交互与页面放在一起。
- `apps/admin/features/` 包含文章、评论、沸点与榜单、活动。文章审核复用同一评论审核组件展示当前文章的评论。后台日期筛选、弹窗、分页位于 `apps/admin/shared/`。
- `apps/api/features/` 包含文章与阅读、沸点、课程、互动和通知、创作、活动。路由处理与各自的业务事务保持在同一模块，发布通知等跨模块行为引用实际拥有者。
- `apps/api/shared/` 保存 Prisma 连接、认证、HTTP schema 与错误、日期筛选及评论来源查询规则。

## 前后台共享

`apps/shared/api/` 保存同源请求和错误解码，`apps/shared/auth/` 保存会话及认证，`apps/shared/content/` 保存前后台都读取的内容类型与状态展示规则。`apps/shared/ui/` 提供评论、Markdown、状态反馈和通用表单控件。`apps/shared/styles/` 提供基础样式，前后台的页面主题由各自组装层加载。

数据库模型和迁移仍在仓库根目录的 `prisma/`。接口与数据库集成测试仍在 `tests/`，浏览器验收在 `scripts/`。历史文档中的源码链接随文件路径更新，业务说明保留在各版本。
