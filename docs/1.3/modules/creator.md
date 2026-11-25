# 创作者中心设计图

[模块图册](./README.md) · [模块设计](../../1.2/creator.md) · [服务端路由](../../../apps/api/features/creator/creator.ts)

## 泳道图

```mermaid
flowchart LR
    subgraph actor["操作者"]
        direction TB
        start["打开创作者中心"]
        outcome["看到结果或错误"]
    end
    subgraph web["前端"]
        direction TB
        send["发送请求"]
        feedback["显示反馈"]
    end
    subgraph api["Fastify API"]
        direction TB
        guard["校验登录并确定当前作者"]
        result["组织响应"]
    end
    subgraph storage["PostgreSQL"]
        direction TB
        query["查询作者内容与聚合数据"]
    end
    start --> send --> guard --> query --> result --> feedback --> outcome
    guard -. 校验失败 .-> result
```

## 业务流程图

```mermaid
flowchart TD
    A["GET /api/me/creator"] --> B["校验登录并确定当前作者"]
    B --> C{"校验通过？"}
    C -->|通过| D["查询作者内容与聚合数据"]
    D -->|成功| E["返回创作数据"]
    C -->|失败| F["未登录时返回认证错误"]
    D -->|失败| F
```

## 数据表设计图

[打开双语表关系 SVG](./creator.svg)

![创作者中心数据表和关联](./creator.svg)
