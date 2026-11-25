# 社区模块开发计划

版本 v0.3，待评审。四个模块按顺序开发和验收。每个模块提交代码、迁移、可复现测试结果及剩余事项。本文只交付计划，环境、账号和业务实现待进入对应模块后创建。

## 顺序与交付

| 模块 | 交付 | 工具 | 进入下一模块的条件 |
| --- | --- | --- | --- |
| M1 登录注册 | React 注册登录页、Node.js API、用户和会话迁移、本地种子账号 | Vite、React Router、React Hook Form、Fastify、Ajv、Cookie/CSRF 插件、Argon2id、Prisma Migrate、Docker Compose、Vitest、Playwright | M1 用例通过，能独立验证真实 PostgreSQL 的用户行和重启后的会话。 |
| M2 文章发布 | 创作者编辑页、公开文章列表与详情、标签关联、开发环境发布 | React Hook Form、TanStack Query、react-markdown、remark-gfm、Prisma 事务 | 作者发布、游客阅读和标签筛选跑通，草稿不可公开，正式环境临时发布接口不可访问。 |
| M3 审核与评论管理 | 独立后台、角色权限、审核队列、下架、评论隐藏与恢复、操作日志 | 独立 Vite 入口、Fastify preHandler、PostgreSQL 条件更新、Prisma 事务 | 管理员从待审到公开完整跑通，普通用户无法审核，临时发布端点移除。使用种子评论验证后台。 |
| M4 多用户互动 | 公开评论、点赞、收藏、关注、关系查询 | TanStack Query、Prisma 组合主键、Playwright 多账号上下文、psql | 多用户场景及重启持久化通过，计数、权限和内容可见性符合契约。 |

M1 开始时确认 Node.js、Prisma、Fastify 及插件的兼容版本并锁定依赖。统一开发命令、迁移命令和测试数据库连接方式。M1 到 M4 只在各模块通过验收后合并。沸点、课程、活动、话题订阅等随后拆分。

## 演示账号和数据

| 用户名 | 昵称 | 角色 | 场景 |
| --- | --- | --- | --- |
| admin_demo | 演示管理员 | ADMIN | 文章通过、驳回、下架，评论隐藏和恢复。 |
| author_alpha | 林夕 | USER | 创建文章、送审、处理驳回。 |
| reader_beta | 陈默 | USER | 评论、关注、点赞、收藏及撤销。 |
| reader_gamma | 周野 | USER | 对同一文章独立互动，并验证 Beta 的撤销不影响自己的记录。 |

- M1 种子使用正式密码哈希逻辑。通过仅本地的环境配置传入演示账号密码，四个账号分别设置。种子必须显式启用，并连接指定的开发或测试库。
- 稳定用户名及夹具标识用于重复运行。重复初始化不累积数据，也不覆盖已存在账号的密码或角色。发现角色冲突时报告并停止。生产部署流程不调用演示种子。
- M2 增加标签、作者草稿及公开文章。M3 增加待审文章和用于管理演示的种子评论。M4 加入双读者互动夹具，浏览器验收仍从干净状态实际走写接口。
- 端到端演示依次由 Alpha 发布草稿并提交、管理员批准、Beta 与 Gamma 分别评论、关注作者、收藏并点赞。Beta 取消互动后 Gamma 状态仍有效。最后管理员隐藏一条评论，再下架文章验证公开可见性。

## 联调和验收依据

- [前端开发文档](./frontend-development.md)
- [后端及数据库开发文档](./backend-database-development.md)
- [模块测试用例](./module-test-cases.md)
- [PostgreSQL 数据库设计](./database-design.html)
