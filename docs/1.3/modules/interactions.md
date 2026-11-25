# 互动、收藏与关注设计图

[模块图册](./README.md) · [模块设计](../../1.2/interactions.md) · [服务端路由](../../../apps/api/features/community/interactions.ts)

## 泳道图

```mermaid
flowchart LR
    subgraph actor["操作者"]
        direction TB
        start["收藏文章或选择收藏夹"]
        outcome["看到结果或错误"]
    end
    subgraph web["前端"]
        direction TB
        send["发送请求"]
        feedback["显示反馈"]
    end
    subgraph api["Fastify API"]
        direction TB
        guard["校验会话；添加收藏时检查文章状态和指定收藏夹归属"]
        result["组织响应"]
    end
    subgraph storage["PostgreSQL"]
        direction TB
        query["按 active 写入或移除收藏"]
    end
    start --> send --> guard --> query --> result --> feedback --> outcome
    guard -. 校验失败 .-> result
```

## 业务流程图

```mermaid
flowchart TD
    A["PUT /api/articles/:id/bookmark"] --> B["校验会话；添加收藏时检查文章状态和指定收藏夹归属"]
    B --> C{"校验通过？"}
    C -->|通过| D["按 active 写入或移除收藏"]
    D -->|成功| E["返回该用户的收藏状态"]
    C -->|失败| F["文章或指定收藏夹不可用时返回错误"]
    D -->|失败| F
```

## 数据表设计图

[打开双语表关系 SVG](./interactions.svg)

![互动、收藏与关注数据表和关联](./interactions.svg)
