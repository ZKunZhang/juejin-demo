# 码栈模块图册

每个模块提供角色泳道、业务判断流程和中英双语表关系图。泳道展示各角色的操作归属，流程图展示判断与结果。表关系来自当前 Prisma schema。

[核心关系总览](../database-overview.svg) · [完整字段关系图](../database-erd.svg)

| 模块文档 | 独立 SVG |
| --- | --- |
| [账号与会话](./accounts.md) | [表关系](./accounts.svg) |
| [个人主页](./profiles.md) | [表关系](./profiles.svg) |
| [文章](./articles.md) | [表关系](./articles.svg) |
| [评论](./comments.md) | [表关系](./comments.svg) |
| [沸点](./pulses.md) | [表关系](./pulses.svg) |
| [课程](./courses.md) | [表关系](./courses.svg) |
| [创作者中心](./creator.md) | [表关系](./creator.svg) |
| [互动、收藏与关注](./interactions.md) | [表关系](./interactions.svg) |
| [活动](./activities.md) | [表关系](./activities.svg) |
| [站内通知](./notifications.md) | [表关系](./notifications.svg) |
| [后台审核](./administration.md) | [表关系](./administration.svg) |

模型变更后运行 `npm run db:diagram`。模块范围和中文名称定义在[生成脚本](../../../scripts/render-database-diagrams.mjs)。行为变更时更新相应模块的泳道和流程。

1.3 新入口和拟议数据表见[1.3 数据库设计](../database.md)。
