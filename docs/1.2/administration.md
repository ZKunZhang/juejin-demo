# 管理后台设计 1.2

管理后台通过独立 React 入口管理文章、沸点、评论和活动，共用前台的身份、API 与 PostgreSQL。后台列表和写操作均在服务端检查 `ADMIN`，页面入口依据当前会话显示加载、登录、无权限或管理界面。[后台入口](../../apps/admin/main.tsx) · [权限实现](../../apps/api/shared/security.ts)

## 页面结构

| 页面 | 主要用途 |
| --- | --- |
| `/admin/articles` | 按公开状态、审核状态和创建日期查看文章，打开审核详情和操作记录。 |
| `/admin/articles/:id` | 阅读正文、审核通过、驳回、下架、重新上架和管理所选文章评论。 |
| `/admin/comments` | 文章评论管理，支持来源文章、状态、关键词和创建日期筛选。 |
| `/admin/comments/pulses` | 沸点评论管理，支持来源沸点、状态、关键词和创建日期筛选。 |
| `/admin/pulses` | 沸点审核、下架与恢复展示。 |
| `/admin/pulses/featured` | 已发布沸点的精选配置。 |
| `/admin/activities` | 活动列表和展示配置。 |
| `/admin/activities/new`、`/admin/activities/:id` | 创建或编辑活动并预览卡片。 |
| `/admin/leaderboard` | 查看社区排行榜及用户排名信息。 |

列表以 30 条为一页，多取一条判断 `hasMore`。切换筛选条件重置页码。日期筛选按北京时间自然日解释 `from / to`，结束日包含整天，数据库查询转换为左闭右开的时间范围。无效日期或结束早于开始返回 400。[日期边界实现](../../apps/api/shared/admin-date-range.ts)

## 文章审核

文章同时保存公开状态、审核状态和整数版本。每次操作按客户端版本与当前状态共同匹配，成功后版本加一，并在同一事务追加 `article_review_logs`。并发旧版本返回 409。正文展示复用前台 Markdown 渲染规则。[文章审核实现](../../apps/api/features/articles/moderation.ts)

| 动作 | 原状态 | 结果 | 必要条件 |
| --- | --- | --- | --- |
| 提交审核 | `DRAFT` 且未提交或已驳回 | `DRAFT + PENDING` | 作者本人，标题与正文非空。 |
| 审核通过 | `DRAFT + PENDING` | `PUBLISHED + APPROVED` | 管理员，设置发布时间。 |
| 驳回 | `DRAFT + PENDING` | `DRAFT + REJECTED` | 管理员，填写原因。 |
| 下架 | `PUBLISHED + APPROVED` | `UNLISTED + APPROVED` | 管理员，填写原因。 |
| 重新上架 | `UNLISTED + APPROVED` | `PUBLISHED + APPROVED` | 管理员，携带当前版本。 |
| 转回草稿 | `UNLISTED + APPROVED` | `DRAFT + NOT_SUBMITTED` | 作者本人。 |

后台接口包括 `GET /api/admin/articles`、`GET /api/admin/articles/:id`、`POST /api/admin/articles/:id/review`、`POST /api/admin/articles/:id/unlist` 和 `POST /api/admin/articles/:id/relist`。审核体包含 `version` 和 `action`，驳回及下架包含 `reason`。来源、CSRF 和管理员校验在写操作前完成。首次通过审核时通知当前粉丝，重新上架保留历史通知。[文章审核接口](../../apps/api/features/articles/moderation.ts)

## 沸点审核与精选

`pulses.status` 使用 `PENDING / PUBLISHED / REJECTED / UNLISTED`。创建沸点默认待审核，旧公开数据迁移为已发布。后台写入携带 `expectedStatus` 和目标 `status`，只更新与预期一致的行，成功后在同一事务追加 `pulse_reviews`。[审核迁移](../../prisma/migrations/202611250013_pulse_moderation/migration.sql) · [沸点审核接口](../../apps/api/features/pulses/pulse-moderation.ts)

| 迁移 | 原因要求 | 公开效果 |
| --- | --- | --- |
| `PENDING → PUBLISHED` | 可选 | 进入公开列表，首次公开通知粉丝。 |
| `PENDING → REJECTED` | 必填 | 保留内容和拒绝原因，作者可在自己的记录中查看。 |
| `PUBLISHED → UNLISTED` | 必填 | 公开详情、评论读取及新增互动停止开放。 |
| `UNLISTED → PUBLISHED` | 可选 | 恢复原内容、评论和点赞，追加恢复记录。 |

`GET /api/admin/pulses` 支持状态、精选、页码和创建日期。`PATCH /api/admin/pulses/:id/status` 更新审核状态，原记录不存在返回 404，预期状态失效返回 409。恢复展示只恢复公开状态，发布通知仅在 `PENDING → PUBLISHED` 时生成。[沸点状态实现](../../apps/api/features/pulses/pulse-moderation.ts)

