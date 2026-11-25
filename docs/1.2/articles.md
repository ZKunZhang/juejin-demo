# 文章模块设计 1.2

版本为 1.2，更新日期为 2026 年 11 月 25 日。本模块面向文章阅读、作者写作和管理员内容治理。公开内容、作者私有草稿、审核队列分别使用对应的读取入口，文章状态和审核状态共同控制写入权限。

本版按当前源码和迁移说明实现契约。验收用例列出需要执行的检查，执行结果由本版验证记录汇总。[1.1 文档快照](../1.1/README.md)

## 页面与交互

| 入口 | 用途与主要交互 |
| --- | --- |
| `/` | 左侧标签筛选，中间文章流，右侧活动。支持推荐、最新、关注、关键词和下一页。标签、排序和搜索条件保存在 URL。 |
| `/articles/:id` | 展示标题、作者、时间、阅读及互动统计、Markdown 正文、目录、相关推荐和评论。操作区提供点赞、收藏、评论定位和分享。 |
| `/creator` | 创作者概览，汇总本人公开内容的互动数据并提供写作入口。 |
| `/creator/articles` | 本人的全部文章，显示草稿、待审核、驳回、已发布和已下架状态。 |
| `/creator/articles?status=draft` | 草稿箱，仅列出可继续编辑的未提交和已驳回草稿。 |
| `/creator/articles/new` | 新建文章，支持 Markdown 编辑、预览、快捷插入、保存草稿和提交审核。 |
| `/creator/articles/:id/edit` | 读取本人文章及版本。待审、已发布和下架内容进入只读展示，下架内容可按状态规则转回草稿。 |
| `/admin/articles` | 管理员筛选文章、打开处理弹窗、审核、下架、恢复和查看评论。 |
| `/admin/articles/:id` | 管理员读取文章及最近的审核记录。 |

编辑器在宽屏支持编辑和预览并排，也可切到单独编辑或预览。成功保存新草稿后进入包含 ID 的编辑地址。请求失败保留当前输入，版本冲突提示刷新处理。公开 Markdown 与编辑预览复用渲染器，正文标题生成唯一锚点，中文和重复标题使用同一编号规则。原始 HTML 跳过，链接仅保留允许的协议或站内路径。[文章前台](../../apps/web/features/articles/articles.tsx) [Markdown 渲染器](../../apps/shared/ui/markdown.tsx)

游客打开公开文章可阅读正文与评论。点赞、收藏、关注和发表评论需要登录，登录入口使用弹窗并保留站内回跳目标。作者卡片对本人隐藏关注入口，已有关注、收藏和点赞状态由当前会话接口返回。[互动组件](../../apps/web/features/engagement/interactions.tsx)

## 文章数据与关联

| 表 | 字段及约束 |
| --- | --- |
| `articles` | UUID 主键，`author_id`、标题、摘要、`body_markdown`、`status`、`review_status`、`version`、`view_count`、发布时间与创建及更新时间。 |
| `article_tags` | 文章和标签的组合主键。写入时只接受 `ARTICLE` 或 `BOTH` 标签，最多 10 个且不可重复。 |
| `article_review_logs` | 文章、操作人、操作前版本、动作、前后公开状态、前后审核状态、原因和时间。文章加操作前版本唯一。 |
| `article_likes` | 用户和文章的组合主键。点赞按目标状态写入，重复激活不产生第二条记录。 |
| `article_bookmarks` | 用户和文章的组合主键，可选 `collection_id`。合集归属由用户和合集 ID 的组合外键约束。 |
| `article_view_windows` | 文章和浏览会话摘要的组合主键，记录最近计数时间。 |
| `comments` | 文章评论，含作者、可选父评论、正文、可见状态和时间。 |
| `comment_likes` | 用户和评论的组合主键。 |
| `comment_moderation_logs` | 隐藏和恢复评论时追加管理员、前后状态、原因和时间。 |

