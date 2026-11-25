import { createHash } from 'node:crypto';
import type { PrismaClient } from '../../../../generated/prisma/client';

const usernames=['author_alpha','reader_beta','reader_gamma'] as const;
const day=86_400_000;

export async function seedExpansion(db:PrismaClient) {
  const users=await db.user.findMany({where:{username:{in:[...usernames,'admin_demo']}}});
  const userId=(name:string)=>{
    const user=users.find(row=>row.username===name);
    if (!user) throw new Error('缺少演示账号 '+name);
    return user.id;
  };
  const now=new Date();
  await db.$transaction(async tx=>{
    const categories=await tx.projectCategory.findMany({orderBy:{sortOrder:'asc'}});
    const platforms=await tx.projectPlatform.findMany({orderBy:{sortOrder:'asc'}});
    if (categories.length<3 || platforms.length<3) throw new Error('请先应用作品迁移');
    const examples=[
      ['组件试验台','记录组件在不同容器宽度下的状态、留白和键盘交互。'],
      ['查询计划笔记','用小型数据集记录 PostgreSQL 查询计划与索引对比。'],
      ['开发进度板','在一个页面查看里程碑、任务变更与发布记录。'],
      ['课程复习清单','按知识点回顾学习内容，给未解决的问题留标记。'],
      ['命令行备忘录','把经常忘记的开发命令按场景收集起来。'],
      ['无障碍巡检表','跟踪可聚焦元素、提示文案与表单反馈。'],
    ] as const;
    for (const [index,[title,summary]] of examples.entries()) {
      const id='b749da09-2412-4a97-a856-91ec5520930'+(index+1);
      const authorId=userId(usernames[index%usernames.length]);
      const submittedAt=new Date(now.getTime()-index*day);
      const published=index!==examples.length-1;
      await tx.project.upsert({where:{id},update:{},create:{
        id,authorId,title:'【演示】'+title,summary,bodyMarkdown:'## 作品介绍\n\n'+summary+'\n\n此作品为本地演示数据，外链指向演示占位地址。',
        projectUrl:'https://example.com/',status:published?'PUBLISHED':'PENDING',submittedAt,
        publishedAt:published?submittedAt:null,version:published?3:2,
        categoryLinks:{create:{categoryId:categories[index%3].id}},
        platformLinks:{create:{platformId:platforms[(index+1)%3].id}},
        reviews:{create:[
          {actorId:authorId,version:2,previousStatus:'DRAFT',nextStatus:'PENDING',action:'SUBMIT'},
          ...(published?[{actorId:userId('admin_demo'),version:3,previousStatus:'PENDING' as const,nextStatus:'PUBLISHED' as const,action:'APPROVE'}]:[]),
        ]},
        likes:published?{create:usernames.slice(0,index%3+1).map(name=>({userId:userId(name)}))}:undefined,
        viewWindows:published?{create:Array.from({length:(index+1)*2},(_,viewer)=>({viewerKey:createHash('sha256').update('demo-'+viewer).digest('hex'),windowStart:submittedAt}))}:undefined,
      }});
    }
    const provider=await tx.aiProvider.upsert({where:{slug:'mazhan-demo'},update:{},create:{slug:'mazhan-demo',name:'码栈虚拟供应商（演示）'}});
    const tools=[];
    for (const [slug,name] of [['demo-editor','演示编辑器'],['demo-agent','演示工作台']]) {
      tools.push(await tx.aiTool.upsert({where:{slug},update:{},create:{slug,name}}));
    }
    const models=[];
    for (const [index,modelKey] of ['demo-code','demo-reasoning'].entries()) {
      const model=await tx.aiModel.upsert({where:{providerId_modelKey:{providerId:provider.id,modelKey}},update:{},
        create:{providerId:provider.id,modelKey,name:index?'推理模型（演示）':'编程模型（演示）'}});
      const id='9e1c7600-6f02-4f8a-9bcc-0b78149b810'+(index+1);
      const inputPrice=index?'2.00':'1.00';
      const outputPrice=index?'6.00':'3.00';
      const price=await tx.aiModelPrice.upsert({where:{id},update:{},create:{
        id,modelId:model.id,currency:'USD',effectiveFrom:new Date('2025-01-01T00:00:00Z'),
        inputPrice,outputPrice,observedAt:now,cacheReadPrice:'0.20',cacheWritePrice:'0.40',sourceUrl:'https://example.com/',
      }});
      models.push({model,price});
    }
    for (const [index,name] of usernames.entries()) {
      const id=userId(name);
      await tx.aiUsagePreference.upsert({where:{userId:id},update:{},create:{userId:id,publicLeaderboard:true}});
      const sources=[];
      for (const [toolIndex,tool] of tools.entries()) {
        const sourceId='37b51a2d-5350-4cea-8309-bda77bd0bd'+(index+1)+(toolIndex+1);
        sources.push(await tx.aiUsageSource.upsert({where:{id:sourceId},update:{},create:{id:sourceId,userId:id,toolId:tool.id,label:'演示来源 · '+tool.name}}));
      }
      for (const [sample,daysAgo] of [0,1,3,6,10,17,25,38,58,78].entries()) {
        const occurredAt=new Date(now.getTime()-daysAgo*day);
        const {model,price}=models[sample%models.length];
        const input=(index+1)*4800+(sample+1)*1300;
        const output=700+(sample+index)*170;
        const estimatedCostUsd=price.inputPrice.mul(input).add(price.outputPrice.mul(output)).div(1000000);
        const source=sources[sample%sources.length];
        await tx.aiUsageEvent.upsert({
          where:{sourceId_sourceEventKey:{sourceId:source.id,sourceEventKey:'v13-demo-'+sample}},
          update:{occurredAt},
          create:{sourceId:source.id,sourceEventKey:'v13-demo-'+sample,modelId:model.id,occurredAt,
            inputTokens:BigInt(input),unclassifiedInputTokens:0n,outputTokens:BigInt(output),cacheReadTokens:0n,cacheWriteTokens:0n,priceId:price.id,estimatedCostUsd},
        });
      }
    }
    const tasks=[
      ['文章摘要质量标注','对一段技术摘要判断信息是否清楚、是否有可验证的结论。','示例摘要：使用更小的组件让页面更容易维护。请说明它遗漏了哪些可以验证的信息，并给出改写。'],
      ['代码解释准确性标注','指出一段代码解读里的遗漏或歧义。','样例：数组的 map 会改变数组。请判断该说法，说明返回值和源数组的关系。'],
      ['无障碍反馈分类','为表单问题补充分类和改进建议。','样例：表单验证失败时只给错误边框，屏幕阅读器没有读出原因。请标明问题类型并给出建议。'],
    ] as const;
    for (const [index,[title,summary,instructions]] of tasks.entries()) {
      const id='75a8a3ef-2315-4ca4-94da-38ae44d2280'+(index+1);
      await tx.expertTask.upsert({where:{id},update:{},create:{id,title,summary,instructions,isDemo:true,status:'OPEN'}});
    }
  });
  console.log('v1.3 演示数据已初始化：6 个作品、30 条 AI 用量、3 个标注任务。');
}
