# 站内通知设计图

[模块图册](./README.md) · [模块设计](../../1.2/notifications.md) · [服务端路由](../../../apps/api/features/community/notifications.ts)

## 泳道图

```mermaid
flowchart LR
    subgraph actor["操作者"]
        direction TB
        start["将通知标为已读"]
        outcome["看到结果或错误"]
    end
    subgraph web["前端"]
        direction TB
        send["发送请求"]
        feedback["显示反馈"]
    end
    subgraph api["Fastify API"]
        direction TB
        guard["校验登录，按当前接收人定位通知"]
        result["组织响应"]
    end
    subgraph storage["PostgreSQL"]
        direction TB
        query["对未读记录写入已读时间"]
    end
    start --> send --> guard --> query --> result --> feedback --> outcome
    guard -. 校验失败 .-> result
```

## 业务流程图

```mermaid
flowchart TD
    A["PUT /api/me/notifications/:id/read"] --> B["校验登录，按当前接收人定位通知"]
    B --> C{"校验通过？"}
    C -->|通过| D["对未读记录写入已读时间"]
    D -->|成功| E["返回 204，重复提交已读通知也成功"]
    C -->|失败| F["该用户找不到通知时返回错误"]
    D -->|失败| F
```

## 数据表设计图

[打开双语表关系 SVG](./notifications.svg)

![站内通知数据表和关联](./notifications.svg)
