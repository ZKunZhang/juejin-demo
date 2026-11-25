# PostgreSQL 数据库设计 1.3

## 范围

沿用 Node.js、Fastify、Prisma 和 PostgreSQL。复用 `users.id` 的 UUID 和现有会话权限。此版本交付导航和设计，以下新表、接口和迁移均为待实现。

## AI 用量与模型价格

| 表 | 核心字段 | 约束与索引 |
| --- | --- | --- |
| `ai_providers` | `id`、`slug`、`name` | `slug` 唯一 |
| `ai_models` | `id`、`provider_id`、`model_key`、`name`、`active` | 供应商与模型标识联合唯一 |
| `ai_tools` | `id`、`slug`、`name` | `slug` 唯一 |
| `ai_model_prices` | `id`、`model_id`、`currency`、`effective_from`、`effective_to`、输入、输出、缓存读及缓存写单价、`source_url`、`observed_at` | 单价以每百万 Token 为单位，`numeric(20,8)` 且非负。每模型和币种的生效区间为左闭右开，用 PostgreSQL 排斥约束防重叠 |
| `ai_usage_sources` | `id`、`user_id`、`tool_id`、`label`、`created_at`、`revoked_at` | 撤销后停止导入。客户端接入方式确定后再设计凭证字段 |
| `ai_usage_events` | `id`、`source_id`、`source_event_key`、`model_id`、`occurred_at`、普通输入、未拆分输入、输出、缓存读及缓存写 Token、`price_id`、`estimated_cost_usd` | 来源与事件键联合唯一。Token 使用非负 `bigint`。估算费用用可空 `numeric(24,10)`。索引 `(source_id, occurred_at, id)` 和 `(model_id, occurred_at)` |
| `ai_usage_preferences` | `user_id`、`public_leaderboard`、`updated_at` | 用户主键，公开排行榜默认关闭 |

- 入库时按模型和发生时间匹配美元价格，保存价格引用与费用快照。历史价格保留。修改现价不会回写已完成的估算。缺价时费用为空，前台显示未知，消费榜只纳入费用覆盖完整的统计。
- 统一输入口径。普通输入、缓存读和缓存写按计价口径归一为互斥计数。总 Token 为各互斥输入计数和输出之和。供应商无法拆分时，将无法归类的数量写入未拆分输入，且费用标记未知，避免重复计价。
- 只采集模型、工具、时间和用量。个人接口从会话获取用户，不由客户端声明归属。导入按来源幂等，相同事件键携带不同内容时返回冲突。请求、提示词和模型输出不进入用量账本。
- `occurred_at` 使用 `timestamptz(3)`。用量周期和热力图按 Asia/Shanghai 划分。个人统计按小时、天、工具和模型聚合。初期直接查事件表，出现查询瓶颈后再加日汇总。
- 排行榜仅显示主动公开且有效的账号。支持日、周、月和全部，周一为一周起点。按 Token 或已知消费降序，使用用户 ID 作稳定兜底排序。隐藏自己只影响当前查询。退出公开后下一次读取立即生效。
- 对外 JSON 的累计 Token 与金额使用十进制字符串，避免 JavaScript 数值精度丢失。模型价格列表保留生效时间、币种、单位和来源，缓存单价为空显示未提供。

## 作品广场

| 表 | 核心字段 | 约束与索引 |
| --- | --- | --- |
| `projects` | `id`、`author_id`、标题、简介、详情 Markdown、封面地址、项目地址、可空仓库地址、`status`、`version`、创建、更新、最近提交与发布时间 | 公开作品须为已发布且具有发布时间。索引 `(status, published_at, id)` 和 `(author_id, updated_at)` |
| `project_categories`、`project_platforms` | `id`、`slug`、名称、展示顺序、启用状态 | 两张目录表各自 slug 唯一 |
| `project_category_links`、`project_platform_links` | `project_id` 与对应目录 ID | 组合主键防重。建立目录 ID 开头的反向索引 |
| `project_likes` | `project_id`、`user_id`、`created_at` | 作品和用户组合主键。点赞数从关系表聚合 |
| `project_view_windows` | `project_id`、`viewer_key`、`window_start` | 组合主键去重。访问窗口沿用文章的统计约定 |
| `project_reviews` | `id`、`project_id`、`actor_id`、`version`、操作、前后状态、原因、`created_at` | 作品与版本联合唯一。状态更新与审核日志同事务写入 |

作者保存草稿并提交审核。管理员通过后公开，也可驳回或下架。状态取值为 `DRAFT`、`PENDING`、`PUBLISHED`、`REJECTED`、`UNLISTED`。作者和管理员操作均校验版本；公开查询、详情、访问量和点赞均检查作品的公开状态。只接受验证过的 HTTP(S) 外链和 HTTPS 封面。

广场组合分类、平台、发布时间和名称或简介关键词查询。首屏热门作品与主列表使用同一套公开规则。按点赞、浏览或最新排序时附加发布时间和作品 ID 以稳定分页。先用索引与关系聚合，性能有实测需求再添加可重建的计数缓存。后台可按状态和最近提交时间筛选审核。每次提交更新该时间，草稿编辑不改变该时间。

## 专家标注与实施顺序

专家标注目前只有导航和入口。任务来源、专家资格、分配规则和交付结果的可见范围待明确，首轮数据库迁移不包含标注表。

1. 先实现作品表、作者提交、后台审核和公开广场，再补点赞、浏览和排序。
2. 实现供应商、模型及价格目录，接入有出处的价格记录。
3. 确认用量来源和导入认证，实现幂等事件入库、个人统计和默认关闭的公开榜。
4. 根据确认后的专家标注流程设计任务、分配和结果实体。
