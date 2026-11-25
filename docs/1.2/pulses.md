# 沸点模块设计 1.2

版本为 1.2，更新日期为 2026 年 11 月 25 日。沸点承载短文字和图片动态，发布后进入审核，审核通过后进入公开信息流。公开互动包括点赞、关注作者、两级评论、评论点赞和浏览计数。

本版按当前源码描述数据和接口，验收项用于核对实现行为。1.1 原始评审资料保存在版本快照中。[1.1 文档快照](../1.1/README.md)

## 页面结构与入口

| 路由 | 页面内容 |
| --- | --- |
| `/pulses` | 左侧话题和社区排行榜入口，中间发布区及推荐、最新、关注信息流，右侧本人签到、精选沸点和推荐话题。 |
| `/pulses#publish` | 登录后将焦点定位到动态输入区。 |
| `/pulses/:id` | 沸点详情、互动、完整评论区和同话题相关推荐。评论锚点为 `#pulse-comments`。 |
| `/pulses/leaderboard` | 独立社区排行榜，展示用户、发布量、获赞和当前用户排名。 |
| `/user/center/signrank` | 进入同一排行榜组件的兼容地址。 |
| `/admin/pulses` | 沸点管理，按状态和创建日期查询，执行审核、下架、恢复和查看评论。 |
| `/admin/pulses/featured` | 管理已发布沸点的精选状态。 |
| `/admin/comments/pulses` | 沸点评论管理，可按沸点、关键词、日期和状态过滤。 |

信息流卡片展示作者、时间、正文、可选图片、话题、点赞和评论入口。详情复用卡片，正文下方放共享评论组件。评论预览限制为前三个一级线程，完整评论通过详情读取。无内容、加载失败和重试反馈放在对应列表区域。[前台页面](../../apps/web/features/pulses/pulses.tsx) [共享评论组件](../../apps/shared/ui/comments.tsx)

图片使用 HTTPS 地址，每条动态最多四张。发布区提供文字、图片地址和单个话题选择。成功提交后清空输入并提示等待审核，失败保留输入。作者的待审、驳回和下架结果通过本人审核记录接口与创作者内容区读取。[发布 API](../../apps/api/features/pulses/pulses.ts) [创作者入口](../../apps/web/features/creator/creator.tsx)

## 数据设计

| 表 | 核心字段和关联 |
| --- | --- |
| `pulses` | UUID、`author_id`、`body`、`images` 数组、`featured`、`view_count`、`status`、`review_reason`、`created_at`。状态默认 `PENDING`。 |
| `pulse_tags` | 沸点和标签的组合主键，标签适用范围为 `PULSE / BOTH`。 |
| `pulse_likes` | 用户和沸点组合主键，保存创建时间。 |
| `pulse_comments` | 沸点、作者、正文、可选父级、`VISIBLE / HIDDEN` 状态和创建时间。 |
| `pulse_comment_likes` | 用户和评论组合主键，一级和二级评论均可点赞。 |
| `pulse_reviews` | 按次追加审核人、原状态、目标状态、原因和时间。 |
| `pulse_comment_reviews` | 按次追加评论管理员、隐藏或恢复前后状态、原因和时间。 |
| `pulse_view_windows` | 沸点加浏览会话摘要的组合主键，保存最近计数时间。 |
| `user_follows` | 与文章作者关注复用的用户关系。 |
| `checkins` | 用户加北京时间自然日的组合主键，每天签到一条。 |

数据库 CHECK 要求正文或图片至少有一项，图片数不超过四张，阅读量非负。API 进一步限制正文最多 2000 字符、图片地址最多 2000 字符、图片地址互不重复，图片协议必须为 HTTPS 且不带用户名或密码。所有作者和审核人引用本地用户。[模型](../../prisma/schema.prisma) [沸点迁移](../../prisma/migrations/202611250009_pulses/migration.sql) [审核迁移](../../prisma/migrations/202611250013_pulse_moderation/migration.sql)

迁移旧数据时将原有动态置为 `PUBLISHED`，随后将新记录默认值改为 `PENDING`。种子数据显式设置已公开状态。这样已有演示动态可以继续阅读，新提交走审核流程。[状态迁移 SQL](../../prisma/migrations/202611250013_pulse_moderation/migration.sql) [种子](../../apps/api/seed.ts)

## 审核与精选状态

| 原状态 | 目标状态 | 操作和要求 |
| --- | --- | --- |
| 新提交 | `PENDING` | 登录用户提交文字或图片，作者取会话。 |
| `PENDING` | `PUBLISHED` | 管理员审核通过，状态更新和审核日志在同一事务。 |
| `PENDING` | `REJECTED` | 管理员驳回，原因必填。 |
| `PUBLISHED` | `UNLISTED` | 管理员下架，原因必填。 |
| `UNLISTED` | `PUBLISHED` | 管理员恢复展示，追加恢复日志。 |

