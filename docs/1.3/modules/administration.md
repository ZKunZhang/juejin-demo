# 后台审核设计图

[模块图册](./README.md) · [模块设计](../../1.2/administration.md) · [服务端路由](../../../apps/api/features/articles/moderation.ts)

## 泳道图

```mermaid
flowchart LR
    subgraph actor["操作者"]
        direction TB
        start["审核文章"]
        outcome["看到结果或错误"]
    end
    subgraph web["前端"]
        direction TB
        send["发送请求"]
        feedback["显示反馈"]
    end
    subgraph api["Fastify API"]
        direction TB
        guard["校验管理员权限、审核动作与版本"]
        result["组织响应"]
    end
    subgraph storage["PostgreSQL"]
        direction TB
        query["事务内更新文章并写入审核记录"]
    end
    start --> send --> guard --> query --> result --> feedback --> outcome
    guard -. 校验失败 .-> result
```

## 业务流程图

```mermaid
flowchart TD
    A["POST /api/admin/articles/:id/review"] --> B["校验管理员权限、审核动作与版本"]
    B --> C{"校验通过？"}
    C -->|通过| D["事务内更新文章并写入审核记录"]
    D -->|成功| E["返回审核结果"]
    C -->|失败| F["权限不足或状态及版本冲突时返回错误"]
    D -->|失败| F
```

## 数据表设计图

[打开双语表关系 SVG](./administration.svg)

![后台审核数据表和关联](./administration.svg)