数据库检查 `version > 0`、阅读量非负，以及公开文章必须有发布时间且审核状态为 `APPROVED`。文章列表索引覆盖公开状态与发布时间、作者与更新时间、审核状态与更新时间。字段类型和外键以 Prisma 模型与迁移共同为准，数据库 CHECK 及触发器由 SQL 迁移维护。[Prisma 模型](../../prisma/schema.prisma) [文章初始迁移](../../prisma/migrations/202611250002_articles/migration.sql) [阅读迁移](../../prisma/migrations/202611250008_article_views/migration.sql)

标题上限 160，摘要上限 500，Markdown 正文上限 60000。草稿允许保存未完成内容，提交审核要求去除首尾空白后的标题和正文均非空。API 拒绝额外字段，调用者不能通过请求体指定作者。[文章 API](../../apps/api/features/articles/articles.ts)

## 生命周期与并发

| 动作 | 原状态 | 结果 | 权限和要求 |
| --- | --- | --- | --- |
| 创建 | 尚无文章 | `DRAFT + NOT_SUBMITTED` | 登录用户，作者取当前会话。 |
| 保存 | `DRAFT` 且审核为 `NOT_SUBMITTED / REJECTED` | 保留草稿，版本加 1 | 本人，携带当前 `version`。 |
| 提交审核 | `DRAFT + NOT_SUBMITTED / REJECTED` | `DRAFT + PENDING` | 本人，标题和正文完整。 |
| 审核通过 | `DRAFT + PENDING` | `PUBLISHED + APPROVED` | 管理员，设置发布时间。 |
| 审核驳回 | `DRAFT + PENDING` | `DRAFT + REJECTED` | 管理员，原因必填。 |
| 下架 | `PUBLISHED + APPROVED` | `UNLISTED + APPROVED` | 管理员，原因必填。 |
| 恢复展示 | `UNLISTED + APPROVED` | `PUBLISHED + APPROVED` | 管理员，使用 `RELIST` 动作。 |
| 转回草稿 | `UNLISTED + APPROVED` | `DRAFT + NOT_SUBMITTED` | 本人。 |

状态变更在事务内核对版本与原状态，条件更新成功后写审核日志。重复使用旧版本返回 409，失败事务不留下单独的状态更新或日志。首次审核公开时，在同一事务内给当时已关注作者的用户生成站内通知。恢复展示不再次发送发布通知。[审核 API](../../apps/api/features/articles/moderation.ts) [通知生成](../../apps/api/features/community/notifications.ts)

评论、文章点赞和收藏新增时先锁定公开文章，再写关系，避免检查完成后内容下架而仍新增公开互动。取消已有文章点赞和收藏按本人关系删除，能够清理已下架内容的已有关系。[互动 API](../../apps/api/features/community/interactions.ts)

## 接口契约

所有写接口均使用同源检查和 CSRF 校验。登录身份通过 Cookie 会话解析，私有读接口另行检查当前用户，管理员入口检查 `ADMIN`。

