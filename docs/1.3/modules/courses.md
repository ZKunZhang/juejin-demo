# 课程设计图

[模块图册](./README.md) · [模块设计](../../1.2/courses.md) · [服务端路由](../../../apps/api/features/courses/courses.ts)

## 泳道图

```mermaid
flowchart LR
    subgraph actor["操作者"]
        direction TB
        start["打开指定章节"]
        outcome["看到结果或错误"]
    end
    subgraph web["前端"]
        direction TB
        send["发送请求"]
        feedback["显示反馈"]
    end
    subgraph api["Fastify API"]
        direction TB
        guard["校验课程和章节 ID，并核对课程公开状态"]
        result["组织响应"]
    end
    subgraph storage["PostgreSQL"]
        direction TB
        query["查询指定课程下的章节"]
    end
    start --> send --> guard --> query --> result --> feedback --> outcome
    guard -. 校验失败 .-> result
```

## 业务流程图

```mermaid
flowchart TD
    A["GET /api/courses/:id/lessons/:lessonId"] --> B["校验课程和章节 ID，并核对课程公开状态"]
    B --> C{"校验通过？"}
    C -->|通过| D["查询指定课程下的章节"]
    D -->|成功| E["返回章节内容"]
    C -->|失败| F["课程或章节不存在时返回错误"]
    D -->|失败| F
```

## 数据表设计图

[打开双语表关系 SVG](./courses.svg)

![课程数据表和关联](./courses.svg)
