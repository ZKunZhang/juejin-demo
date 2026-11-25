import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Input, Select } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { api, HttpError } from '../../../shared/api/api';
import { useSession } from '../../../shared/auth/session';
import { Pending } from '../../../shared/ui/pending';
import { Markdown } from '../../../shared/ui/markdown';
import './projects.css';

type Directory = { id: string; slug: string; name: string };
type Options = { categories: Directory[]; platforms: Directory[] };
export type Project = {
  id: string; title: string; summary: string; bodyMarkdown: string;
  coverUrl: string | null; projectUrl: string; repositoryUrl: string | null;
  status: 'DRAFT' | 'PENDING' | 'PUBLISHED' | 'REJECTED' | 'UNLISTED';
  version: number; submittedAt: string | null; publishedAt: string | null;
  author: { id: string; displayName: string };
  categories: Directory[]; platforms: Directory[];
  viewCount: number; likeCount: number; liked?: boolean;
};
const statusLabels: Record<Project['status'], string> = {
  DRAFT: '草稿', PENDING: '待审核', PUBLISHED: '已发布', REJECTED: '已驳回', UNLISTED: '已下架',
};
const failureMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试';
const directoryOptions = (items: Directory[]) => items.map(item => ({ value: item.id, label: item.name }));
const useProjectOptions = () => useQuery({ queryKey: ['project-options'], queryFn: ({ signal }) => api<Options>('/api/project-options', 'GET', undefined, signal) });

function ProjectCover({ project }: { project: Pick<Project, 'title' | 'coverUrl'> }) {
  const [failed, setFailed] = useState(false);
  if (!project.coverUrl || failed) return <div className="project-cover project-cover-empty" aria-hidden="true"><span>{Array.from(project.title)[0]}</span></div>;
  return <img className="project-cover" src={project.coverUrl} alt={project.title + '封面'} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>;
}

export function ProjectGallery() {
  const [params, setParams] = useSearchParams();
  const options = useProjectOptions();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const sort = ['likes', 'views', 'latest'].includes(params.get('sort') ?? '') ? params.get('sort')! : 'latest';
  const query = new URLSearchParams(params);
  query.set('page', String(page));
  query.set('sort', sort);
  const list = useQuery({ queryKey: ['projects', query.toString()], queryFn: ({ signal }) => api<{ items: Project[]; hasMore: boolean }>('/api/projects?' + query, 'GET', undefined, signal) });
  const popular = useQuery({ queryKey: ['projects-popular'], queryFn: ({ signal }) => api<{ items: Project[] }>('/api/projects?sort=likes&page=1', 'GET', undefined, signal) });
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.delete('page');
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  }
  return <main className="projects-page">
    <header className="projects-hero">
      <div>
        <h1>作品广场</h1>
        <p>把想法做成作品，让实践在这里被看见。</p>
      </div>
      <Link className="primary" to="/creator/projects">发布我的作品 <span aria-hidden="true">↗</span></Link>
    </header>
    {!!popular.data?.items.length && <PopularProjects items={popular.data.items.slice(0,10)}/>}
    <section className="project-filters" aria-label="作品筛选">
      {!options.data ? <Pending error={options.error} retry={() => void options.refetch()}/> : <>
        <Select aria-label="作品分类" value={params.get('categoryId') || ''} options={[{ value: '', label: '全部分类' }, ...directoryOptions(options.data.categories)]} onChange={value => filter('categoryId', value)} virtual={false}/>
        <Select aria-label="运行平台" value={params.get('platformId') || ''} options={[{ value: '', label: '全部平台' }, ...directoryOptions(options.data.platforms)]} onChange={value => filter('platformId', value)} virtual={false}/>
      </>}
      <Select aria-label="发布时间" value={params.get('days') || ''} options={[{ value: '', label: '全部时间' }, { value: '7', label: '近 7 天' }, { value: '30', label: '近 30 天' }, { value: '90', label: '近 90 天' }]} onChange={value => filter('days', value)} virtual={false}/>
      <form role="search" onSubmit={event => { event.preventDefault(); filter('q', String(new FormData(event.currentTarget).get('q') || '').trim()); }}><Input key={params.get('q') || ''} name="q" aria-label="搜索作品" placeholder="搜索作品名称或简介" defaultValue={params.get('q') || ''} maxLength={100}/><Button htmlType="submit">搜索</Button></form>
    </section>
    <div className="projects-list-heading">
      <h2>全部作品</h2>
      <div role="group" aria-label="作品排序">
        {[['likes', '点赞最多'], ['views', '浏览最多'], ['latest', '最新发布']].map(([value, label]) =>
          <button key={value} aria-pressed={sort === value} onClick={() => filter('sort', value)}>{label}</button>)}
      </div>
    </div>
    {!list.data ? <Pending error={list.error} retry={() => void list.refetch()}/> : list.data.items.length ? <div className="projects-grid">{list.data.items.map(item => <article className="project-card" key={item.id}>
      <Link className="project-cover-link" to={'/projects/' + item.id}><ProjectCover key={item.coverUrl} project={item}/></Link>
      <h3><Link to={'/projects/' + item.id}>{item.title}</Link></h3><p className="project-card-summary">{item.summary}</p>
      <div className="project-card-author"><span>{item.author.displayName}</span><span>{item.viewCount} 浏览 · {item.likeCount} 赞</span></div>
      <div className="project-card-tags">{item.categories.map(category => <span key={category.id}>{category.name}</span>)}{item.platforms.map(platform => <span key={platform.id}>{platform.name}</span>)}</div>
    </article>)}</div> : <div className="surface projects-empty"><h2>没有匹配的作品</h2><p>调整筛选条件，或发布你的第一件作品。</p>{params.size > 0 && <Button onClick={() => setParams({})}>清除筛选</Button>}</div>}
    {list.data && <nav className="projects-pagination" aria-label="作品分页"><Button disabled={page === 1} onClick={() => { const next = new URLSearchParams(params); next.set('page', String(page - 1)); setParams(next); }}>上一页</Button><span>第 {page} 页</span><Button disabled={!list.data.hasMore} onClick={() => { const next = new URLSearchParams(params); next.set('page', String(page + 1)); setParams(next); }}>下一页</Button></nav>}
  </main>;
}

