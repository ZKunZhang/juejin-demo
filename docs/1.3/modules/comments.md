# 评论设计图

[模块图册](./README.md) · [模块设计](../../1.2/comments.md) · [服务端路由](../../../apps/api/features/community/interactions.ts)

## 泳道图

```mermaid
flowchart LR
    subgraph actor["操作者"]
        direction TB
        start["在文章下发表评论或回复"]
        outcome["看到结果或错误"]
    end
    subgraph web["前端"]
        direction TB
        send["发送请求"]
        feedback["显示反馈"]
    end
    subgraph api["Fastify API"]
        direction TB
        guard["校验会话，确认文章已发布；回复须指向同文章的可见顶层评论"]
        result["组织响应"]
    end
    subgraph storage["PostgreSQL"]
        direction TB
        query["在事务内写入评论"]
    end
    start --> send --> guard --> query --> result --> feedback --> outcome
    guard -. 校验失败 .-> result
```

## 业务流程图

```mermaid
flowchart TD
    A["POST /api/articles/:id/comments"] --> B["校验会话，确认文章已发布；回复须指向同文章的可见顶层评论"]
    B --> C{"校验通过？"}
    C -->|通过| D["在事务内写入评论"]
    D -->|成功| E["返回 201 与新评论"]
    C -->|失败| F["文章或可回复的父评论不存在时返回错误"]
    D -->|失败| F
```

## 数据表设计图

[打开双语表关系 SVG](./comments.svg)

![评论数据表和关联](./comments.svg)
