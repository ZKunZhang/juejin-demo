import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, HttpError } from './api';
import { Pending } from './articles';
import { Markdown } from './markdown';
import './courses.css';

type Category={id:string;name:string;slug:string};
type Level='BEGINNER'|'ADVANCED';
type Card={id:string;title:string;summary:string;level:Level;category:Category;author:{displayName:string};_count:{lessons:number}};
type Course=Card&{description:string;lessons:{id:string;title:string;position:number}[];related:Card[]};
type Lesson={id:string;title:string;body:string;position:number;course:{id:string;title:string}};
const levels:Record<Level,string>={BEGINNER:'入门',ADVANCED:'进阶'};

export function Courses() {
  const [params,setParams]=useSearchParams();
  const category=params.get('categoryId')||'',level=params.get('level')||'';
  const query=new URLSearchParams();
  if(category)query.set('categoryId',category);
  if(level)query.set('level',level);
  const categories=useQuery({queryKey:['course-categories'],queryFn:({signal})=>api<Category[]>('/api/courses/categories','GET',undefined,signal)});
  const list=useQuery({queryKey:['courses',category,level],queryFn:({signal})=>api<Card[]>('/api/courses?'+query,'GET',undefined,signal)});
  function filter(key:string,value:string) {
    const next=new URLSearchParams(params);if(value)next.set(key,value);else next.delete(key);
    setParams(next);
  }
  return <main className="courses-page">
    <div className="surface course-filter"><h1>课程小册</h1>
      <label>分类<select value={category} onChange={event=>filter('categoryId',event.target.value)}><option value="">全部分类</option>{categories.data?.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>难度<select value={level} onChange={event=>filter('level',event.target.value)}><option value="">全部难度</option>{Object.entries(levels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      {categories.error&&<button className="subtle" onClick={()=>void categories.refetch()}>重试分类</button>}
    </div>
    {!list.data?<div className="surface"><Pending error={list.error} retry={()=>void list.refetch()}/></div>:list.data.length?<div className="course-cards">{list.data.map(item=><CourseCard key={item.id} course={item}/>)}</div>:
      <div className="surface work-message"><p>没有符合条件的小册</p><button className="subtle" onClick={()=>setParams(new URLSearchParams())}>重置筛选</button></div>}
  </main>;
}
function CourseCard({course}:{course:Card}) {
  return <article className="surface course-card"><div className={'course-cover '+course.category.slug} aria-hidden="true"><span>{course.category.name}</span></div>
    <div><span className="tag">{levels[course.level]}</span><h2><Link to={'/courses/'+course.id}>{course.title}</Link></h2>
    <p>{course.summary}</p><p className="meta">{course.author.displayName} · {course._count.lessons} 章</p></div>
  </article>;
}
export function CoursePage() {
  const {id}=useParams();
  const [params,setParams]=useSearchParams();
  const directory=params.get('tab')==='directory';
  const row=useQuery({queryKey:['course',id],queryFn:({signal})=>api<Course>('/api/courses/'+id,'GET',undefined,signal)});
  if(!row.data)return <CourseFeedback error={row.error} retry={()=>void row.refetch()}/>;
  const course=row.data;
  return <main className="courses-page course-detail"><div>
    <section className="surface course-overview"><Link to="/courses">全部小册</Link><div className={'course-cover '+course.category.slug} aria-hidden="true"><span>{course.category.name}</span></div>
    <h1>{course.title}</h1><p>{course.summary}</p><p className="meta">{course.author.displayName} · {levels[course.level]} · {course._count.lessons} 章</p></section>
    <section className="surface course-content"><nav aria-label="小册内容"><button className="subtle" aria-pressed={!directory} onClick={()=>setParams(new URLSearchParams())}>介绍</button><button className="subtle" aria-pressed={directory} onClick={()=>setParams(new URLSearchParams({tab:'directory'}))}>目录</button></nav>
    {directory?<>{course.lessons.length?<ol className="course-directory">{course.lessons.map(item=><li key={item.id}><Link to={'/courses/'+course.id+'/lessons/'+item.id}>{item.title}</Link></li>)}</ol>:<p className="meta">暂无公开章节</p>}</>:<Markdown source={course.description}/>}</section>
    </div><aside className="surface side"><h2>推荐小册</h2>{course.related.length?<ul className="toc-list">{course.related.map(item=><li key={item.id}><Link to={'/courses/'+item.id}>{item.title}</Link></li>)}</ul>:<p>暂无推荐</p>}</aside>
  </main>;
}
export function LessonPage() {
  const {id,lessonId}=useParams();
  const row=useQuery({queryKey:['course-lesson',id,lessonId],queryFn:({signal})=>api<Lesson>('/api/courses/'+id+'/lessons/'+lessonId,'GET',undefined,signal)});
  if(!row.data)return <CourseFeedback error={row.error} retry={()=>void row.refetch()}/>;
  return <main className="surface work"><Link to={'/courses/'+row.data.course.id+'?tab=directory'}>返回《{row.data.course.title}》目录</Link><h1>{row.data.title}</h1><Markdown source={row.data.body}/></main>;
}
function CourseFeedback({error,retry}:{error:Error|null;retry:()=>void}) {
  return <main className="surface work">{error instanceof HttpError&&error.status===404?<><h1>小册或章节不可访问</h1><Link to="/courses">返回课程</Link></>:<Pending error={error} retry={retry}/>}</main>;
}
