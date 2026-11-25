# 个人主页设计图

[模块图册](./README.md) · [模块设计](../../1.2/profiles.md) · [服务端路由](../../../apps/api/features/community/interactions.ts)

## 泳道图

```mermaid
flowchart LR
    subgraph actor["操作者"]
        direction TB
        start["打开个人主页并切换内容视图"]
        outcome["看到结果或错误"]
    end
    subgraph web["前端"]
        direction TB
        send["发送请求"]
        feedback["显示反馈"]
    end
    subgraph api["Fastify API"]
        direction TB
        guard["校验会话、视图和页码"]
        result["组织响应"]
    end
    subgraph storage["PostgreSQL"]
        direction TB
        query["以当前账号读取个人资料、统计和对应内容"]
    end
    start --> send --> guard --> query --> result --> feedback --> outcome
    guard -. 校验失败 .-> result
```

## 业务流程图

```mermaid
flowchart TD
    A["GET /api/me/profile"] --> B["校验会话、视图和页码"]
    B --> C{"校验通过？"}
    C -->|通过| D["以当前账号读取个人资料、统计和对应内容"]
    D -->|成功| E["返回个人数据和分页内容"]
    C -->|失败| F["未登录或查询参数无效时返回错误"]
    D -->|失败| F
```

## 数据表设计图

[打开双语表关系 SVG](./profiles.svg)

![个人主页数据表和关联](./profiles.svg)
