# 个人页收藏合集与隐私设计 1.2

个人页面向当前登录用户，汇总其动态、公开作品、点赞、收藏和关注关系。本文定义页面入口、统计口径、列表分页、收藏合集权限和缓存边界，供产品验收、前端实现和接口维护使用。

## 页面结构与路由

个人页使用左侧身份和内容区、右侧统计区。身份区显示昵称、用户名和头像，头像加载失败时使用昵称首字。主内容以标签切换，当前视图和页码保存在 URL 中。窄屏将内容和侧栏纵向排列。[个人页组件](../../apps/web/features/profile/profile.tsx) · [样式](../../apps/web/features/profile/profile.css)

| 路由 | 用途 |
| --- | --- |
| `/me` | 默认显示个人动态 |
| `/me?view=published` | 自己的公开文章 |
| `/me?view=courses` | 自己的公开课程 |
| `/me?view=pulses` | 自己的公开沸点 |
| `/me?view=liked`、`likedPulses` | 当前用户点赞的文章或沸点 |
| `/me?view=bookmarks` | 在个人页主体显示收藏合集 |
| `/me?view=following`、`followers` | 关注用户和关注者 |
| `/me?view=...&page=N` | 相应个人内容的指定页 |
| `/me/bookmarks` | 收藏合集独立浏览入口 |
| `/me/bookmarks?collection=default` | 默认收藏条目 |
| `/me/bookmarks?collection=:id&page=N` | 指定合集条目 |
| `/me/following` | 兼容关注用户入口 |

从个人页的收藏标签切换时，身份和统计区域保留，内容区展示合集。合集条目链接进入独立收藏页，所选合集由 `collection` 查询参数确定。浏览器前进和后退使用 URL 恢复标签、合集和页码。[路由配置](../../apps/web/app/web-app.tsx) · [个人页 URL 生成](../../apps/web/features/profile/profile.tsx)

## 身份和访问权限

会话加载期间显示加载反馈，失败提供会话重试。游客打开个人入口时显示登录链接，登录回跳仅保存当前应用内路径。已登录后，组件以用户 ID 为键重新挂载。会话更新会取消查询并清理会话之外的查询缓存，避免上一账号的列表进入下一账号页面。[会话提供器](../../apps/shared/auth/session.tsx) · [认证弹窗](../../apps/shared/auth/auth-page.tsx)

个人接口从会话读取用户 ID。请求参数只选择视图、页码或当前用户拥有的合集。普通用户和管理员登录后的个人页都按各自身份查询，管理员角色继续通过后台接口执行管理操作。[个人接口](../../apps/api/features/community/interactions.ts)

## 个人资料与统计口径

`GET /api/me/profile` 返回 `avatarUrl`、`joinedAt`、`stats`、`items` 和 `hasMore`。`stats` 包含下列指标。

| 指标 | 计算范围 |
| --- | --- |
| `likes` | 本人已发布文章收到的文章点赞关系总数 |
| `reads` | 本人已发布文章 `view_count` 累计值之和 |
| `following` | 本人关注且账号仍为 `ACTIVE` 的用户数量 |
| `followers` | 关注本人且账号仍为 `ACTIVE` 的用户数量 |

个人成就区显示文章获赞和文章阅读，关系区显示关注和关注者，加入日期来自账号创建时间。文章获赞和阅读统计遵循公开文章范围，沸点点赞与浏览由沸点条目展示。[统计查询](../../apps/api/features/community/interactions.ts) · [Prisma 模型](../../prisma/schema.prisma)

## 视图查询与分页

`GET /api/me/profile?view=...&page=N` 要求登录。`view` 支持 `published`、`courses`、`pulses`、`liked`、`likedPulses`、`bookmarks`、`following` 和 `followers`，省略时使用 `published`。`page` 范围为 1–1000000。每页读取 13 条并返回前 12 条，用额外一条判断 `hasMore`。

