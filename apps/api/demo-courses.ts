import type { PrismaClient } from '../../generated/prisma/client';

export async function seedCourses(db:PrismaClient) {
  const author=await db.user.findUniqueOrThrow({where:{username:'author_alpha'}});
  const categories=[
    {slug:'frontend',name:'前端',sortOrder:1},
    {slug:'backend',name:'后端',sortOrder:2},
    {slug:'ai',name:'人工智能',sortOrder:3},
  ];
  const items=[
    {category:'frontend', title:'React 前端工程实践',summary:'从一个社区应用出发，练习路由、状态与组件边界。',level:'ADVANCED',chapters:['整理页面和状态边界','接通接口与缓存','验证加载与错误状态']},
    {category:'backend', title:'PostgreSQL 应用入门',summary:'用用户、文章和标签学习关系建模、索引与事务。',level:'BEGINNER',chapters:['认识外键与约束','创建第一批迁移','用事务保护关联写入']},
    {category:'ai', title:'构建第一个 AI 工具',summary:'从一个输入表单着手，为模型调用设计可验证的流程。',level:'BEGINNER',chapters:['确定输入和预期输出','处理失败和重试','记录请求指标']},
    {category:'frontend', title:'Markdown 内容页面入门',summary:'练习渲染、标题锚点和目录导航。',level:'BEGINNER',chapters:['渲染 Markdown','创建稳定的目录锚点','测试移动端可读性']},
  ] as const;
  await db.$transaction(async tx=>{
    const rows=await Promise.all(categories.map(item=>tx.courseCategory.upsert({where:{slug:item.slug},update:{},create:item})));
    for(const [index,item] of items.entries()){
      const category=rows.find(row=>row.slug===item.category)!;
      const id='459198df-f3de-4651-a8e1-a05a5b35010'+(index+1);
      await tx.course.upsert({where:{id},update:{},create:{
        id,categoryId:category.id,authorId:author.id,title:item.title,summary:item.summary,level:item.level,status:'PUBLISHED',publishedAt:new Date(Date.now()-index*86400000),
        description:item.summary+'\n\n## 学习方式\n每章提供一个实践目标和检查项，可以按目录顺序边读边验证。',
        lessons:{create:item.chapters.map((title,i)=>({title,position:i+1,status:'PUBLISHED',body:'## '+title+'\n\n为本节主题选一个最小示例。\n\n### 练习\n1. 写下输入与期望。\n2. 实现核心路径。\n3. 验证正常和失败场景。'}))},
      }});
    }
  });
}
