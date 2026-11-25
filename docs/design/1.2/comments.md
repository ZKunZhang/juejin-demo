# 评论模块设计 1.2

本文供前后端开发、数据库维护和验收使用，覆盖文章评论、沸点评论、章节评论及管理员评论管理。接口、字段和交互以本版本源码为依据，运行验证结果由同版本验收记录补充。

## 范围和入口

| 场景 | 页面入口 | 能力 |
| --- | --- | --- |
| 文章 | `/articles/:id#article-comments` | 一级评论、二级回复、本人回复本人、评论点赞、最热与最新切换 |
| 沸点预览 | `/pulses` 的评论区域 | 一级评论预览、二级回复、评论点赞、进入全部评论 |
| 沸点详情 | `/pulses/:id#pulse-comments` | 评论分页、最热与最新切换、一级评论和二级回复 |
| 课程章节 | `/courses/:id/lessons/:lessonId` 的正文下方 | 章节独立评论、发表和刷新 |
| 管理后台 | `/admin/comments`、`/admin/comments/pulses` | 分类型筛选、来源搜索、隐藏和恢复 |

前台使用 `CommentSection` 管理列表、输入、登录引导、点赞和回复。`CommentMessage` 统一作者、时间和正文的展示，后台评论管理也复用该展示。评论正文作为文本渲染，保留换行，长内容允许换行。组件通过 `useId` 为输入和计数生成关联 ID，多个沸点同时展开时各自维护草稿。[共享组件](../../../apps/web/comments.tsx) · [评论样式](../../../apps/web/comments.css)

## 数据模型

| 表 | 主要字段 | 关系与约束 |
| --- | --- | --- |
| `comments` | `id`、`article_id`、`author_id`、`parent_id?`、`body`、`status`、`created_at`、`updated_at` | 文章和作者外键。一级父级为空，二级指向同文章的一级评论 |
| `pulse_comments` | `id`、`pulse_id`、`author_id`、`parent_id?`、`body`、`status`、`created_at` | 沸点和作者外键。两级结构与文章一致 |
| `comment_likes` | `user_id`、`comment_id`、`created_at` | 用户与评论的组合主键，阻止重复点赞 |
| `pulse_comment_likes` | `user_id`、`comment_id`、`created_at` | 用户与沸点评论的组合主键 |
| `comment_moderation_logs` | 评论、管理员、前后状态、原因、时间 | 文章评论审核的追加日志 |
| `pulse_comment_reviews` | 评论、管理员、前后状态、原因、时间 | 沸点评论审核的追加日志 |
| `course_lesson_comments` | `id`、`lesson_id`、`author_id`、`body`、`created_at` | 章节与作者外键，按章节独立查询 |

文章、沸点评论状态使用 `VISIBLE / HIDDEN`。章节评论当前模型保存正文和归属，文章与沸点评论的状态审核流程有独立数据表。点赞数从点赞关系聚合，响应中的 `liked` 由当前会话对应的点赞关系计算。[Prisma 模型](../../../prisma/schema.prisma)

### 两级结构在数据库中的保证

迁移 `202611250020_comment_thread_integrity` 为文章和沸点评论安装触发器。插入回复时，父级必须存在、属于同一内容且为一级评论。触发器拒绝自身作为父级。评论建立后，`id`、内容归属字段和 `parent_id` 固定，正文和审核状态仍可更新。

安装规则时，迁移先锁定两张评论表，再核查既有跨内容和三级结构。发现异常时迁移报错并回滚，由维护者核对异常来源。可见性在接口事务中检查，隐藏根评论会影响其回复的公开展示。[约束迁移](../../../prisma/migrations/202611250020_comment_thread_integrity/migration.sql)

文章父子关系保留 `ON DELETE RESTRICT`，沸点父子关系使用 `ON DELETE CASCADE`。因此文章评论清理需要先处理回复，沸点删除会按外键级联清理对应评论及点赞。常规审核以状态变更保留内容和日志。[文章回复迁移](../../../prisma/migrations/202611250006_comment_replies/migration.sql) · [沸点回复迁移](../../../prisma/migrations/202611250016_pulse_comment_threads/migration.sql)

## 公开读取和排序

### 文章评论

`GET /api/articles/:id/comments` 先确认文章已发布，返回最近 100 条可见一级评论。每条带最近 20 条可见回复，根评论和回复都以时间正序返回。字段包含 `id`、`body`、`createdAt`、`parentId`、`author`、`liked`、`likeCount` 和 `replies`。响应设置 `Cache-Control: private, no-store`。

文章组件在这批数据内排序。「最热」依次比较点赞数、已加载回复数和创建时间，均为降序。「最新」按创建时间降序。因根评论和回复均有读取上限，最热结果的候选范围是已加载的最近 100 条，回复参与排序的数量是已加载的最多 20 条。[文章评论接口](../../../apps/api/interactions.ts) · [排序组件](../../../apps/web/comments.tsx)

### 沸点评论

`GET /api/pulses/:id/comments` 要求沸点已发布。接口接受 `sort=hot|latest` 和 `page`。

| 参数组合 | 返回顺序和数量 |
| --- | --- |
| `page=1&sort=hot` | 按点赞数、创建时间、ID 降序读取，一级评论每页 20 条并额外取 1 条判断下一页 |
| `page=1&sort=latest` | 按创建时间、ID 降序读取，同样取 21 条 |
| 省略分页和排序 | 最近 100 条一级评论，返回时间正序，用于兼容现有调用 |

每条根评论附带最近 20 条可见回复，回复按时间正序展示。预览区域仅显示前三条根评论，详情显示每页前 20 条。回复默认展示前两条，可展开当前已加载的回复。切换最热或最新时页码重置为 1。成功发评后刷新评论和所属内容统计。[沸点接口](../../../apps/api/pulses.ts) · [前台调用](../../../apps/web/pulses.tsx)

