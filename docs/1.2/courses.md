# 课程小册模块设计 1.2

版本为 1.2，更新日期为 2026 年 11 月 25 日。课程模块提供小册发现、课程介绍、按章节阅读和章节讨论。课程与章节各自保存发布状态，公开读取必须同时满足课程、章节及所属关系校验。

本版以当前前后台调用和 Prisma 迁移为依据，补齐章节评论、阅读布局和公开边界。1.1 基线保留在版本快照中。[1.1 文档快照](../1.1/README.md)

## 用户流程与页面

用户在课程列表选择分类和难度，打开小册介绍，再通过「开始阅读」或介绍页目录进入章节。章节页采用左侧章节目录、右侧正文和正文下方评论，正文内标题由共用 Markdown 目录组件呈现。当前章节在左侧目录标记为选中，直接访问章节地址和刷新均使用相同的读取路径。[课程前台](../../apps/web/features/courses/courses.tsx)

| 路由 | 当前页面行为 |
| --- | --- |
| `/courses` | 小册列表。支持 `categoryId` 和 `level` 查询条件，展示分类、难度、作者、简介和公开章节数。 |
| `/courses/` | 读取课程列表后选择 `courseId` 对应项或第一项，再读取课程目录并进入首个公开章节。若同时提供匹配的 `courseId` 与 `lessonId`，进入指定章节。没有公开章节时展示课程介绍。 |
| `/courses/:id` | 小册介绍，提供介绍和目录切换、首章开始阅读入口及相关课程。 |
| `/courses/:id?tab=directory` | 在课程介绍页显示已发布章节目录。 |
| `/courses/:id/lessons/:lessonId` | 左侧章节目录，右侧当前正文，正文后显示当前章节评论。 |

本轮补齐 `/courses/` 自动进入首个公开章节的路径，`/courses` 继续显示小册列表，`/courses/:id` 继续显示课程介绍。课程介绍和章节页去掉重复的返回按钮，列表、目录、全站导航和浏览器历史承担导航。[路由表](../../apps/web/app/web-app.tsx) [课程入口选择](../../apps/web/features/courses/course-reading-entry.tsx)

## 布局与状态

| 区域 | 设计 |
| --- | --- |
| 课程列表 | 分类和难度选择保持在 URL，筛选改变时重新请求。空结果显示重置入口，分类加载失败可以单独重试。 |
| 课程封面 | 使用课程分类、标题和作者生成页面内封面，数据模型中当前没有封面 URL 字段。 |
| 介绍页 | 课程概要、首章阅读按钮、Markdown 介绍、章节目录和相关小册。介绍与目录用查询参数切换。 |
| 章节目录 | 按 `position` 升序，仅显示公开章节。选中状态取当前 `lessonId`，链接保留明确的课程与章节 ID。 |
| 正文 | Markdown 正文与文章共用渲染器，中文、重复标题和安全链接规则一致。 |
| 章节评论 | 共用 `CommentSection`，含作者、时间、正文、输入计数、加载、空态、失败和重试。 |
| 窄屏 | 目录和正文纵向堆叠，正文内目录可折叠，代码块在自身容器内横向滚动。 |

课程或章节不可公开时，页面显示「小册或章节不可访问」和课程列表入口。普通网络错误显示重试，避免将网络失败显示成空列表。[课程页面](../../apps/web/features/courses/courses.tsx) [样式](../../apps/web/features/courses/courses.css) [Markdown](../../apps/shared/ui/markdown.tsx)

## 数据模型与数据库约束

| 表 | 核心字段 | 约束 |
| --- | --- | --- |
| `course_categories` | UUID、`slug`、名称、`sort_order` | slug 唯一，课程外键引用分类。 |
| `courses` | UUID、分类、作者、标题、摘要、介绍、难度、状态、发布时间、创建及更新时间 | 难度为 `BEGINNER / ADVANCED`。状态为 `DRAFT / PUBLISHED / UNLISTED`，默认草稿。公开时 `published_at` 必须非空。 |
| `course_lessons` | UUID、`course_id`、`position`、标题、正文、状态 | 同课程的位置唯一，位置必须大于零。删除课程时章节级联处理。 |
| `course_lesson_comments` | UUID、`lesson_id`、`author_id`、正文、创建时间 | 评论外键引用章节和用户，章节删除时其评论级联处理。 |

课程标题上限 160，摘要上限 500。数据库按 `status, category_id, level, published_at, id` 建课程索引，按 `course_id, position` 建章节唯一索引，评论按 `lesson_id, created_at, id` 建读取索引。数据主键使用 UUID，时间点使用 `timestamptz(3)`。[Prisma 模型](../../prisma/schema.prisma) [课程迁移](../../prisma/migrations/202611250011_courses/migration.sql) [评论迁移](../../prisma/migrations/202611250014_course_lesson_comments/migration.sql)

课程和章节的发布状态是独立字段。章节公开读取在查询中同时要求 `course.status=PUBLISHED`、`lesson.status=PUBLISHED` 和正确的 `course_id`。章节评论表保存 `lesson_id`，课程归属通过章节关系解析，减少重复归属字段。[课程 API](../../apps/api/features/courses/courses.ts)

## 接口契约

