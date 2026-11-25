# 点赞收藏关注与签到设计 1.2

本文记录文章、沸点和用户之间的互动关系，供接口实现、数据维护和联调验收使用。评论自身的点赞、回复及审核见[评论模块](./comments.md)，个人页的展示与合集浏览见[个人页与隐私](./profiles.md)。

## 能力和入口

| 能力 | 前台入口 | 保存方式 |
| --- | --- | --- |
| 文章点赞 | 文章详情操作区 | 当前用户与文章的关系 |
| 沸点点赞 | 沸点列表卡片、沸点详情 | 当前用户与沸点的关系 |
| 文章收藏 | 文章详情收藏按钮与收藏弹窗 | 当前用户、文章及可选合集 |
| 关注作者 | 文章作者区、沸点作者区 | 关注者与被关注者的方向关系 |
| 取消关注 | 作者区、个人页关注用户列表 | 删除当前关注者的对应关系 |
| 每日签到 | 沸点页右栏「我的沸点」 | 用户与北京时间自然日的关系 |

写接口提交期望状态，例如 `{ "active": true }` 表示希望处于已点赞或已关注状态。用户重复点击或请求重试时，组合主键和去重插入保证关系最多一条。页面成功后读取或更新服务端确认状态。[互动接口](../../apps/api/features/community/interactions.ts) · [沸点互动](../../apps/api/features/pulses/pulses.ts)

## 数据表与约束

| 表 | 主键或唯一约束 | 数据含义 |
| --- | --- | --- |
| `article_likes` | `(user_id, article_id)` | 文章点赞用户和时间 |
| `pulse_likes` | `(user_id, pulse_id)` | 沸点点赞用户和时间 |
| `article_bookmarks` | `(user_id, article_id)` | 一篇文章在同一用户下只有一条收藏，可关联一个合集 |
| `bookmark_collections` | `id`，`(user_id, name)` 唯一，`(user_id, id)` 唯一 | 用户自建合集及创建时间 |
| `user_follows` | `(follower_id, followee_id)` | 关注方向和创建时间 |
| `checkins` | `(user_id, local_date)` | 每个用户每天一条签到记录 |

收藏记录的 `(user_id, collection_id)` 组合外键引用合集中相同的两个字段，数据库保证收藏所指合集属于该用户。`collection_id` 为空时表示默认收藏。`user_follows_no_self` 检查约束禁止自关注，应用层也返回对应错误。各目标表具有目标 ID 在前的关系索引，便于聚合数目和反向查询。[Prisma 模型](../../prisma/schema.prisma) · [基础互动迁移](../../prisma/migrations/202611250004_interactions/migration.sql) · [合集迁移](../../prisma/migrations/202611250019_bookmark_collections/migration.sql)

本版本用显式索引映射记录 PostgreSQL 已有的收藏复合索引名称，避免模型比较时仅因名称生成差异产生重命名操作。[索引映射](../../prisma/schema.prisma)

## 接口契约

| 方法和路径 | 主要请求 | 响应 |
| --- | --- | --- |
| `GET /api/articles/:id/interaction` | 文章 UUID | `liked`、`bookmarked`、`collectionId`、`following` |
| `PUT /api/articles/:id/like` | `active` 布尔值 | `{ active }` |
| `PUT /api/pulses/:id/like` | `active` 布尔值 | `{ active }` |
| `PUT /api/articles/:id/bookmark` | `active`，可选 `collectionId` | `{ active }` |
| `PUT /api/users/:id/follow` | `active` 布尔值 | `{ active }` |
| `GET /api/me/following` | 当前会话 | 最多 100 个有效被关注用户 |
| `GET /api/me/bookmarks` | 当前会话 | 最多 100 篇仍公开的收藏文章 |
| `GET /api/me/checkin` | 当前会话 | `{ checked }` |
| `POST /api/me/checkin` | 当前会话 | `{ checked: true }` |

文章互动状态、个人收藏和关注列表均由当前会话确定用户，这三类读取设置 `Cache-Control: private, no-store`。写接口要求来源、CSRF 和已登录会话，客户端禁止通过请求指定实际写入者。[互动接口](../../apps/api/features/community/interactions.ts) · [签到接口](../../apps/api/features/pulses/pulses.ts) · [公共写保护](../../apps/api/app/app.ts)

## 文章与沸点点赞

### 文章点赞流程

1. 进入详情后，登录用户请求文章互动状态。
2. 点击点赞时提交 `{ active: true }`。服务端在事务内锁定已发布文章，再去重写入点赞关系。
3. 点击取消提交 `{ active: false }`，只删除本人的关系。
4. 前端使用返回状态更新操作按钮，并使文章详情、列表和个人数据查询失效。

文章新增点赞要求公开状态。取消文章点赞通过关系删除完成，支持清理原先对已下架文章的关系。点赞总数从关系表聚合，页面不以点击次数累加权威统计。[文章调用和缓存刷新](../../apps/web/features/engagement/interactions.tsx)

### 沸点点赞流程

列表和详情响应已经携带 `liked`、`following` 与点赞总数。点赞和取消都在事务内确认并锁定已发布沸点，再写入或删除关系。下架沸点的点赞写入返回不可访问。成功后刷新沸点列表、详情和排行榜查询。[沸点接口](../../apps/api/features/pulses/pulses.ts) · [沸点前台](../../apps/web/features/pulses/pulses.tsx)

## 收藏和合集选择

