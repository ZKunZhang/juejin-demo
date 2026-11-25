# PostgreSQL 数据库设计 1.3

## 范围

沿用 Node.js、Fastify、Prisma 和 PostgreSQL。复用 `users.id` 的 UUID 和现有会话权限。扩展模块使用独立迁移追加业务表，保留既有账号和社区数据。数据库备注通过迁移写入。

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
| `projects` | `id`、`author_id`、标题、简介、详情 Markdown、封面地址、项目地址、可空仓库地址、`status`、`version`、创建、更新、最近提交时间（`submitted_at`）与发布时间 | 公开作品须为已发布且具有发布时间。索引 `(status, published_at, id)` 和 `(author_id, updated_at)` |
| `project_categories`、`project_platforms` | `id`、`slug`、名称、展示顺序、启用状态 | 两张目录表各自 slug 唯一 |
| `project_category_links`、`project_platform_links` | `project_id` 与对应目录 ID | 组合主键防重。建立目录 ID 开头的反向索引 |
| `project_likes` | `project_id`、`user_id`、`created_at` | 作品和用户组合主键。点赞数从关系表聚合 |
| `project_view_windows` | `project_id`、`viewer_key`、`window_start` | 组合主键去重。距上次记录满 30 分钟才新增一条；按窗口行计数 |
| `project_reviews` | `id`、`project_id`、`actor_id`、`version`、操作、前后状态、原因、`created_at` | 作品与版本联合唯一。状态更新与审核日志同事务写入 |

作者仅可编辑或提交草稿及已驳回作品，保存内容及更新分类和平台在同一事务。作者保存草稿并提交审核。管理员通过后公开，也可驳回、下架、重新上架或删除。删除是软删除，广场和作者列表立即隐藏，管理员可按已删除状态查询审计记录。状态取值为 `DRAFT`、`PENDING`、`PUBLISHED`、`REJECTED`、`UNLISTED`、`DELETED`。作者和管理员操作均校验版本；公开查询、详情、访问量和点赞均检查作品的公开状态。只接受验证过的 HTTP(S) 外链和 HTTPS 封面。

广场组合分类、平台、发布时间和名称或简介关键词查询。首屏热门作品与主列表使用同一套公开规则。按点赞、浏览或最新排序时附加发布时间和作品 ID 以稳定分页。先用索引与关系聚合，性能有实测需求再添加可重建的计数缓存。后台可按状态和最近提交时间筛选审核。每次提交更新该时间，草稿编辑不改变该时间。

## PostgreSQL 表和字段备注

在创建表与字段的同一份迁移中执行以下 SQL。数据库备注可直接从 PostgreSQL 系统目录读取。新增或改名字段时同步调整对应备注。

```sql
COMMENT ON TABLE ai_providers IS 'AI 模型供应商目录。';
COMMENT ON TABLE ai_models IS '各供应商提供的模型目录及启用状态。';
COMMENT ON TABLE ai_tools IS '产生 AI 用量的客户端和开发工具目录。';
COMMENT ON TABLE ai_model_prices IS '按模型、币种和生效区间维护的历史计价记录。';
COMMENT ON TABLE ai_usage_sources IS '用户授权的用量导入来源及其撤销状态。';
COMMENT ON TABLE ai_usage_events IS '按来源幂等登记的 Token 用量与费用估算记录。';
COMMENT ON TABLE ai_usage_preferences IS '用户的 AI 用量公开偏好，默认不公开排行。';
COMMENT ON TABLE projects IS '作品广场的作品内容、发布状态及版本。';
COMMENT ON TABLE project_categories IS '作品分类目录及展示顺序。';
COMMENT ON TABLE project_platforms IS '作品运行平台目录及展示顺序。';
COMMENT ON TABLE project_category_links IS '作品与分类的多对多关系。';
COMMENT ON TABLE project_platform_links IS '作品与运行平台的多对多关系。';
COMMENT ON TABLE project_likes IS '用户对作品的点赞关系，每个用户对同一作品最多一条。';
COMMENT ON TABLE project_view_windows IS '作品浏览去重记录，同一访问者在同一统计窗口只计一次。';
COMMENT ON TABLE project_reviews IS '作品审核操作及状态变更日志。';

COMMENT ON COLUMN ai_model_prices.effective_from IS '计价生效时间，包含该时刻。';
COMMENT ON COLUMN ai_model_prices.effective_to IS '计价结束时间，不含该时刻；空值表示暂未设定结束时间。';
COMMENT ON COLUMN ai_usage_events.source_event_key IS '导入来源内唯一的事件标识，用于去重。';
COMMENT ON COLUMN ai_usage_events.price_id IS '用量发生时匹配到的计价记录；缺价时为空。';
COMMENT ON COLUMN ai_usage_events.estimated_cost_usd IS '入库时估算的美元费用；无法估算时为空。';
COMMENT ON COLUMN ai_usage_preferences.public_leaderboard IS '用户是否同意公开显示在 AI 用量排行榜，默认关闭。';
COMMENT ON COLUMN projects.status IS '作品流程状态：草稿、待审核、已发布、已驳回、已下架或已删除；已删除作品只保留作后台审计。';
COMMENT ON COLUMN projects.submitted_at IS '最近一次提交审核的时间，保存草稿时保持原值。';
```

## 专家标注

| 表 | 核心字段 | 约束与索引 |
| --- | --- | --- |
| `expert_tasks` | `id`、`title`、`summary`、`instructions`、`status`、`is_demo`、`created_at`、`updated_at` | 公开任务过滤 `OPEN`，用状态、创建时间和 ID 排序。演示标签读取 `is_demo` |
| `expert_annotations` | `task_id`、`user_id`、`status`、`response`、`claimed_at`、`submitted_at` | 任务与用户组合主键。提交要求非空结果和提交时间。按用户、领取时间查询本人记录 |

当前实现允许登录用户领取演示任务，每位用户每任务保留一份提交。重复领取返回原记录，提交成功后保持只读。领取和提交在同一任务行锁下检查开放状态，提交结果只有本人可从接口读取。两个表及每列的中文备注明确写在 PostgreSQL 迁移中。任务分发、专家资格管理及结果复审未接入。

## 演示数据

执行 `ENABLE_DEMO_SEED=true ENABLE_DEMO_V13=true npm run db:seed`，在本地 `_dev` 或 `_test` 库为现有演示账号填充作品、AI 用量及标注任务。种子使用稳定的业务键和 ID，重复执行不产生重复条目，也不覆盖已有排行偏好。

样例作品的外链是占位地址，供应商、模型价格和 Token 均为模拟记录。AI 用量页用于统计展示。排行榜需主动开启公开。