| 接口 | 参数 | 响应 |
| --- | --- | --- |
| `GET /api/courses/categories` | 无 | `{id,slug,name}[]`，只返回至少有一门公开课程的分类，按分类顺序和 ID 排序。 |
| `GET /api/courses` | 可选 `categoryId`、`level=BEGINNER/ADVANCED` | 公开小册卡片数组，最多 100。按发布时间和 ID 降序。 |
| `GET /api/courses/:id` | 课程 UUID | 课程卡片字段、`description`、公开 `lessons` 和 `related`。 |
| `GET /api/courses/:id/lessons/:lessonId` | 课程及章节 UUID | `{id,title,body,position,course:{id,title}}`。 |
| `GET /api/courses/:id/lessons/:lessonId/comments` | 课程及章节 UUID | 评论数组，含 ID、正文、时间和作者 ID、用户名、昵称。 |
| `POST /api/courses/:id/lessons/:lessonId/comments` | `{body}` | 新评论，HTTP 201，作者从会话取得。 |

课程卡片字段包含 ID、标题、摘要、难度、发布时间、分类、作者和 `_count.lessons`。章节数量只统计已发布章节。介绍页先推荐同分类公开课程，按发布时间和 ID 排序，数量不足时从其他分类补足，合计最多三门并排除自身。[读取选择](../../apps/api/features/courses/courses.ts)

课程和章节公开读取允许游客访问。评论发表要求有效登录会话、正确来源和 CSRF Token，正文长度 1 至 2000，必须有非空白字符，写入前去除首尾空白。额外请求字段被拒绝，调用方不能冒用 `authorId`。UUID、难度或请求体不合法返回 400。[API 校验](../../apps/api/features/courses/courses.ts) [请求保护](../../apps/api/app/app.ts)

## 章节评论流程

1. 阅读页以课程和章节 ID 请求正文。公开或归属检查失败时不展示讨论输入。
2. 同一章节的评论通过独立接口读取。服务端取最近 100 条，再以时间顺序返回。
3. 游客看到「登录后发表评论」。登录弹窗保存当前站内地址，认证后回到章节。
4. 已登录用户填写评论，组件显示字符计数。空白输入不可提交，提交期间防重复。
5. 服务器在事务中锁定公开课程，再锁定该课程下的公开章节，成功后创建当前用户的评论。
6. 前台写入确认后清空输入，更新评论缓存并刷新列表。失败保留原内容并显示反馈。

评论查询键包含接口路径与当前用户。章节改变时请求新路径，上一章评论不会进入下一章。登录或退出触发私有缓存清理，组件输入状态按当前会话重建。[共享评论组件](../../apps/shared/ui/comments.tsx) [会话缓存](../../apps/shared/auth/session.tsx)

当前章节评论保存单层结构。界面复用统一评论组件，但课程接口没有 `parentId`、点赞状态、评论隐藏状态或审核日志字段。课程讨论的能力以这些已实现接口为准。[章节评论模型](../../prisma/schema.prisma) [章节评论路由](../../apps/api/features/courses/courses.ts)

## 并发与公开边界

评论写入事务先取得课程行共享锁，再取得章节行共享锁。课程或章节下架与该写事务通过数据库行锁协调，避免检查通过后再写入已下架目标。正文和评论的 GET 都按发布状态和所属课程读取，传入另一课程的章节 ID 返回 404。[事务实现](../../apps/api/features/courses/courses.ts)

已下架课程和草稿章节不进入分类计数、公开列表、课程目录、相关课程和章节内容。课程作者与评论作者均通过外键关联用户。评论的作者来自服务端会话，普通用户不能为别人建立评论关系。[公开读取测试](../../tests/courses.integration.test.ts) [章节评论测试](../../tests/course-comments.integration.test.ts)

## 错误与验收

| 场景 | 预期 |
| --- | --- |
| 分类和难度组合过滤 | 返回同时满足条件的公开课程，URL 保留条件。 |
| 分类下仅有草稿课程 | 分类公开列表排除该分类。 |
| 课程有公开章与草稿章 | 目录只出现公开章，章节数与目录一致。 |
| 章节位置不连续 | 按真实 `position` 排序，允许草稿位置形成间隔。 |
| 传入另一课程的章节 ID | 正文和评论读写都返回 404。 |
| 游客发评、冒用作者、空白或超长正文 | 游客返回 401，其余非法输入返回 400，无新增记录。 |
| 两位用户在同一章节发评 | 作者和正文准确，刷新后仍可读取。 |
| 切换另一章 | 显示该章评论，前一章数据保持独立。 |
| 课程或章节下架 | 公开正文和评论读写被拒绝。 |
| 左右布局 | 桌面目录在正文左侧，评论在正文后，窄屏无页面横向溢出。 |
| 返回与刷新 | 浏览器历史可回到前一选择，深链接刷新仍显示同一章节。 |

接口测试覆盖组合筛选、推荐补足、公开过滤、评论权限和归属。浏览器脚本覆盖目录、章节选择、登录回跳、发评持久化、跨章节隔离和窄屏布局。每次执行的版本与结果应保存在该版本验证记录中。[课程测试](../../tests/courses.integration.test.ts) [评论测试](../../tests/course-comments.integration.test.ts) [浏览器脚本](../../scripts/browser-courses.mjs)

## 版本变化与后续范围

1.1 快照描述课程分类、课程及章节的公开读取结构。本版补齐实际路由、介绍与目录交互、左右阅读布局、章节评论数据和写入事务、Markdown 复用、错误反馈及验收范围。本轮恢复 `/courses/` 默认进入首个公开章节的入口规则。

当前 API 注册范围包含公开读取和章节评论发表。课程、章节编辑和审核后台、支付、学习进度、书签、章节评论回复与点赞需要后续模块设计和接口。列表最多返回 100 门课程，章节评论最多取最近 100 条，完整历史分页需另行扩展。
