# 开发者社区数据库设计

v0.1，待评审。拟使用 SQLite 单实例和持久化上传目录。实体以整数 ID 作主键，关系采用组合主键。应用连接启用外键和 WAL。时间戳采用 UTC，签到日期单独按北京时间保存。公开页面读取已发布内容，写操作以当前会话判定身份和权限。

## 账号、发布与标签

| 表 | 核心字段与约束 |
| --- | --- |
| users | id、username（大小写不敏感唯一）、password_hash、display_name、bio、website_url、avatar_media_id、role（member/editor）、status（active/disabled）及时间戳。 |
| sessions | token_hash 为主键，user_id 引用 users。另有 expires_at、revoked_at。只保存随机令牌摘要。 |
| media | id、owner_id、storage_key（唯一）、mime_type、bytes、width、height、status（staged/ready）及创建时间。实际文件落到上传目录。头像和封面引用此表。 |
| series | id、owner_id、title、description、status。每位作者的专栏标题唯一。 |
| posts | id、author_id、kind（article/pulse）、title、body、series_id、status（draft/published/archived）、view_count、published_at 及更新时间。文章要求标题和 Markdown 正文，沸点为文字和图片，允许纯图片。仅同一作者的文章可加入专栏。 |
| tags | id、name、slug（唯一）、scope（article/pulse/both）、sort_order。 |
| post_tags | post_id、tag_id 分别引用内容与标签，组合主键。写入时校验标签适用类型。 |
| post_media | post_id、position、media_id，按内容和位置唯一；同帖同图片唯一。沸点最多 4 张，位置从 1 开始。 |

## 互动、活动与课程

| 表 | 核心字段与约束 |
| --- | --- |
| comments | id、post_id、author_id、body、status（visible/hidden）、created_at。首期一级评论。 |
| post_likes | user_id、post_id、created_at，按用户和内容唯一，适用于文章和沸点。 |
| follows | follower_id、followee_id、created_at，组合主键，禁止自关注。 |
| collections | id、owner_id、title、description，同一用户下名称唯一。首期仅本人可访问。 |
| collection_items | collection_id、post_id、created_at，组合主键。读取时过滤非公开内容。 |
| checkins | user_id、local_date、created_at，用户和北京时间自然日组成主键。 |
| featured_posts | id、post_id、section（article_sidebar/pulse_sidebar）、editor_id、rank、enabled。同位置同内容唯一，启用时校验公开状态和类型。 |
| activities | id、editor_id、title、summary、body、starts_at、ends_at、status。结束时间可为空，填入时不得早于开始。 |
| course_categories | id、name、slug（唯一）、sort_order。 |
| courses | id、category_id、author_id、cover_media_id、title、summary、description、level（beginner/advanced）、status、published_at。 |
| course_lessons | id、course_id、position、title、body、status。同一小册的位置唯一，公开范围同时检查课程及章节。 |
| post_view_windows | post_id、viewer_key、last_counted_at，内容和会话摘要组成主键。匿名访问使用随机会话标识摘要。 |

外键覆盖内容作者、用户关系、标签、附件、专栏、精选编辑、所属课程等实体关系。论坛数据首期由文章、沸点和评论承载。独立版块或楼中楼随评审决定。

## 查询和索引

| 路径 | 查询与拟建索引 |
| --- | --- |
| 首页与沸点 | posts(kind, status, published_at, id)，post_tags(tag_id, post_id)。关注流按已关注作者过滤。推荐拟按精选、点赞与可见评论之和、时间和 ID 降序。 |
| 个人页 | posts(author_id, status, kind, published_at, id)。获赞、阅读仅汇总该用户的公开文章。关注和粉丝用双向关系查询。 |
| 评论、点赞与关注 | comments(post_id, status, id)，post_likes(post_id, user_id)，follows(followee_id, follower_id)。 |
| 活动和精选 | activities(status, starts_at, id)，featured_posts(section, enabled, rank, id)。精选联查公开内容。 |
| 小册与章节 | courses(status, category_id, level, published_at, id)，course_lessons(course_id, position) 唯一索引。推荐优先同分类，再按发布时间和 ID。 |
| 搜索 | 标题及正文子串匹配。按内容类型与公开状态过滤，以发布时间及 ID 分页。中文索引策略随实际数据规模验证。 |
| 回收 | sessions(expires_at)，media(status, created_at)，post_view_windows(last_counted_at)。 |

## 数据一致性与恢复

- 注册密码用加盐散列。登录时生成会话，退出撤销当前会话。并发用户名重复由唯一约束处理。API 使用参数绑定，公开查询不返回密码摘要、会话标识或私有互动明细。
- 发布事务包含内容、标签、附件关系。文件校验后先写临时文件，同文件系统内移动到正式路径，再提交数据库事务。失败文件可回收。崩溃后按文件年龄和引用状态清理，避开正在提交的文件。
- 专栏与收藏集由所有者创建、重命名和调整条目。专栏只关联本人的文章，收藏集可加入其他作者的公开文章。绑定头像、封面或附件时，校验资源已就绪且归写入者所有。失败时不改变原关联。
- 点赞、收藏和关注接口写入期望状态。关系唯一约束保证重试不重复计数。签到冲突时返回已签到。
- 阅读去重与累计更新放在同一事务。首次或距上次计数满 30 分钟才递增。过期窗口清理保留历史累计。
- 内容下架使用状态迁移。若经授权物理删除，级联处理标签、评论和互动，确认不再引用后回收文件。账号硬删除策略待确认。
- 使用版本化迁移，备份数据库一致性快照及被引用文件。恢复演练检查外键、文件可读性和核心记录数量。部署规模、备份周期和保留期限待确认。

## 范围待确认

首期草案采用公开课程、私有收藏集和点赞记录、编辑维护活动及精选。话题订阅、APP、AI 用量、作品广场、支付及学习进度，在评审明确来源、权限和业务状态后扩展数据模型。