function PopularProjects({ items }: { items: Project[] }) {
  const list = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  useEffect(() => {
    const track = list.current;
    if (!track) return;
    const measure = () => setEdges({
      start: track.scrollLeft < 2,
      end: track.scrollLeft + track.clientWidth >= track.scrollWidth - 2,
    });
    const resize = new ResizeObserver(measure);
    resize.observe(track);
    track.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => {
      resize.disconnect();
      track.removeEventListener('scroll', measure);
    };
  }, [items.length]);

  function move(direction: number) {
    const track = list.current;
    if (!track) return;
    const width = track.firstElementChild?.getBoundingClientRect().width ?? 245;
    track.scrollBy({
      left: (width + 12) * direction,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }

  return <section className="projects-popular" aria-labelledby="popular-projects-title">
    <div className="projects-popular-heading">
      <h2 id="popular-projects-title">社区热门</h2>
      <div className="projects-popular-controls">
        <button type="button" aria-label="向左滚动热门作品" aria-controls="popular-projects" disabled={edges.start} onClick={() => move(-1)}>‹</button>
        <button type="button" aria-label="向右滚动热门作品" aria-controls="popular-projects" disabled={edges.end} onClick={() => move(1)}>›</button>
      </div>
    </div>
    <div className="projects-popular-list" id="popular-projects" ref={list}>
      {items.map(item => <Link key={item.id} to={'/projects/' + item.id}>
        <strong>{item.title}</strong>
        <span>{item.author.displayName}</span>
        <small>{item.likeCount} 赞 · {item.viewCount} 浏览</small>
      </Link>)}
    </div>
  </section>;
}

export function ProjectDetail() {
  const { id } = useParams();
  const { user } = useSession();
  const location = useLocation();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['project', id, user?.id], queryFn: ({ signal }) => api<Project>('/api/projects/' + id, 'GET', undefined, signal) });
  const viewed = useRef<string | undefined>(undefined);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!query.data || viewed.current === id) return;
    viewed.current = id;
    void api<{ viewCount: number }>('/api/projects/' + id + '/views', 'POST').then(result => {
      client.setQueryData<Project>(['project', id, user?.id], current => current ? { ...current, viewCount: result.viewCount } : current);
    }).catch(() => { viewed.current = undefined; });
  }, [query.data, id, client, user?.id]);
  async function like() {
    if (!query.data) return;
    setBusy(true); setFailure('');
    try {
      const result = await api<{ liked: boolean; likeCount: number }>('/api/projects/' + id + '/like', query.data.liked ? 'DELETE' : 'PUT');
      client.setQueryData<Project>(['project', id, user?.id], current => current ? { ...current, ...result } : current);
      await client.invalidateQueries({ queryKey: ['projects'] });
      await client.invalidateQueries({ queryKey: ['projects-popular'] });
    } catch (error) { setFailure(failureMessage(error)); } finally { setBusy(false); }
  }
  if (!query.data) return <main className="projects-page surface"><Pending error={query.error} retry={() => void query.refetch()}/></main>;
  const item = query.data;
  return <main className="projects-page project-detail">
    <Link to="/projects">← 返回作品广场</Link>
    <article className="surface project-detail-body">
      <header>
        <span className="project-detail-author">
          {item.author.displayName}
          {item.publishedAt && ' · ' + new Date(item.publishedAt).toLocaleDateString('zh-CN')}
        </span>
        <h1>{item.title}</h1>
        <p>{item.summary}</p>
        <div className="project-detail-actions">
          <a className="primary" href={item.projectUrl} target="_blank" rel="noopener noreferrer">体验作品 ↗</a>
          {item.repositoryUrl && <a className="subtle" href={item.repositoryUrl} target="_blank" rel="noopener noreferrer">查看源码 ↗</a>}
          {user
            ? <Button disabled={busy} onClick={() => void like()} aria-pressed={!!item.liked}>
              {item.liked ? '取消点赞' : '点赞'} · {item.likeCount}
            </Button>
            : <Link to={'/login?next=' + encodeURIComponent(location.pathname)} state={{ background: location }}>
              登录后点赞 · {item.likeCount}
            </Link>}
          <span className="meta">{item.viewCount} 浏览</span>
        </div>
      </header>
      {failure && <p className="error" role="alert">{failure}</p>}
      {item.coverUrl && <ProjectCover key={item.coverUrl} project={item}/>}
      <Markdown source={item.bodyMarkdown}/>
    </article>
  </main>;
}

