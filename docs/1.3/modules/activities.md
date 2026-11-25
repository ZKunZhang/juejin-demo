# 活动设计图

[模块图册](./README.md) · [模块设计](../../1.2/activities.md) · [服务端路由](../../../apps/api/features/activities/activities.ts)

## 泳道图

```mermaid
flowchart LR
    subgraph actor["操作者"]
        direction TB
        start["编辑已有活动"]
        outcome["看到结果或错误"]
    end
    subgraph web["前端"]
        direction TB
        send["发送请求"]
        feedback["显示反馈"]
    end
    subgraph api["Fastify API"]
        direction TB
        guard["校验管理员权限与表单数据"]
        result["组织响应"]
    end
    subgraph storage["PostgreSQL"]
        direction TB
        query["按 ID 和版本更新活动并递增版本"]
    end
    start --> send --> guard --> query --> result --> feedback --> outcome
    guard -. 校验失败 .-> result
```

## 业务流程图

```mermaid
flowchart TD
    A["PATCH /api/admin/activities/:id"] --> B["校验管理员权限与表单数据"]
    B --> C{"校验通过？"}
    C -->|通过| D["按 ID 和版本更新活动并递增版本"]
    D -->|成功| E["返回更新后的活动"]
    C -->|失败| F["记录缺失或版本冲突时返回错误"]
    D -->|失败| F
```

## 数据表设计图

[打开双语表关系 SVG](./activities.svg)

![活动数据表和关联](./activities.svg)
