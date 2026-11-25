import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { api } from './api';
import { Pending } from './articles';

export function CourseReadingEntry() {
  const [params] = useSearchParams();
  const courseId = params.get('courseId');
  const lessonId = params.get('lessonId');
  const filters = new URLSearchParams();
  for (const name of ['categoryId', 'level']) {
    const value = params.get(name);
    if (value) filters.set(name, value);
  }
  const search = filters.toString();
  const courses = useQuery({
    queryKey: ['courses', filters.get('categoryId') ?? '', filters.get('level') ?? ''],
    queryFn: ({ signal }) => api<{ id: string }[]>('/api/courses?' + search, 'GET', undefined, signal),
  });
  if (!courses.data) return <main className="surface work"><Pending error={courses.error} retry={() => void courses.refetch()}/></main>;
  const course = courses.data.find(item => item.id === courseId) ?? courses.data[0];
  if (!course) return <main className="surface work"><p>没有可阅读的小册</p><Link to="/courses">浏览全部小册</Link></main>;
  const lesson = courseId === course.id && lessonId ? '/lessons/' + encodeURIComponent(lessonId) : '';
  return <Navigate to={'/courses/' + course.id + lesson} replace/>;
}