### 课程章节评论

`GET /api/courses/:id/lessons/:lessonId/comments` 同时检查课程、章节已发布以及章节归属。返回最近 100 条评论并按时间正序展示。章节评论使用共享组件的基础模式，当前展示单层评论。[课程接口](../../../apps/api/courses.ts) · [章节正文入口](../../../apps/web/courses.tsx)

## 写入接口和权限

| 接口 | 请求 | 成功结果 |
| --- | --- | --- |
| `POST /api/articles/:id/comments` | `body`、可选 `parentId` | `201`，新评论和作者，初始 `liked=false`、`likeCount=0` |
| `POST /api/pulses/:id/comments` | `body`、可选 `parentId` | `201`，新评论和当前点赞字段 |
| `POST /api/courses/:id/lessons/:lessonId/comments` | `body` | `201`，新章节评论和作者 |
| `PUT /api/articles/:id/comments/:commentId/like` | `active` 布尔值 | `liked` 和服务端 `likeCount` |
| `PUT /api/pulses/:id/comments/:commentId/like` | `active` 布尔值 | `liked` 和服务端 `likeCount` |

所有写入使用会话识别作者，并通过来源和 CSRF 校验。正文要求 1–2000 个字符且包含非空白字符，入库前去掉首尾空白。请求体额外传入作者字段会触发结构校验。创建评论时在事务中锁定公开内容，创建回复时再锁定同内容的可见一级评论。本人和其他用户都可以回复根评论，回复二级内容时仍写入同一个根评论 ID。[写保护和错误格式](../../../apps/api/app.ts) · [会话权限](../../../apps/api/security.ts)

点赞和取消都检查评论所属内容、评论及父级可见状态。重复激活由组合主键去重。接口返回服务端计算结果后，组件更新当前评论并使同一路径的查询失效。[文章点赞](../../../apps/api/interactions.ts) · [沸点点赞](../../../apps/api/pulses.ts)

## 交互和错误反馈

- 游客可读取公开评论，发表、回复和点赞入口打开登录弹窗，`next` 保存当前路径与评论锚点。
- 输入区显示字符计数，空白输入禁止提交。提交期间输入只读并禁用重复提交，失败保留正文。
- `401` 后保留草稿并显示登录入口。`400` 显示字段或内容错误，`404` 表示目标内容或可回复评论已不可用。
- 列表加载、空态、错误重试各有反馈。成功后清空已发送输入，显示发布结果，文章回复和点赞刷新所属文章统计。
- 管理员隐藏一级评论后，其二级回复一起从公开列表消失。独立隐藏的二级回复在根评论恢复后继续保持隐藏状态。

## 管理员评论管理

文章和沸点评论各自使用列表与状态接口。列表默认每页 30 条，可按状态、内容来源、关键词和创建时间范围筛选。文章评论来源查询使用 `/api/admin/comments/sources`，沸点使用 `/api/admin/pulse-comments/sources`。

`PATCH /api/admin/comments/:id/status` 与 `PATCH /api/admin/pulse-comments/:id/status` 接受 `expectedStatus`、`status` 和可选 `reason`。隐藏必须填原因。更新条件携带旧状态，旧状态冲突返回 `409`，成功更新与追加日志在同一事务提交。普通用户调用后台接口返回 `403`。[文章评论管理](../../../apps/api/moderation.ts) · [沸点评论管理](../../../apps/api/pulse-moderation.ts) · [后台界面](../../../apps/admin/main.tsx)

## 验收清单

| 检查 | 预期 |
| --- | --- |
| 两个账号分别发评，刷新后查看 | 作者按真实会话记录，正文和评论数一致 |
| 本人回复自己的根评论 | 成功入库并显示在根评论下 |
| 提交其他内容的父 ID、二级父 ID、自身父 ID | 接口或数据库拒绝，结构保持两级 |
| 最热和最新切换 | 使用已知不同点赞数和时间的样本确认首条顺序不同 |
| 同一账号重复点赞，另一账号取消自己的点赞 | 每个用户最多一条关系，计数与归属一致 |
| 隐藏根评论、单独隐藏回复、恢复根评论 | 公开可见性符合父子状态，日志按成功操作追加 |
| 章节 A 发评后进入章节 B | B 的列表包含 B 的评论，返回 A 后可读原评论 |
| 多个沸点评论区同时展开 | 输入标签 ID 唯一，草稿相互独立 |
| 390px 和 320px | 评论正文、输入和操作区可用，页面无横向溢出 |

可执行验收入口为文章社区、沸点和课程浏览器脚本，以及章节评论接口测试。本设计引用测试覆盖范围，执行结果应写入本版本的验收记录。[社区脚本](../../../scripts/browser-community.mjs) · [沸点脚本](../../../scripts/browser-pulses.mjs) · [课程脚本](../../../scripts/browser-courses.mjs) · [章节接口测试](../../../tests/course-comments.integration.test.ts)

## 1.1 到 1.2 的补充

- 将文章、沸点和章节评论的共享组件及差异配置写入设计。
- 明确两级回复、评论点赞、最热与最新、沸点分页和回复折叠的实际范围。
- 补充父级可见性、本人回复本人、后台分类型审核和状态冲突处理。
- 补充数据库两级结构触发器、固定归属规则及安装前的数据校验。

## 后续设计项

文章热门评论目前在最近 100 条中排序，进一步扩大候选范围需要服务端排序与分页契约。章节评论若引入回复、点赞或审核，需要增加对应字段、关系和后台入口。评论编辑、用户主动删除和全量历史回复加载也需要独立定义权限、审计及分页行为。