export function MyProjects() {
  const { user, loading, error, retry } = useSession();
  const location = useLocation();
  const [selected, setSelected] = useState<Project | 'new' | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    setSelected(null);
    setNotice('');
  }, [user?.id]);
  const options = useProjectOptions();
  const list = useQuery({ queryKey: ['my-projects', user?.id], enabled: !!user, queryFn: ({ signal }) => api<{ items: Project[] }>('/api/me/projects', 'GET', undefined, signal) });
  const client = useQueryClient();
  if (loading || error) return <main className="projects-page surface"><Pending error={error} retry={retry}/></main>;
  if (!user) return <main className="projects-page surface projects-empty"><h1>我的作品</h1><Link to={'/login?next=' + encodeURIComponent(location.pathname)} state={{ background: location }}>登录后发布作品</Link></main>;
  return <main className="projects-page">
    <div className="work-title">
      <h1>我的作品</h1>
      <Button type="primary" onClick={() => { setSelected('new'); setNotice(''); }}>发布作品</Button>
    </div>
    <p className="meta project-work-intro">保存草稿后可提交审核，通过后展示在作品广场。</p>
    {!options.data ? <Pending error={options.error} retry={() => void options.refetch()}/> : selected && <ProjectForm key={selected === 'new' ? 'new' : selected.id + ':' + selected.version} item={selected === 'new' ? undefined : selected} options={options.data} close={() => setSelected(null)} reload={async () => {
      const refreshed = await list.refetch();
      if (refreshed.error) throw refreshed.error;
      const current = refreshed.data?.items.find(item => item.id === (selected === 'new' ? undefined : selected.id));
      if (!current) throw new Error('作品已不可用，请关闭编辑并刷新列表');
      return current;
    }} done={async (row, message) => {
      setSelected(row);
      setNotice(message);
      await client.invalidateQueries({ queryKey: ['my-projects'] });
    }}/>}
    {notice && <p role="status">{notice}</p>}
    {!list.data ? <Pending error={list.error} retry={() => void list.refetch()}/> : list.data.items.length ?
      <ul className="surface project-work-list">
        {list.data.items.map(item => <li key={item.id}>
          <div>
            <strong>{item.title}</strong>
            <p className="meta">{statusLabels[item.status]} · {item.likeCount} 赞 · {item.viewCount} 浏览</p>
          </div>
          <div className="project-work-actions">
            {item.status === 'PUBLISHED' && <Link to={'/projects/' + item.id}>查看作品</Link>}
            {['DRAFT', 'REJECTED'].includes(item.status) && <Button onClick={() => { setSelected(item); setNotice(''); }}>编辑作品</Button>}
          </div>
        </li>)}
      </ul> : <p className="surface projects-empty">还没有作品，点击发布作品开始创建。</p>}
  </main>;
}