状态操作携带 `expectedStatus`，实际状态不一致返回 409。首次从待审公开时，给当前关注作者的用户发送发布通知。恢复展示保留原点赞、评论和历史审核日志，恢复时不再次生成发布通知。当前接口没有驳回内容编辑后重新提交的动作。[审核实现](../../apps/api/features/pulses/pulse-moderation.ts)

精选是独立布尔字段。只有已发布沸点可设为或取消精选，写请求同时提交 `expectedFeatured` 和目标值。下架后即使保留精选值，公开精选列表也会因发布状态过滤该内容。后台筛选可以查询未精选和已精选内容。[精选 API](../../apps/api/features/pulses/pulse-moderation.ts)

## 公开读取和排序

| 区域 | 当前规则 |
| --- | --- |
| 推荐流 | 已发布内容，先精选，再按沸点点赞关系数、创建时间、ID 降序，最多 50 条。 |
| 最新流 | 已发布内容，按创建时间和 ID 降序，最多 50 条。 |
| 关注流 | 当前用户已关注作者的已发布内容，按创建时间和 ID 降序，最多 50 条。游客返回 401。 |
| 精选区 | 已发布且 `featured=true`，最多 5 条。 |
| 话题 | 标签范围允许沸点，话题计数只统计公开沸点。 |
| 推荐话题 | 前台按公开沸点数从高到低取 5 项，零内容话题不进入推荐。 |
| 相关推荐 | 同话题公开内容，排除当前 ID，按点赞数、时间和 ID 降序取 5 条。 |
| 排行榜 | 活跃作者的公开沸点获赞数降序，同分再按公开发布数降序，最后按用户 ID 升序，最多 50 人。 |

榜单直接聚合沸点点赞关系。榜单获赞统计与评论点赞分开计算。用户可复制排行榜地址，登录后显示当前用户在返回榜单中的名次。未进入前 50 的用户显示未上榜。[沸点读取](../../apps/api/features/pulses/pulses.ts) [排行榜页面](../../apps/web/features/pulses/pulses.tsx)

## 接口契约

| 接口 | 参数或正文 | 响应与权限 |
| --- | --- | --- |
| `GET /api/pulses/topics` | 无 | 话题及公开沸点数量，游客可读。 |
| `GET /api/pulses` | `tab`、可选 `tagId` | 沸点数组，默认推荐。响应含当前用户的点赞和关注状态。 |
| `GET /api/pulses/:id` | UUID | `{pulse,related}`，仅公开内容。 |
| `POST /api/pulses` | `body`、`images`，可选 `tagId` | 新待审动态，HTTP 201，登录用户。 |
| `GET /api/me/pulses/reviews` | 无 | 本人最近 20 条待审、驳回或下架记录。 |
| `PUT /api/pulses/:id/like` | `{active:boolean}` | `{active}`，仅登录用户操作公开动态。 |
| `POST /api/pulses/:id/views` | 无业务正文 | `{viewCount}`，同浏览会话 30 分钟内去重。 |
| `GET /api/pulses/leaderboard` | 无 | 最多 50 位作者的 ID、昵称、点赞数和发布数。 |
| `GET /api/me/checkin` | 无 | `{checked}`，登录用户。 |
| `POST /api/me/checkin` | 无业务正文 | `{checked:true}`，同日重复提交不新增。 |
| `GET /api/admin/pulses` | `status`、`featured`、`page`、`from`、`to` | `{items,hasMore}`，每页 30，管理员。 |
| `PATCH /api/admin/pulses/:id/status` | `expectedStatus`、`status`、可选 `reason` | `{id,status}`，管理员。 |
| `PATCH /api/admin/pulses/:id/featured` | `expectedFeatured`、`featured` | `{id,featured}`，管理员。 |

公开信息流、详情和评论带 `private, no-store`，因为其中包含当前会话的点赞和关注状态。全部写操作执行请求来源与 CSRF 校验，公开写入还会在事务内锁定已发布动态，防止与下架竞争。[沸点 API](../../apps/api/features/pulses/pulses.ts) [权限组件](../../apps/api/shared/security.ts)

后台 `from / to` 按北京时间日历日期过滤创建时间，结束日包含当天。日期不合法或结束早于开始时返回 400。[日期过滤](../../apps/api/shared/admin-date-range.ts)

## 评论、回复和点赞

沸点详情的评论使用共享 `CommentSection`，显示作者、时间、正文、点赞数和回复。每条一级评论默认显示两条已返回回复，可展开，点击任何回复的回复入口仍关联原一级评论。本人可以回复本人。输入上限 2000 字符，发送期间防重复，失败保留草稿。[评论组件](../../apps/shared/ui/comments.tsx)