| 接口 | 参数或正文 | 主要响应与权限 |
| --- | --- | --- |
| `GET /api/tags` | 无 | 文章可用标签数组，游客可读。 |
| `GET /api/articles` | `tab`、`tagId`、`q`、`cursor`、`limit` | `{items,nextCursor}`，默认 `latest`，单页默认 20，最大 50。关注流需登录。 |
| `GET /api/articles/:id` | UUID | 已公开文章、正文、作者和 `related`，不可公开内容返回 404。 |
| `GET /api/me/articles` | `status=draft`、`page` 可选 | 本人文章数组，每页最多 100。 |
| `GET /api/me/articles/:id` | UUID | 本人文章正文、状态、版本和最近驳回或下架原因。 |
| `POST /api/articles` | `title`、`bodyMarkdown`、`tagIds`，可选 `summary` | 创建草稿，返回文章，HTTP 201。 |
| `PATCH /api/articles/:id` | `version`，可选编辑字段 | 本人更新可编辑草稿，返回新版本。 |
| `POST /api/articles/:id/submit` | `version` | 本人提交审核。 |
| `POST /api/articles/:id/return-to-draft` | `version` | 本人将下架文章转回草稿。 |
| `POST /api/articles/:id/views` | 无业务正文 | 返回 `{viewCount}`，游客也可计数，先加载详情取得浏览会话标识。 |
| `GET /api/articles/:id/interaction` | UUID | 当前会话的 `liked`、`bookmarked`、`collectionId`、`following`，需登录。 |
| `PUT /api/articles/:id/like` | `{active:boolean}` | 设置本人的文章点赞目标状态。 |
| `PUT /api/articles/:id/bookmark` | `active`、可选 `collectionId` | 收藏或取消收藏，具名合集必须属于当前用户。省略合集字段时保留已有收藏归属，传空值表示默认收藏。 |
| `PUT /api/users/:id/follow` | `{active:boolean}` | 设置当前用户与目标作者的关注状态，禁止自关注。 |
| `GET /api/admin/articles` | 状态、审核状态、`page`、`from`、`to` | `{items,hasMore}`，每页 30，管理员可读。 |
| `GET /api/admin/articles/:id` | UUID | 正文与最近 30 条审核记录，管理员可读。 |
| `POST /api/admin/articles/:id/review` | `version`、`action=APPROVE/REJECT`、可选 `reason` | 管理员审核，驳回需原因。 |
| `POST /api/admin/articles/:id/unlist` | `version`、`reason` | 管理员下架。 |
| `POST /api/admin/articles/:id/relist` | `version` | 管理员恢复展示。 |

后台 `from / to` 是北京时间日历日期，`to` 包含当天。服务端转换为起始日零点至结束日次日零点的左闭右开区间，并拒绝非法日期与倒置范围。[日期过滤](../../apps/api/shared/admin-date-range.ts)

## 排序、搜索与阅读计数

首页前台默认请求 `recommended`，API 未传 `tab` 时默认 `latest`。最新按发布时间和 ID 降序，推荐优先阅读量，再按发布时间和 ID 降序。关注流在公开条件上过滤已关注作者。关键词在标题和正文中做大小写不敏感子串匹配。游标包含排序值、标签、关键词和排序类型，不能跨筛选复用。[文章列表实现](../../apps/api/features/articles/articles.ts)

详情读取只建立浏览会话标识。前台加载详情后发阅读写请求，服务端按文章和会话摘要保存 30 分钟窗口。窗口更新和累计阅读量递增在同一事务内执行，并发重复请求只计一次。数据库保存摘要，浏览器保存随机标识 Cookie。[阅读 API](../../apps/api/features/articles/article-views.ts) [前台详情](../../apps/web/features/articles/articles.tsx)

## 评论与互动

文章、沸点和章节使用同一个 `CommentSection` 输入及列表组件。文章启用两级回复和评论点赞，一级评论和二级回复都允许本人参与。对二级回复点击回复时，请求仍关联该线程的一级评论，保持两级结构。[共享评论组件](../../apps/shared/ui/comments.tsx)

| 评论接口 | 规则 |
| --- | --- |
| `GET /api/articles/:id/comments` | 已公开文章。取最近 100 条可见一级评论，每条取最近 20 条可见回复，再以时间顺序返回。响应含 `liked`、`likeCount`、作者和 `replies`。 |
| `POST /api/articles/:id/comments` | 正文 1 至 2000 字符且含非空白，可选 `parentId`。作者取会话。父级必须是同文章的可见一级评论。 |
| `PUT /api/articles/:id/comments/:commentId/like` | `{active:boolean}`，返回 `{liked,likeCount}`。文章、目标评论和父评论均须可见。 |
| `GET /api/admin/comments` | 管理员按 `articleId`、`q`、`status`、`page`、日期过滤，每页 30，返回 `{items,hasMore}`。 |
| `GET /api/admin/comments/sources` | 管理员搜索有评论的文章来源，返回候选 ID 和标题。 |
| `PATCH /api/admin/comments/:id/status` | `{expectedStatus,status,reason?}`，管理员隐藏或恢复。隐藏需原因，旧状态返回 409。 |