function ProjectForm({ item, options, close, done, reload }: {
  item?: Project;
  options: Options;
  close: () => void;
  done: (row: Project, message: string) => Promise<void>;
  reload: () => Promise<Project>;
}) {
  const [categories, setCategories] = useState(item?.categories.map(value => value.id) ?? []);
  const [platforms, setPlatforms] = useState(item?.platforms.map(value => value.id) ?? []);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const editable = !item || item.status === 'DRAFT' || item.status === 'REJECTED';
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFailure(''); setConflict(false); setBusy(true);
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? '').trim();
    try {
      const payload = {
        title: value('title'),
        summary: value('summary'),
        bodyMarkdown: value('bodyMarkdown'),
        coverUrl: value('coverUrl') || null,
        projectUrl: value('projectUrl'),
        repositoryUrl: value('repositoryUrl') || null,
        categoryIds: categories,
        platformIds: platforms,
        ...(item ? { version: item.version } : {}),
      };
      const row = await api<Project>('/api/me/projects' + (item ? '/' + item.id : ''), item ? 'PATCH' : 'POST', payload);
      await done(row, '草稿已保存');
    } catch (error) {
      setFailure(failureMessage(error));
      setConflict(error instanceof HttpError && error.status === 409);
    } finally { setBusy(false); }
  }
  async function submit() {
    if (!item || dirty) return;
    setFailure(''); setConflict(false); setBusy(true);
    try {
      const row = await api<Project>('/api/me/projects/' + item.id + '/submit', 'POST', { version: item.version });
      await done(row, '已提交，等待审核');
    }
    catch (error) {
      setFailure(failureMessage(error));
      setConflict(error instanceof HttpError && error.status === 409);
    } finally { setBusy(false); }
  }
  async function loadLatest() {
    setBusy(true);
    setFailure('');
    try { await done(await reload(), '已加载最新版本'); }
    catch (error) { setFailure(failureMessage(error)); }
    finally { setBusy(false); }
  }
  return <section className="surface project-form">
    <div className="work-title">
      <h2>{item ? '编辑作品' : '创建作品'}</h2>
      <Button disabled={busy} onClick={close}>关闭编辑</Button>
    </div>
    <form onSubmit={save} onChange={() => setDirty(true)}>
      <label htmlFor="project-title">作品名称</label>
      <Input id="project-title" name="title" required maxLength={120}
        defaultValue={item?.title} disabled={!editable || busy}/>
      <label htmlFor="project-summary">作品简介</label>
      <Input.TextArea id="project-summary" name="summary" required rows={2} maxLength={400}
        defaultValue={item?.summary} disabled={!editable || busy}/>
      <div className="project-form-pair">
        <div>
          <label htmlFor="project-url">作品链接</label>
          <Input id="project-url" name="projectUrl" type="url" required maxLength={2000}
            placeholder="https://" defaultValue={item?.projectUrl} disabled={!editable || busy}/>
        </div>
        <div>
          <label htmlFor="project-repository">源码链接</label>
          <Input id="project-repository" name="repositoryUrl" type="url" maxLength={2000}
            placeholder="https://" defaultValue={item?.repositoryUrl ?? ''} disabled={!editable || busy}/>
        </div>
      </div>
      <label htmlFor="project-cover">封面图片地址</label>
      <Input id="project-cover" name="coverUrl" type="url" maxLength={2000}
        placeholder="https://" defaultValue={item?.coverUrl ?? ''} disabled={!editable || busy}/>
      <div className="project-form-pair">
        <div>
          <label htmlFor="project-categories">作品分类</label>
          <Select id="project-categories" mode="multiple" value={categories}
            options={directoryOptions(options.categories)}
            onChange={value => { setCategories(value); setDirty(true); }}
            disabled={!editable || busy} virtual={false}/>
        </div>
        <div>
          <label htmlFor="project-platforms">运行平台</label>
          <Select id="project-platforms" mode="multiple" value={platforms}
            options={directoryOptions(options.platforms)}
            onChange={value => { setPlatforms(value); setDirty(true); }}
            disabled={!editable || busy} virtual={false}/>
        </div>
      </div>
      <label htmlFor="project-body">作品介绍（Markdown）</label>
      <Input.TextArea id="project-body" name="bodyMarkdown" required rows={9} maxLength={30000}
        defaultValue={item?.bodyMarkdown} disabled={!editable || busy}/>
      {failure && <p className="error" role="alert">{failure}</p>}
      {dirty && item && editable && <p className="meta">修改后请先保存草稿，再提交审核。</p>}
      {conflict && <Button disabled={busy} onClick={() => void loadLatest()}>放弃修改并加载最新版本</Button>}
      <div className="project-form-actions">
        {editable && <Button type="primary" htmlType="submit" loading={busy}>保存草稿</Button>}
        {item && editable && <Button disabled={busy || dirty} onClick={() => void submit()}>提交审核</Button>}
        {item && !editable && <span role="status">{statusLabels[item.status]}</span>}
      </div>
    </form>
  </section>;
}
