# 码栈数据库与评论流程图

- [核心关系总览](./database-overview.svg)保留用户、内容、评论、分类、收藏、关注和通知。字段、枚举以及会话、点赞、审核、签到和阅读计数辅助表在完整图中查看。
- [完整数据库关系图](./database-erd.svg)包含 Prisma 模型、字段、枚举和关系。

两张图均从[当前 Prisma schema](../../prisma/schema.prisma)生成。修改模型后运行 `npm run db:diagram` 更新。业务模块新增或拆分时，检查总览的筛选范围。

文章与沸点的回复关系由外键和 [SQL 触发器](../../prisma/migrations/202611250020_comment_thread_integrity/migration.sql)共同约束。触发器要求回复指向同一内容下的顶层评论。两套评论的父评论删除策略不同，文章使用 `Restrict`，沸点使用 `Cascade`。评审删除策略时需同时核对审核记录保留要求和实际删除入口。

[按模块查看泳道、流程与中英双语数据表图](./modules/README.md)。

## 文章评论写入时序

来源为[文章评论写入路由](../../apps/api/features/community/interactions.ts#L44)。

```mermaid
sequenceDiagram
    actor U as 读者
    participant W as 前台评论区
    participant A as Fastify API
    participant D as PostgreSQL
    U->>W: 提交评论或回复
    W->>A: POST /api/articles/:id/comments
    A->>A: 校验请求参数、写入安全要求与登录
    alt 请求校验失败
        A-->>W: 返回对应错误
    else 请求通过
        A->>D: 开启事务并查找已发布文章 FOR SHARE
        alt 找不到已发布文章
            A-->>W: 返回文章不存在
        else 找到文章
            opt 提交了 parentId
                A->>D: 查找同文章的可见顶层评论 FOR SHARE
            end
            alt 指定的父评论不可回复
                A-->>W: 返回 404 COMMENT_NOT_FOUND
            else 顶层评论或有效回复
                A->>D: 写入去掉首尾空白的正文并提交事务
                A-->>W: 返回 201 和新评论
            end
        end
    end
```

评论接口或事务规则变更时，按路由更新时序图。
