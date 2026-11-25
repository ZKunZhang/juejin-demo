# 码栈 1.3

1.3 调整源码组织和沸点前台的页面层级。既有社区模块沿用 [1.2 模块设计](../1.2/README.md)。更早资料见 [1.1 设计快照](../1.1/README.md)。

| 资料 | 内容 |
| --- | --- |
| [源码目录分层](./architecture.md) | 应用入口、业务目录、共享层与依赖方向 |
| [沸点页面](./pulses.md) | 信息排序、发布区、侧栏和移动端 |
| [版本变化与验证](./changes.md) | 路径迁移、兼容性与运行验证 |

## 扩展导航与数据设计

四个新增入口均指向站内页面。AI 用量、作品和专家标注使用 PostgreSQL；本地开发库已初始化演示数据。

| 入口 | 地址 | 当前进度 |
| --- | --- | --- |
| APP | `/download#feature` | 站内客户端介绍、功能与常见问题，可打开网页版。安装包暂未发布 |
| AI 用量 | `/ai-usage`、`/ai-usage/leaderboard`、`/ai-usage/prices` | 个人统计、热力图、公开排行、模型价格 |
| 作品广场 | `/projects` | 热门横向滚动、列表筛选、详情与点赞；创作者提交及后台审核、上下架、删除 |
| 专家标注 | `/expert-annotation` | 演示任务列表、登录领取、提交及本人结果 |

[数据库设计](./database.md) · [数据库设计 HTML](./database-design-v1.3.html) · [模块测试用例](./module-test-cases.md) · [1.2 设计](../1.2/README.md)

[当前数据库关系图与评论写入时序](./code-and-database-diagrams.md)

[按模块查看泳道图、流程图和数据表设计](./modules/README.md)