| 视图 | 过滤和排序 |
| --- | --- |
| `published` | 当前作者且文章已发布，发布时间、ID 降序 |
| `courses` | 当前作者且课程已发布，发布时间、ID 降序，章节数只统计公开章节 |
| `pulses` | 当前作者且沸点已发布，创建时间、ID 降序 |
| `liked` | 当前用户点赞且文章仍公开，点赞时间、文章 ID 降序 |
| `likedPulses` | 当前用户点赞且沸点仍公开，沸点创建时间、ID 降序 |
| `bookmarks` | 当前用户收藏且文章仍公开，文章发布时间、ID 降序 |
| `following` | 本人关注的有效用户，关系时间、被关注用户 ID 降序 |
| `followers` | 关注本人的有效用户，关系时间、关注者 ID 降序 |

页面使用前一结果作为切换期间的占位数据，同时显示加载状态，防止把上一标签的列表误标为本次完成结果。失败提供重试。每个视图有相应空态文案。分页只在前页或后页存在时出现。[个人 API](../../apps/api/features/community/interactions.ts) · [前台列表](../../apps/web/features/profile/profile.tsx)

## 动态聚合

前台的 `activity` 为默认视图，对应独立的 `GET /api/me/activity`。接口并行读取本人最近的公开文章、公开沸点、有效收藏和关注记录，每类最多 12 条，再合并并按事件时间降序返回最多 12 条。

| 动态类型 | 时间来源 | 展示文案和目标 |
| --- | --- | --- |
| `article` | 文章 `publishedAt` | 发布了文章，进入文章详情 |
| `pulse` | 沸点 `createdAt` | 发布了沸点，进入沸点详情 |
| `bookmark` | 收藏 `createdAt` | 收藏了文章，进入文章详情 |
| `follow` | 关系 `createdAt` | 关注了用户，显示用户资料 |

动态由当前存在的数据聚合。取消收藏或关注后，相应关系产生的动态随查询结果变化。当前动态流用于个人浏览，没有独立事件流水表和全量翻页接口。[动态聚合](../../apps/api/features/community/interactions.ts) · [动态渲染](../../apps/web/features/profile/profile.tsx)

## 收藏合集的数据与流程

### 表设计

`bookmark_collections` 保存合集 UUID、所有者 UUID、名称和创建时间。同一用户下名称唯一。`article_bookmarks` 保存用户、文章、可选合集和最初收藏时间，用户和文章组合主键保证一篇文章在同一用户下归属一个合集。

默认收藏以 `collection_id = NULL` 表示，接口返回 `{ id: null, name: "默认收藏" }`。具名合集通过 `(user_id, collection_id)` 外键约束所属用户。数据库删除合集使用 `NO ACTION` 外键策略，含条目合集的删除需要先定义条目迁移规则。[合集模型](../../prisma/schema.prisma) · [合集迁移](../../prisma/migrations/202611250019_bookmark_collections/migration.sql)

### 合集 API

| 方法和路径 | 请求与响应 | 权限和限制 |
| --- | --- | --- |
| `GET /api/me/bookmark-collections` | 默认合集及具名合集，每项 `id`、`name`、`articleCount` | 当前登录用户，条目数仅统计仍公开文章 |
| `POST /api/me/bookmark-collections` | 请求 `name`，返回 `201` 和合集 `id/name` | 名称 1–60 字符、包含非空白，入库前 trim |
| `GET /api/me/bookmark-collections/:id/articles` | `id` 为 UUID 或 `default`，可带 `page`；返回 `collection`、`items`、`hasMore` | 当前用户所有，页码最多 999999，每页 20 条 |
| `PUT /api/articles/:id/bookmark` | `active` 和可选 `collectionId` | 负责建立、移动或取消关系，详见互动模块 |

默认收藏保留名称用于系统入口。用户创建名为「默认收藏」的合集返回 `400 RESERVED_COLLECTION_NAME`。同一用户重复创建同名合集采用 upsert 返回已有记录。不同用户可以使用相同名称。

合集条目按收藏创建时间和文章 ID 降序读取，最多取 21 条并返回前 20 条。已下架文章从计数及条目中同时过滤。其他用户的合集 ID 返回 `404 COLLECTION_NOT_FOUND`。[合集接口](../../apps/api/features/community/interactions.ts) · [合集组件](../../apps/web/features/bookmarks/bookmark-collections.tsx)

### 前台操作

