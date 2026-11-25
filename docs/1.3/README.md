# 码栈 1.3

1.3 调整源码组织和沸点前台的页面层级。账号、数据模型、业务权限和 API 契约沿用 [1.2 模块设计](../1.2/README.md)。更早资料见 [1.1 设计快照](../1.1/README.md)。

| 资料 | 内容 |
| --- | --- |
| [源码目录分层](./architecture.md) | 应用入口、业务目录、共享层与依赖方向 |
| [沸点页面](./pulses.md) | 信息排序、发布区、侧栏和移动端 |
| [版本变化与验证](./changes.md) | 路径迁移、兼容性与运行验证 |

## 扩展导航与数据设计

1.3 新增 APP、AI 用量、作品广场和专家标注入口。AI 用量提供三个可直接访问的页面。作品广场和专家标注提供独立入口及接入状态。数据库方案供下一阶段实现，当前版本尚未创建新表。

| 入口 | 地址 | 当前进度 |
| --- | --- | --- |
| APP | [APP 与浏览器插件](https://juejin.cn/download#feature) | 已接入指定地址 |
| AI 用量 | `/ai-usage`、`/ai-usage/leaderboard`、`/ai-usage/prices` | 页面和用量周期切换已接入，等待统计和价格数据 |
| 作品广场 | `/projects` | 页面已接入，等待作品发布与审核 |
| 专家标注 | `/expert-annotation` | 入口已预留，等待任务和权限规则确定 |

[数据库设计](./database.md) · [数据库设计 HTML](./database-design-v1.3.html) · [模块测试用例](./module-test-cases.md) · [1.2 设计](../1.2/README.md)

[当前数据库关系图与评论写入时序](./code-and-database-diagrams.md)

[按模块查看泳道图、流程图和数据表设计](./modules/README.md)