文章收藏弹窗读取当前账号的合集，包含默认收藏。用户可以选已有合集、在弹窗中创建新合集、保存归属或取消收藏。提交期间禁用选择和重复操作，失败在弹窗中显示并保留当前选择。合集和弹窗 UI 复用 `AppSelect`，弹层挂载到所属对话框以支持原生模态窗口。[收藏弹窗](../../apps/web/features/bookmarks/bookmark-collections.tsx) · [共享选择器](../../apps/shared/ui/select.tsx)

`collectionId` 的三种输入有明确语义。

| 请求 | 行为 |
| --- | --- |
| `active=false` | 删除当前用户对该文章的收藏，附带合集参数不影响删除范围 |
| `active=true`，省略 `collectionId` | 幂等建立默认关系，已有收藏保留原归属，兼容原调用 |
| `active=true`，`collectionId=null` | 新增或移动到默认收藏 |
| `active=true`，传合集 UUID | 验证该合集属于当前用户，新增或移动收藏 |

收藏建立或移动前检查文章公开状态。文章与合集归属写入在同一事务完成，组合外键再次约束所有权。更新已有收藏合集时保留收藏最初创建时间。合集创建和列表权限见[个人页与隐私](./profiles.md)。[收藏写接口](../../apps/api/features/community/interactions.ts)

## 关注作者和关注流

关注以当前会话作为 `follower_id`，路由中的用户 ID 作为 `followee_id`。新增关注先锁定状态为 `ACTIVE` 的目标用户，再执行去重插入。取消关注只删除这一对关系。自关注返回 `400 SELF_FOLLOW`，目标不可用返回 `404`。

前台在本人作者区隐藏关注入口。文章、沸点和个人页取消关注完成后，需要同时更新作者互动状态、关注列表、个人统计、沸点关注流和详情。共享刷新函数使 `interaction`、`following`、`profile`、`pulses`、`featured-pulses`、`pulse-detail` 查询失效，避免从文章关注后返回旧的沸点关注流。[缓存刷新](../../apps/web/features/engagement/follow-cache.ts) · [文章入口](../../apps/web/features/engagement/interactions.tsx) · [沸点入口](../../apps/web/features/pulses/pulses.tsx)

文章和沸点关注流只读取当前用户关注作者的公开内容。首次审核公开内容时，通知模块根据当时已提交的关注关系生成站内通知。取消关注后历史通知继续保留，内容重新上架遵循各模块的通知去重规则。[文章列表](../../apps/api/features/articles/articles.ts) · [沸点列表](../../apps/api/features/pulses/pulses.ts) · [通知生成](../../apps/api/features/community/notifications.ts)

## 每日签到

服务端使用 `Asia/Shanghai` 计算当前自然日，再存为数据库 `date` 字段。每次签到采用 `createMany` 并跳过重复关系，同一用户并发签到最终只有一行。按钮状态从签到查询和写入响应确定，成功后显示「今日已签到」并禁用当前日的重复提交。查询或写入失败显示重试反馈。[日期计算与签到](../../apps/api/features/pulses/pulses.ts) · [签到组件](../../apps/web/features/pulses/pulses.tsx)

## 错误和状态一致性

| 场景 | 服务端结果 | 前台处理 |
| --- | --- | --- |
| 游客写互动 | `401` | 引导登录并回到站内原位置 |
| 请求来源或 CSRF 无效 | `403` | 显示请求失败，保持最后确认状态 |
| `active` 类型或 UUID 无效 | `400` | 展示校验错误 |
| 目标已不可访问、合集属于其他人 | `404` | 提示目标不可用，保留原收藏或操作状态 |
| 自关注 | `400 SELF_FOLLOW` | 显示错误，数据库无新增关系 |
| 网络失败 | 客户端连接错误 | 可重试，界面恢复上次确认状态 |

当前关系写入保证每个用户目标对唯一。相反的期望状态并发提交时，最终状态以服务端提交结果和后续读取为准。页面对进行中的操作做禁用，并在成功后失效相关查询。[客户端请求与错误解析](../../apps/shared/api/api.ts) · [统一会话](../../apps/shared/auth/session.tsx)

## 验收清单

- 两名用户分别点赞同一文章或沸点，数据库两条关系，取消只影响本人。
- 同一用户重复提交激活状态，计数保持一条。
- 将收藏从默认合集移动到具名合集，两个合集计数与实际条目同步。
- 尝试使用另一个用户的合集 ID，接口拒绝且原关系保持。
- 先打开关注流，再到文章关注作者，回到关注流能看到其公开内容。
- 从沸点取消关注，再回到此前打开的文章，作者按钮显示可关注。
- 刷新、退出和换账号后，关注、收藏及点赞状态按当前账号隔离。
- 同一天两次和并发签到均只产生一条记录，跨北京时间日期后允许新签到。
- 检查个人状态和列表读取的缓存响应头，确认标为私有且禁止存储。

相关可执行链路保存在关注脚本、社区脚本和沸点接口测试中。执行次数、环境和结果写入同版本验收记录。[关注脚本](../../scripts/browser-follow.mjs) · [社区脚本](../../scripts/browser-community.mjs) · [沸点接口测试](../../tests/pulses.integration.test.ts)

## 1.1 到 1.2 的补充

- 记录文章收藏合集的归属、默认合集和移动语义。
- 明确文章与沸点点赞在下架后的不同写入路径。
- 将跨页面关注状态同步和个人列表缓存策略写入验收规则。
- 补充签到的北京时间自然日和并发幂等行为。

## 后续设计项

收藏合集重命名、删除和共享需要补充对应接口及条目处理规则。个人收藏和关注的兼容读取接口各有 100 条上限，更大数据量需要使用个人页分页或扩展独立分页契约。签到奖励、连续签到和积分尚需独立业务模型与结算规则。
