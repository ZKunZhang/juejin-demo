# 账号与会话设计图

[模块图册](./README.md) · [模块设计](../../1.2/accounts.md) · [服务端路由](../../../apps/api/app/app.ts)

## 泳道图

```mermaid
flowchart LR
    subgraph actor["操作者"]
        direction TB
        start["登录"]
        outcome["看到结果或错误"]
    end
    subgraph web["前端"]
        direction TB
        send["发送请求"]
        feedback["显示反馈"]
    end
    subgraph api["Fastify API"]
        direction TB
        guard["查询账号并校验密码与启用状态"]
        result["组织响应"]
    end
    subgraph storage["PostgreSQL"]
        direction TB
        query["轮换会话记录"]
    end
    start --> send --> guard --> query --> result --> feedback --> outcome
    guard -. 校验失败 .-> result
```

## 业务流程图

```mermaid
flowchart TD
    A["POST /api/auth/login"] --> B["查询账号并校验密码与启用状态"]
    B --> C{"校验通过？"}
    C -->|通过| D["轮换会话记录"]
    D -->|成功| E["返回登录成功并设置会话 Cookie"]
    C -->|失败| F["凭据无效则返回 401"]
    D -->|失败| F
```

## 数据表设计图

[打开双语表关系 SVG](./accounts.svg)

![账号与会话数据表和关联](./accounts.svg)
