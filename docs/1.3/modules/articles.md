# 文章设计图

[模块图册](./README.md) · [模块设计](../../1.2/articles.md) · [服务端路由](../../../apps/api/features/articles/articles.ts)

## 泳道图

```mermaid
flowchart LR
    subgraph actor["操作者"]
        direction TB
        start["打开文章列表"]
        outcome["看到结果或错误"]
    end
    subgraph web["前端"]
        direction TB
        send["发送请求"]
        feedback["显示反馈"]
    end
    subgraph api["Fastify API"]
        direction TB
        guard["解析筛选、排序和分页参数"]
        result["组织响应"]
    end
    subgraph storage["PostgreSQL"]
        direction TB
        query["查询符合条件的已发布文章"]
    end
    start --> send --> guard --> query --> result --> feedback --> outcome
    guard -. 校验失败 .-> result
```

## 业务流程图

```mermaid
flowchart TD
    A["GET /api/articles"] --> B["解析筛选、排序和分页参数"]
    B --> C{"校验通过？"}
    C -->|通过| D["查询符合条件的已发布文章"]
    D -->|成功| E["返回文章列表与分页结果"]
    C -->|失败| F["参数无效或游客请求关注流时返回错误"]
    D -->|失败| F
```

## 数据表设计图

[打开双语表关系 SVG](./articles.svg)

![文章数据表和关联](./articles.svg)
