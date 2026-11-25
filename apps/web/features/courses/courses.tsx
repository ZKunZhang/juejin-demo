import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, HttpError } from '../../../shared/api/api';
import { Pending } from '../../../shared/ui/pending';
import { Markdown, MarkdownWithToc } from '../../../shared/ui/markdown';
import { CommentSection } from '../../../shared/ui/comments';
import { AppSelect } from '../../../shared/ui/select';
import './courses.css';

type Category = { id: string; name: string; slug: string };
type Level = 'BEGINNER' | 'ADVANCED';
type Card = { id: string; title: string; summary: string; level: Level; category: Category; author: { displayName: string }; _count: { lessons: number } };
export type Course = Card & { description: string; lessons: { id: string; title: string; position: number }[]; related: Card[] };
type Lesson = { id: string; title: string; body: string; position: number; course: { id: string; title: string } };
const levels: Record<Level, string> = { BEGINNER: '入门', ADVANCED: '进阶' };

function CourseCover({ course }: { course: Card }) {
  return <div className="course-cover" data-level={course.level} aria-hidden="true">
    <span>{course.category.name}</span>
    <strong>{course.title}</strong>
    <span>{course.author.displayName}</span>
  </div>;
}


export function Courses() {
  const [params, setParams] = useSearchParams();
  const category = params.get('categoryId') || '';
  const level = params.get('level') || '';
  const query = new URLSearchParams();
  if (category) query.set('categoryId', category);
  if (level) query.set('level', level);
  const categories = useQuery({ queryKey: ['course-categories'], queryFn: ({ signal }) => api<Category[]>('/api/courses/categories', 'GET', undefined, signal) });
  const list = useQuery({ queryKey: ['courses', category, level], queryFn: ({ signal }) => api<Card[]>('/api/courses?' + query, 'GET', undefined, signal) });
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    next.delete('courseId');
    next.delete('lessonId');
    setParams(next);
  }
  return <main className="courses-page course-catalog">
    <div className="surface course-catalog-main"><div className="course-filter"><h1>课程小册</h1>
      <div className="course-filter-field"><span>分类</span><AppSelect label="分类" value={category}
        onChange={value => filter('categoryId', value)}
        options={[{ value: '', label: '全部分类' }, ...(categories.data ?? []).map(item => ({ value: item.id, label: item.name }))]}/></div>
      <div className="course-filter-field"><span>难度</span><AppSelect label="难度" value={level}
        onChange={value => filter('level', value)}
        options={[{ value: '', label: '全部难度' }, ...Object.entries(levels).map(([value, label]) => ({ value, label }))]}/></div>
      {categories.error && <button className="subtle" onClick={() => void categories.refetch()}>重试分类</button>}
    </div>
    {!list.data ? <div className="surface"><Pending error={list.error} retry={() => void list.refetch()}/></div> : list.data.length ?
      <ul className="course-list" aria-label="课程列表">{list.data.map(course => <li key={course.id}>
        <Link to={'/courses/' + course.id}>
          <CourseCover course={course}/>
          <div className="course-list-info"><h2>{course.title}</h2><p>{course.summary}</p>
            <span className="meta">{course.author.displayName} · {course.category.name} · {levels[course.level]} · {course._count.lessons} 章</span>
          </div>
        </Link>
      </li>)}</ul>
      : <div className="surface work-message"><p>没有符合条件的小册</p><button className="subtle"
        onClick={() => setParams(new URLSearchParams())}>重置筛选</button></div>}
    </div>
    <aside className="surface course-catalog-side"><h2>课程中心</h2><p>浏览技术小册，按章节阅读和讨论。</p></aside>
  </main>;
}

export function CoursePage() {
  const { id, lessonId } = useParams();
  return <main className={lessonId ? "courses-page course-lesson-page" : "courses-page"}><CourseReader key={id} courseId={id!} lessonId={lessonId}/></main>;
}

