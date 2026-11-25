# 后端及数据库开发文档

版本 v0.3，待评审。以 [PostgreSQL 数据库设计](./database-design.html) 为基础。本文件补充模块接口、工具和实施约定。旧 SQLite 草稿留作历史参考。

## 工具与职责

| 模块 | 工具 | 用途 |
| --- | --- | --- |
| 服务 | Node.js、TypeScript、Fastify | 共用 API、请求生命周期、路由、统一错误处理与结构化日志。 |
| 输入及输出 | Fastify JSON Schema、Ajv、Fastify response schema | 校验 body、query、params，限制未知字段与尺寸，显式选择响应字段。异步查库在校验之后。 |
| 权限 | Fastify preHandler、@fastify/cookie | 会话解析、当前角色、资源归属。每条写路由校验允许的输入与访问身份。 |
| 请求安全 | @fastify/rate-limit、@fastify/csrf-protection、node:crypto、argon2 | 登录与注册限速；同源及 CSRF 校验；随机令牌和 SHA-256 摘要；Argon2id 密码哈希。 |
| 数据与迁移 | PostgreSQL、Prisma ORM、Prisma Migrate、psql | 外键、唯一约束、事务、审核并发控制、迁移与独立数据核验。按选定 Prisma 主版本锁定客户端和 CLI。 |
| 联调 | @fastify/swagger、OpenAPI | 从路由 schema 生成 API 文档和示例，请求与响应结构供前端联调。 |
| 本地及测试 | Docker Compose、Vitest、Fastify inject、Playwright | 本地真实 PostgreSQL、接口集成与端到端验收。 |

路由中间件依赖 [Fastify Hooks](https://fastify.dev/docs/latest/Reference/Hooks/) 和 [输入校验与响应序列化](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)。标签采用 [Prisma 显式多对多关系](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/relations/many-to-many-relations)。

## 通用契约

- 服务按 auth、articles、moderation、interactions 分模块。JSON 错误统一为 `{ error: { code, message, fields? } }`。请求日志脱敏，响应 schema 排除密码、令牌及非当前场景可见的字段。
- 输入结构校验后按路由验证会话、角色和资源归属。路径 ID 为 UUID。匿名访问受保护路由返回 401，角色或资源写权限不足返回 403，无法公开读取的内容返回 404，版本或唯一约束冲突返回 409。
- Cookie 拟用 HttpOnly、SameSite=Lax，HTTPS 启用 Secure。提供 `GET /api/auth/csrf` 获取 CSRF token，使用 `X-CSRF-Token` 提交写请求，同时检查 Origin。前台、后台各自通过同源 API 网关登录。
- 核心实体使用 UUID、UTC 时间戳。数据库接收规范化字段并以唯一约束处理竞争请求。保留迁移文件，部署前在独立库验证从空库迁移及已有库升级。

## M1 登录注册

| 接口 | 输入 | 成功响应 |
| --- | --- | --- |
| POST /api/auth/register | username、displayName、password | 201，安全用户对象和会话 Cookie |
| POST /api/auth/login | username、password | 200，安全用户对象和新会话 Cookie |
| GET /api/auth/me | 会话 Cookie | 200，当前安全用户对象，匿名 401 |
| POST /api/auth/logout | 会话 Cookie、CSRF 头 | 204，撤销当前会话并清除 Cookie |

用户对象含 id、username、displayName、role。用户名暂定 3–32 位字母、数字或下划线，写入前转小写。密码暂定 8–128 字符，原值进入 Argon2id。禁用账号后会话不可用。角色由服务端设定，注册固定 USER。首批迁移创建 `users` 和 `sessions`，会话保存令牌摘要及有效期。

## M2 文章发布、列表与详情

| 接口 | 输入与返回 |
| --- | --- |
| POST /api/articles | title、bodyMarkdown、summary?、tagIds，返回 201 和草稿对象。 |
| PATCH /api/articles/:id | 可修改的文章字段和 version，返回最新草稿。标签数组整体替换，省略时保留原标签。 |
| GET /api/me/articles、GET /api/me/articles/:id | 仅本人。列表与详情返回状态、版本及可见的审核意见。 |
| GET /api/tags | 返回可选文章标签。 |
| GET /api/articles | 可选 tagId、cursor、limit，返回 items、nextCursor。只查询已发布文章。 |
| GET /api/articles/:id | 返回已发布文章正文、摘要、公开作者资料、标签和时间。 |

迁移创建 `articles`、`tags`、`article_tags`。标签关系用联合主键。创建、编辑及标签替换原子提交。正文保留 Markdown 源文本；标题最长 160 字符，正文暂定最长 60,000 字符，标签最多 10 个，数组拒绝重复 ID。发布时校验非空正文和标题。列表按发布时间及 UUID 倒序，游标绑定筛选条件。

暂定 `POST /api/dev/articles/:id/publish` 只在开发和测试环境且显式启用时注册，验证作者、版本和发布条件。非开发环境路由不可用。M3 删除临时端点，测试统一通过审核发布文章。

## M3 文章审核与评论管理

| 接口 | 访问与规则 |
| --- | --- |
| POST /api/articles/:id/submit | 作者提交 version。DRAFT 从 NOT_SUBMITTED 或 REJECTED 进入 PENDING。 |
| GET /api/admin/articles、GET /api/admin/articles/:id | ADMIN 查看队列及待审正文，按状态分页。 |
| POST /api/admin/articles/:id/review | ADMIN 提交 action（APPROVE/REJECT）、version、reason?。通过后 PUBLISHED，驳回后仍是 DRAFT，且理由必填。 |
| POST /api/admin/articles/:id/unlist | ADMIN 提交 version 和 reason，已发布文章转为 UNLISTED。 |
| POST /api/articles/:id/return-to-draft | 作者对已下架文章提交 version，回到 DRAFT + NOT_SUBMITTED，可再编辑提交。 |
| GET /api/admin/comments | ADMIN 按文章和可见状态分页。验证阶段使用种子评论。 |
| PATCH /api/admin/comments/:id/status | ADMIN 提交 expectedStatus、status、reason?，隐藏需写理由，恢复改为 VISIBLE。 |

文章状态、版本、时间及 `article_review_logs` 一次提交。审核日志的 article_version 记录动作发生前的版本。并发条件更新失败返回 409，无重复日志。评论状态与 `comment_moderation_logs` 同一事务提交。M3 迁移创建评论和操作日志，公开评论读写在 M4 接通。

## M4 评论、点赞、收藏与关注

- `GET/POST /api/articles/:id/comments`。游客只读已发布文章的可见评论。登录提交 body，后端验证非空、长度与可评论状态，作者来自会话。
- `PUT /api/articles/:id/like`、`PUT /api/articles/:id/bookmark`、`PUT /api/users/:id/follow` 接收 `{ active: boolean }`。返回已确认状态。激活要求目标存在且可访问，取消允许清理已有关系；自关注被数据库 CHECK 拒绝。
- `GET /api/me/bookmarks`、`GET /api/me/following` 查看本人关系。私人收藏列表过滤下架文章。文章点赞数按关系表聚合，文章表无点赞、收藏、关注冗余列。
- `article_likes`、`article_bookmarks` 和 `user_follows` 使用组合主键。重复请求以幂等写入保障。评论并发审核与公开读写核验同一数据源。