| 接口 | 行为 |
| --- | --- |
| `GET /api/pulses/:id/comments?page=1&sort=hot` | 一级评论按点赞数、时间和 ID 降序。每页显示 20，接口多取 1 条用于判断下一页。 |
| `GET /api/pulses/:id/comments?page=1&sort=latest` | 一级评论按创建时间和 ID 降序，同样分页。 |
| `GET /api/pulses/:id/comments` | 兼容已有调用，取最近 100 条一级评论并按时间顺序返回。 |
| `POST /api/pulses/:id/comments` | `{body,parentId?}`，作者取会话。父评论必须是当前沸点可见的一级评论。 |
| `PUT /api/pulses/:id/comments/:commentId/like` | `{active:boolean}`，返回 `{liked,likeCount}`，重复激活不重复计数。 |
| `GET /api/admin/pulse-comments` | 按状态、`pulseId`、`q`、日期和页码读取，返回 `{items,hasMore}`。 |
| `GET /api/admin/pulse-comments/sources` | 可选 `q`，返回有评论的候选沸点 ID 和标签，供后台搜索选择。 |
| `PATCH /api/admin/pulse-comments/:id/status` | 管理员携带预期状态隐藏或恢复，隐藏需原因，事务内追加日志。 |

公开沸点评论计数包含可见的一级评论及父级可见的二级回复，后台沸点列表包含全部评论数。每个一级线程取最近 20 条可见回复后按时间顺序显示。隐藏父评论会使整个线程从公开读取和可见评论总数消失。回复和评论点赞写入检查沸点、目标评论及父评论可见，内容下架后这些操作返回 404。[评论 API](../../apps/api/features/pulses/pulses.ts) [后台评论 API](../../apps/api/features/pulses/pulse-moderation.ts)

数据库触发器拒绝跨沸点、自引用和第三层回复，并固定评论 ID、所属沸点及父级。审核仅改可见状态。沸点删除时保留迁移定义的级联语义。[线程约束迁移](../../prisma/migrations/202611250020_comment_thread_integrity/migration.sql)

## 浏览计数与关注同步

卡片作者区域至少有 25% 进入视口、页面可见并持续 1 秒后，前台请求浏览计数。后台按沸点和浏览会话摘要保存窗口，在事务中核对已发布状态并执行 30 分钟去重。前端失败后仅作一次安全重试，关系窗口保证重试不会重复增加。[卡片曝光](../../apps/web/features/pulses/pulses.tsx) [计数 API](../../apps/api/features/pulses/pulses.ts)

文章作者卡片与沸点卡片共用关注关系。关注或取关成功后刷新文章互动状态、本人关注列表、个人统计、沸点列表、详情和精选缓存，换账号时清理私有缓存。[关注缓存同步](../../apps/web/features/engagement/follow-cache.ts) [会话管理](../../apps/shared/auth/session.tsx)

## 错误与验收

| 场景 | 预期 |
| --- | --- |
| 空正文加空图片、HTTP 图片或文章专属话题 | 返回 400，发布区保留输入。 |
| 游客发布、关注流或互动写入 | 返回 401，并通过页面登录入口回到原操作位置。 |
| 普通用户调用审核或评论管理 | 返回 403。 |
| 待审、驳回或下架内容公开读取 | 返回 404，公开话题和榜单均排除。 |
| 管理员两次提交同一预期状态 | 首次成功，旧状态返回 409，日志只记录成功动作。 |
| 两用户分别点赞或关注 | 关系独立，重复激活不增加记录，取消只影响本人。 |
| 第一层与二级回复混合并点赞 | 作者归属正确，不能跨沸点或形成第三层。 |
| 热度和时间顺序不同 | 最热与最新有不同的结果顺序，翻页及切换条件重置到第一页。 |
| 隐藏、恢复一级评论 | 线程、回复和公开评论计数一致。 |
| 下架后恢复展示 | 内容及原互动重新可读，追加恢复日志，发布通知不重复发送。 |
| 窄屏和多个评论预览同时展开 | 无横向溢出，输入 ID 和草稿彼此独立。 |

这些验收可使用真实数据库接口测试和浏览器流程执行，演示填充数据应保留在开发库。[沸点接口测试](../../tests/pulses.integration.test.ts) [沸点浏览器流程](../../scripts/browser-pulses.mjs) [关注回归](../../scripts/browser-follow.mjs)

## 版本变化与后续范围

相较 1.1 快照，本版详细记录了沸点审核状态、恢复展示、精选管理、浏览窗口、公开数量口径、独立排行榜、两级评论、评论点赞和排序分页。本轮数据库审查新增评论层级触发器，并使恢复动作沿用现有审核日志且不重复发送通知。

信息流目前最多返回 50 条，精选区最多 5 条，排行榜最多 50 人。二级回复最多取最近 20 条。驳回内容的编辑重提、图片上传和更早回复的分页仍需后续明确接口与状态，当前图片输入使用外部 HTTPS 地址。
