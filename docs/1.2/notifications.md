# 通知与社区排行榜设计 1.2

本文件记录站内通知和社区排行榜的当前实现。通知按登录收件人隔离，排行榜公开展示已发布沸点的作者统计。两者各自查询已有关系和内容数据，前台与后台使用同一 API。[通知接口](../../apps/api/notifications.ts) · [排行榜查询](../../apps/api/pulses.ts)

## 站内通知

### 使用场景与页面

用户关注作者后，作者首次审核公开文章或沸点时生成发布通知。登录用户从顶栏铃铛进入 `/notifications`，按全部通知、文章发布和沸点发布切换。每类显示未读计数，超过 99 显示 `99+`。未读数每 15 秒查询一次，页面按需加载后续通知。[通知界面](../../apps/web/notifications.tsx)

点击未读通知先提交已读，再跳到 `/articles/:id` 或 `/pulses/:id`。已读通知直接跳转。标记失败保留当前页面并展示错误。全部或本类标为已读只作用于当前收件人，成功后失效通知列表和未读计数缓存。[通知交互](../../apps/web/notifications.tsx)

### 数据与生成时机

`notifications` 包含 UUID、`recipient_id`、`actor_id`、`kind`、`target_id`、最多 180 字符的 `preview`、`created_at` 和可空的 `read_at`。通知类型为 `ARTICLE_PUBLISHED / PULSE_PUBLISHED`。收件人与作者外键指向用户，`(recipient_id, kind, target_id)` 唯一，防止对同一收件人重复通知同一内容。[Prisma 模型](../../prisma/schema.prisma) · [通知迁移](../../prisma/migrations/202611250018_follower_notifications/migration.sql)

首次公开的事务内，系统读取已提交的关注关系，筛出启用账号作为收件人，并通过 `INSERT … ON CONFLICT DO NOTHING` 写入通知。正文或标题去除首尾空白后按 Unicode 字符截取 180 个字符作为摘要。文章只在 `APPROVE` 且历史 `publishedAt` 为空时发送，沸点只在 `PENDING → PUBLISHED` 时发送。下架、恢复展示和取关保留历史通知。[通知写入](../../apps/api/notifications.ts) · [文章审核](../../apps/api/moderation.ts) · [沸点审核](../../apps/api/pulse-moderation.ts)

目标 ID 根据通知类型解释，当前没有指向文章或沸点的多态外键。列表保存发布时摘要，内容随后下架时点击会进入对应内容的不可访问状态。历史通知的清理和摘要脱敏策略尚未实现。

### 接口

| 方法与路径 | 参数 | 行为 |
| --- | --- | --- |
| `GET /api/me/notifications/unread` | 会话 | 返回总数及按类型的未读数。 |
| `GET /api/me/notifications` | 可选 `cursor`、`kind` | 每页 20 条，按创建时间和 ID 降序，返回 `items / nextCursor`。 |
| `PUT /api/me/notifications/:id/read` | 通知 UUID | 将本人通知设为已读，204，重复提交保留原已读时间。 |
| `POST /api/me/notifications/read-all` | 可选 `kind` | 本人全部或指定类型未读通知设为已读，204。 |

所有接口要求有效会话，写接口还校验来源与 CSRF。读取响应设置 `private, no-store`。游标编码创建时间与 UUID，解码时校验 ISO 时间与 UUID 格式，无效游标返回 400。访问他人通知的已读接口返回 404。[接口实现](../../apps/api/notifications.ts)

### 索引与验收

收件人、创建时间和 ID 的联合索引用于游标列表。收件人与已读时间索引用于未读统计，作者索引用于关联查询。唯一约束与发布事务共同保证审核重试和并发通过时只生成一份通知。[模型索引](../../prisma/schema.prisma)

验收覆盖首次文章及沸点审核、并发重复审核、未关注用户、作者本人、取关后的新内容、按类型查询和已读、单条及全部已读、他人通知权限、游标加载和未读数同步。测试数据库必须使用独立 `_test` 库。[通知接口测试](../../tests/notifications.integration.test.ts) · [通知浏览器脚本](../../scripts/browser-notifications.mjs)

## 社区排行榜

### 入口与页面

沸点侧栏「社区排行榜」进入 `/pulses/leaderboard`，兼容地址 `/user/center/signrank` 使用同一页面。页面显示作者、排名、已发布沸点数和获赞数，登录用户可看到自己是否在当前榜单。后台 `/admin/leaderboard` 读取同一统计接口，供管理员查看排行。页面分享操作复制当前链接并反馈结果。[前台榜单](../../apps/web/pulses.tsx) · [前台路由](../../apps/web/main.tsx) · [后台榜单](../../apps/admin/pulse-review.tsx)

### 统计定义

`GET /api/pulses/leaderboard` 对 `pulses`、`users` 和 `pulse_likes` 聚合，只统计已发布沸点与启用作者。按获赞数降序、发布沸点数降序、用户 ID 升序排序，最多返回 50 位作者。使用 `count(DISTINCT pulse.id)` 避免多条点赞关系放大作者发帖量。返回每位作者的 `id / displayName / likes / pulses`。[排行榜 SQL](../../apps/api/pulses.ts)

该排行使用累计沸点人气。签到数据由独立 `checkins` 表保存，当前榜单没有按连续签到或日周月区间统计。没有公开沸点的账号不会进入聚合结果。下架内容及其点赞不计入公开榜单，恢复展示后重新参与实时查询。

### 状态与验收

前台使用加载、失败重试、空排行和正常表格四种状态。管理员与普通用户看到同一公开排行数据，登录仅影响个人排名提示。榜单数据由数据库聚合，客户端不增加权威点赞计数。

验收时为同一作者建立多条公开沸点与多位点赞者，核对获赞和去重发布数。并列获赞时核对发布数，再核对 ID 稳定排序。将沸点下架后，详情不可公开访问且榜单统计同步减少。两种角色分别从入口打开和刷新榜单，并验证窄屏表格。[沸点接口测试](../../tests/pulses.integration.test.ts) · [沸点浏览器脚本](../../scripts/browser-pulses.mjs)

## 1.1 到 1.2 的变化

1.1 已记录发布通知和收件人隔离。1.2 补齐具体通知 API、分类未读、20 条游标分页、轮询和单条已读交互，并明确恢复展示不触发新发布通知。社区排行榜在本版形成独立页面和后台入口，写明实际统计范围、并列规则及 50 人上限。

未来若增加签到榜、时间分榜或评论互动通知，需要定义新统计口径或通知类型，并同步扩展接口、模型和验收。
