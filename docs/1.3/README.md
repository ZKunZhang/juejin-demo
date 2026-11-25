# 码栈 1.3 导航与数据设计

1.3 新增 APP、AI 用量、作品广场和专家标注入口。AI 用量提供三个可直接访问的页面。作品广场和专家标注提供独立入口及接入状态。数据库方案供下一阶段实现，当前版本尚未创建新表。

| 入口 | 地址 | 当前进度 |
| --- | --- | --- |
| APP | [APP 与浏览器插件](https://juejin.cn/download#feature) | 已接入指定地址 |
| AI 用量 | `/ai-usage`、`/ai-usage/leaderboard`、`/ai-usage/prices` | 页面和用量周期切换已接入，等待统计和价格数据 |
| 作品广场 | `/projects` | 页面已接入，等待作品发布与审核 |
| 专家标注 | `/expert-annotation` | 入口已预留，等待任务和权限规则确定 |

[数据库设计](./database.md) · [数据库设计 HTML](./database-design-v1.3.html) · [模块测试用例](./module-test-cases.md) · [1.2 设计](../1.2/README.md)

[当前数据库关系图与评论写入时序](./code-and-database-diagrams.md)