function CourseReader({ courseId, lessonId }: {
  courseId: string;
  lessonId?: string;
}) {
  const row = useQuery({ queryKey: ['course', courseId], queryFn: ({ signal }) => api<Course>('/api/courses/' + courseId, 'GET', undefined, signal) });
  if (!row.data) return <CourseFeedback error={row.error} retry={() => void row.refetch()}/>;
  const course = row.data;
  if (!lessonId) return <CourseOverview key={courseId} course={course}/>;
  return <div className="course-reader">
    <aside className="surface course-sidebar">
      <h2>{course.title}</h2>
      <p className="meta">{course.author.displayName} · {levels[course.level]} · {course.lessons.length} 章</p>
      <nav aria-label="课程目录"><h3>目录</h3>
        {course.lessons.length ? <ol className="course-directory">{course.lessons.map((item, index) => <li key={item.id}>
          <Link to={'/courses/' + courseId + '/lessons/' + item.id} aria-current={lessonId === item.id ? 'page' : undefined}>
            <span className="course-chapter-number" aria-hidden="true">{index + 1}</span><span className="course-chapter-title">{item.title}</span>
          </Link>
        </li>)}</ol> : <p className="meta">暂无公开章节</p>}
      </nav>
    </aside>
    <section className="surface course-reading" aria-label="课程内容">
      <LessonContent key={lessonId} courseId={courseId} lessonId={lessonId}/>
    </section>
  </div>;
}

function CourseOverview({ course }: { course: Course }) {
  const [params, setParams] = useSearchParams();
  const directory = params.get('tab') === 'directory';
  const firstLesson = course.lessons[0];
  const lessonUrl = (id: string) => '/courses/' + course.id + '/lessons/' + id;
  return <>
    <section className="surface course-hero">
      <CourseCover course={course}/>
      <div className="course-hero-info">
        <span className="meta">{course.category.name} · {levels[course.level]}</span>
        <h1>{course.title}</h1>
        <p>{course.summary}</p>
        <div className="course-hero-actions">
          {firstLesson && <Link className="primary" to={lessonUrl(firstLesson.id)}>开始阅读</Link>}
          <span className="meta">{course.author.displayName} · {course.lessons.length} 章</span>
        </div>
      </div>
    </section>
    <div className="course-overview">
      <section className="surface course-overview-main">
        <nav className="course-overview-tabs" aria-label="课程信息">
          <button type="button" aria-pressed={!directory} onClick={() => setParams({})}>介绍</button>
          <button type="button" aria-pressed={directory} onClick={() => setParams({ tab: 'directory' })}>目录</button>
        </nav>
        {directory ? <div className="course-overview-body">
          <h2>课程目录</h2>
          {course.lessons.length ? <ol className="course-directory" aria-label="章节列表">{course.lessons.map((lesson, index) =>
            <li key={lesson.id}><Link to={lessonUrl(lesson.id)}>
              <span className="course-chapter-number" aria-hidden="true">{index + 1}</span>{lesson.title}
            </Link></li>)}</ol> : <p className="meta">暂无公开章节</p>}
        </div> : <div className="course-overview-body"><h2>小册介绍</h2><Markdown source={course.description}/></div>}
      </section>
      {!!course.related.length && <aside className="surface course-related"><h2>推荐小册</h2>
        <ul>{course.related.map(item => <li key={item.id}><Link to={'/courses/' + item.id}>
          <CourseCover course={item}/><div><strong>{item.title}</strong><span className="meta">{item.category.name} · {item._count.lessons} 章</span></div>
        </Link></li>)}</ul>
      </aside>}
    </div>
  </>;
}

function LessonContent({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const row = useQuery({ queryKey: ['course-lesson', courseId, lessonId], queryFn: ({ signal }) => api<Lesson>('/api/courses/' + courseId + '/lessons/' + lessonId, 'GET', undefined, signal) });
  if (!row.data) return <CourseFeedback error={row.error} retry={() => void row.refetch()}/>;
  return <><h1>{row.data.title}</h1><MarkdownWithToc source={row.data.body} title="本章导航" after={<CommentSection label="章节评论" path={'/api/courses/'+courseId+'/lessons/'+lessonId+'/comments'}/>}/></>;
}

function CourseFeedback({ error, retry }: { error: Error | null; retry: () => void }) {
  return <div className="work-message">{error instanceof HttpError && error.status === 404 ? <><h1>小册或章节不可访问</h1><Link to="/courses">返回课程</Link></> : <Pending error={error} retry={retry}/>}</div>;
}