公开文章评论计数包含可见的一级评论及父级可见的二级回复，后台文章列表评论数则包含可见和隐藏的全部评论。当前文章的「最热」在客户端对已取回的最近 100 个线程排序，依次比较一级评论点赞数、返回回复数和时间。「最新」按一级评论时间降序。回复默认折叠为两条，可展开已返回的回复。父评论隐藏后，整个线程从公开列表及公开计数移除，恢复父评论后仍尊重每条回复自身的可见状态。[评论读取与写入](../../apps/api/features/community/interactions.ts) [共享排序](../../apps/shared/ui/comments.tsx)

迁移 `202611250020_comment_thread_integrity` 进一步在数据库层限制文章和沸点回复。它先检查已有结构，再安装触发器，拒绝跨内容父级、自引用和三级回复。评论建立后固定 ID、所属内容和父级，允许正文及审核状态继续更新。迁移遇到异常旧结构会整体失败，需查明具体数据后处理。[线程约束迁移](../../prisma/migrations/202611250020_comment_thread_integrity/migration.sql)

## 错误与状态反馈

| 状态 | 前台处理 |
| --- | --- |
| 400 | 展示字段、标签、游标或内容完整性错误，保留编辑输入。 |
| 401 | 提供登录弹窗并保留站内目标。 |
| 403 | 显示无权限或请求来源错误。 |
| 404 | 文章不可公开或对象不在本人范围，展示不可访问反馈。 |
| 409 | 提示版本或状态已变化，允许读取服务器最新内容后处理。 |
| 请求失败 | 保留编辑器或评论草稿，操作位置显示错误和重试入口。 |

文章评论和互动状态响应携带 `private, no-store`，个性化缓存键包含当前用户，退出或换账号时清理私有缓存。[会话管理](../../apps/shared/auth/session.tsx) [互动 API](../../apps/api/features/community/interactions.ts)

## 验收设计

| 场景 | 预期 |
| --- | --- |
| 两位作者分别读取草稿箱 | 只能获得自己的草稿、正文和版本。 |
| 两个编辑请求提交同一旧版本 | 只有一个成功，另一个返回 409，标签关系与正文一致。 |
| 保存空草稿后提交 | 草稿可保存，提交因标题或正文不完整被拒绝。 |
| 游客访问草稿或下架文章 | 详情、评论公开入口均返回 404。 |
| 管理员通过、下架、恢复 | 状态及日志连续可追溯，恢复不重复发布通知。 |
| 两用户点赞、收藏及关注 | 各自关系独立，重复激活不多计数，取消只影响本人。 |
| 本人回复本人、其他人回复、第三层请求 | 前两项成功，第三层请求拒绝。 |
| 隐藏一级评论及恢复 | 回复与总计数同步过滤，独立隐藏的回复继续隐藏。 |
| 同浏览会话并发计数 | 30 分钟内只递增一次。 |
| 中文和重复标题 | 目录点击、带锚点刷新均指向正确标题。 |

现有接口和浏览器用例可作为这些场景的验证入口，执行时使用独立测试库并清理临时数据。[创作者接口测试](../../tests/creator.integration.test.ts) [阅读计数测试](../../tests/article-views.integration.test.ts) [文章浏览器流程](../../scripts/browser-community.mjs)

## 版本变化与后续范围

1.1 快照保留原有数据库和模块评审记录。本版补齐实际公开列表排序、作者草稿和版本控制、审核恢复、阅读去重、收藏合集归属、两级评论、评论点赞和共享评论组件的契约，并记录本轮新增的数据库线程约束。

当前文章评论最多读取最近 100 个一级线程和每线程 20 条回复，最热排序受该范围限制。作者列表用固定 100 条页长。超过这些规模后若需要完整历史评论和全量最热，应增加服务端排序分页并同步共享组件。课程和文章共用 Markdown 渲染器，支付、专栏管理及媒体上传需要各自明确的业务和接口设计。