精选操作通过 `PATCH /api/admin/pulses/:id/featured` 提交 `{ expectedFeatured, featured }`，目标必须已发布。状态冲突或旧精选状态返回 409。精选标志保存在沸点行，独立审核记录覆盖审核状态变化。[精选界面](../../apps/admin/features/pulses/pulse-review.tsx)

## 评论管理

文章评论与沸点评论使用独立列表和独立状态接口。来源搜索先查询有评论的文章或沸点，列表可携带 `articleId / pulseId` 精确限定来源，也支持评论正文和来源内容关键词。所有查询与写入都要求管理员角色。[文章评论管理](../../apps/api/features/articles/moderation.ts) · [沸点评论管理](../../apps/api/features/pulses/pulse-moderation.ts)

| 类型 | 查询 | 隐藏或恢复 |
| --- | --- | --- |
| 文章评论 | `GET /api/admin/comments`，来源为 `/sources` 子路径 | `PATCH /api/admin/comments/:id/status` |
| 沸点评论 | `GET /api/admin/pulse-comments`，来源为 `/sources` 子路径 | `PATCH /api/admin/pulse-comments/:id/status` |

状态体包含 `expectedStatus`、`status` 和可选 `reason`。隐藏必须填写原因，恢复允许空原因，相同状态提交返回 400。成功后在同一事务更新状态并追加 `comment_moderation_logs` 或 `pulse_comment_reviews`，旧状态返回 409。列表区分一级评论与回复，父评论隐藏后，仍可见的子回复在前台受父级可见性约束。[评论模型](../../prisma/schema.prisma)

审核列表复用 `CommentMessage` 展示作者、正文和元信息。管理操作使用独立控件，前台输入、点赞和回复逻辑由 `CommentSection` 承担。[共享评论组件](../../apps/shared/ui/comments.tsx) · [后台评论界面](../../apps/admin/features/comments/comment-review.tsx)

## 活动管理

`activities` 保存标题、摘要、外链、HTTPS 封面、状态、展示顺序、展示区间、最后编辑管理员、版本及时间戳。标题最多 120 字符，摘要最多 300，排序范围为 0–9999。活动地址接受无账号密码的 HTTP 或 HTTPS，封面接受无账号密码的 HTTPS。[活动接口](../../apps/api/features/activities/activities.ts)

公开 `GET /api/activities` 只返回已发布、处于展示时段的最多五条活动，按排序值和 ID 升序。展示区间为开始包含、结束排除，空边界表示无界。两端都有值时结束须晚于开始。[活动读取](../../apps/api/features/activities/activities.ts)

后台提供 `GET/POST /api/admin/activities`、`GET/PATCH /api/admin/activities/:id`。编辑携带 `version`，条件更新成功后版本加一。冲突保留输入并允许重新加载。编辑页提供内容、展示设置和卡片预览，封面预览使用防抖后的地址。[活动编辑页](../../apps/admin/features/activities/activities.tsx)

## 错误与一致性

400 用于参数和非法迁移，401 用于失效会话，403 用于权限、来源或 CSRF，404 用于记录不存在，409 用于版本或状态已变化。页面在失败时保留原因和编辑内容，并提供刷新入口。操作按钮在请求中禁用。公开读写通过内容状态校验，点赞和评论写入事务锁定已公开目标，避免审核下架期间新增公开互动。[沸点互动](../../apps/api/features/pulses/pulses.ts) · [文章互动](../../apps/api/features/community/interactions.ts)

## 验收

- 游客和普通用户无法读取管理列表或执行审核，伪造前端入口不改变服务端权限。
- 两个管理员携带同一版本或旧预期状态操作，只有一次成功并只产生一条对应操作记录。
- 文章和沸点完整走通通过、下架和恢复，恢复保留原互动，粉丝没有重复发布通知。
- 文章评论与沸点评论的来源、搜索、状态、日期和分页组合查询正确，两个列表不会串用记录。
- 隐藏父评论后公开列表和计数一致，恢复父评论继续遵守子回复独立审核状态。
- 活动时间边界、封面地址、旧版本冲突、排序和游客展示均按数据库记录验证。

现有验证入口覆盖角色、审核、日期和互动链路，执行结果由测试记录补充。[日期测试](../../tests/admin-dates.integration.test.ts) · [活动测试](../../tests/activities.integration.test.ts) · [沸点测试](../../tests/pulses.integration.test.ts) · [浏览器审核脚本](../../scripts/browser-community.mjs)

## 1.1 到 1.2 的变化

1.2 将总设计中的独立管理后台细化为文章、沸点、两类评论、精选和活动的真实路由及接口，补齐状态冲突、日期边界和来源搜索。新增沸点恢复展示路径，恢复事务追加操作记录并保留互动。数据库层增加两级评论归属约束，审核状态变更仍可正常执行。

课程章节评论目前提供公开读取和登录发表。后台现有评论分类覆盖文章和沸点，课程章节评论的审核列表和日志尚未接入。