合集列表可展开新建表单，成功后刷新列表并收起表单。在文章收藏弹窗中创建成功后自动选择新合集。保存和取消收藏完成后刷新个人页、合集计数及合集条目缓存。操作失败保留当前输入或选择。

个人页关注用户条目可取消关注，成功后刷新个人列表、关注关系、作者互动状态和内容流。关注者列表展示关注者资料，当前取消关注入口只出现在本人关注列表。[个人关注操作](../../apps/web/features/profile/profile.tsx) · [收藏操作](../../apps/web/features/engagement/interactions.tsx)

## 隐私与缓存边界

- `/api/me/profile`、`/api/me/activity`、合集、收藏和关注列表均依赖登录用户，服务端不接受任意用户参数切换数据归属。
- 收藏、点赞历史和个人动态在当前个人入口内展示。公开文章与沸点仍通过各自公开接口读取。
- 个人查询返回公开资料和统计，不包含密码散列、会话令牌或内部授权字段。
- 个人页设置禁止存储缓存头。合集、动态、个人收藏和关注接口显式使用 `private, no-store`，账号切换时清理前端私有缓存。
- 公开内容下架后从个人公开作品、收藏、点赞和动态内容查询中排除。已经生成的通知有独立保留策略，详见通知模块。

权限和缓存行为需通过两个账号、游客及响应头共同验证。界面隐藏入口之外，服务端仍独立执行会话与合集所有权校验。[会话管理](../../apps/shared/auth/session.tsx) · [服务端安全逻辑](../../apps/api/shared/security.ts) · [个人查询](../../apps/api/features/community/interactions.ts)

## 错误处理

| 情况 | 行为 |
| --- | --- |
| 会话正在确认 | 保持加载反馈 |
| 个人接口返回 `401` | 引导登录，保留站内目标 |
| 视图、页码或合集 ID 格式错误 | `400`，显示输入错误 |
| 请求他人合集或不存在合集 | `404`，提供回到合集列表的站内入口 |
| 加载失败 | 显示错误与重试，成功后展示当前标签的数据 |
| 新建合集失败 | 保留名称，解除提交禁用 |
| 切换账号 | 清理旧账号查询，重新加载身份与列表 |

## 验收清单

1. 同一用户切换各标签、子标签和页码，URL、选中状态和列表内容保持一致。
2. 浏览器前进、后退及刷新能恢复所选标签，个人页收藏标签保留身份与统计区域。
3. 同一文章新增到合集 A，再移动到默认合集，计数和条目同步变化。
4. 两个账号使用相同合集名各自创建，记录和内容互相隔离。
5. 使用另一个用户的合集 UUID 读取或收藏，返回不可访问且不改变原关系。
6. 文章下架后，个人公开文章、收藏计数、收藏条目和点赞历史同步过滤。
7. 取消关注后，关注列表和个人统计更新，返回文章与沸点时按钮状态一致。
8. 文章获赞和阅读只按本人公开文章汇总，沸点指标不混入文章成就。
9. 退出并换账号后，私有收藏和动态不沿用上一账号结果。
10. 390px 和 320px 下，标签、合集、作者和分页可操作，长标题不撑开页面。

本版本源码具备对应行为，实际执行结果归入版本验收记录。关注与个人关系链路可使用现有浏览器脚本，合集所有权和移动应纳入接口回归。[关注自测](../../scripts/browser-follow.mjs) · [社区链路](../../scripts/browser-community.mjs)

## 1.1 到 1.2 的补充

- 将个人动态、文章、课程、沸点、收藏、关注和赞的视图契约写全。
- 明确「文章获赞」「文章阅读」的统计范围及有效用户过滤。
- 补充默认收藏、具名合集、收藏移动、所有权外键和当前条目分页。
- 记录私有缓存、切换账号、内容下架过滤与跨页面关注同步。

## 后续设计项

当前个人页聚焦当前登录用户。任意作者的公开个人主页、资料编辑、合集重命名和删除、合集共享、动态历史归档需分别增加接口和权限规则。若动态需要保留已经取消的关系事件，应改用独立事件数据模型并定义保留期限。上述项均需与数据库迁移和验收用例一起版本化。
