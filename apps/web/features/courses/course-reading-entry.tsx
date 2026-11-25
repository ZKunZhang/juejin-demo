import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { api } from '../../../shared/api/api';
import { Pending } from '../../../shared/ui/pending';
import type { Course } from './courses';

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
  const course = courses.data?.find(item => item.id === courseId) ?? courses.data?.[0];
  const details = useQuery({
    queryKey: ['course', course?.id],
    enabled: !!course,
    queryFn: ({ signal }) => api<Course>('/api/courses/' + course!.id, 'GET', undefined, signal),
  });
  if (!courses.data) return <main className="surface work"><Pending error={courses.error} retry={() => void courses.refetch()}/></main>;
  if (!course) return <main className="surface work"><p>没有可阅读的小册</p><Link to="/courses">浏览全部小册</Link></main>;
  if (!details.data) return <main className="surface work"><Pending error={details.error} retry={() => void details.refetch()}/></main>;
  const lessons = details.data.lessons;
  const selected = (courseId === course.id && lessons.find(item => item.id === lessonId)) || lessons[0];
  return <Navigate to={'/courses/' + course.id + (selected ? '/lessons/' + selected.id : '')} replace/>;
}
