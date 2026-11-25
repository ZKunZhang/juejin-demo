import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api, type User } from './api';
import { Pending, type Article } from './articles';
import { useSession } from './session';
import { ArticleIcon } from './article-icons';
import { CollectionList, type Collection } from './bookmark-collections';
import './profile.css';

type View = 'activity' | 'published' | 'courses' | 'pulses' | 'liked' | 'likedPulses' | 'bookmarks' | 'following' | 'followers';
type Course = {
  id: string; title: string; summary: string; level: 'BEGINNER' | 'ADVANCED';
  category: { name: string }; _count: { lessons: number };
};
type Person = { id: string; displayName: string; username: string; avatarUrl: string | null };
type Pulse = { id: string; body: string; images: string[]; createdAt: string; author: Person; _count: { likes: number; comments: number } };
type Item = Course | Person | Pulse | Pick<Article, 'id' | 'title' | 'summary' | 'author' | 'viewCount' | '_count' | 'publishedAt' | 'tags'>;
type ProfileData = {
  avatarUrl: string | null;
  joinedAt: string;
  stats: { likes: number; reads: number; following: number; followers: number };
  items: Item[];
  hasMore: boolean;
};
const views: { id: View; label: string; alternate?: View }[] = [
  { id: 'activity', label: '动态' },
  { id: 'published', label: '文章' },
  { id: 'courses', label: '课程' },
  { id: 'pulses', label: '沸点' },
  { id: 'bookmarks', label: '收藏' },
  { id: 'following', label: '关注', alternate: 'followers' },
  { id: 'liked', label: '赞', alternate: 'likedPulses' },
];
const emptyMessages: Record<View, string> = {
  activity: '暂无公开动态', published: '暂无已发布文章', courses: '暂无已发布课程',
  pulses: '暂无已发布沸点', liked: '暂无赞过的文章', likedPulses: '暂无赞过的沸点',
  bookmarks: '暂无收藏文章', following: '暂无关注的用户', followers: '暂无关注者',
};
const format = new Intl.NumberFormat('zh-CN');
const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' });

function profileUrl(view: View, page = 1) {
  const params = new URLSearchParams();
  if (view !== 'activity') params.set('view', view);
  if (page > 1) params.set('page', String(page));
  return params.size ? '/me?' + params : '/me';
}

function fetchProfile(view: Exclude<View, 'activity'>, page: number, signal: AbortSignal) {
  return api<ProfileData>('/api/me/profile?view=' + view + '&page=' + page, 'GET', undefined, signal);
}

type Activity = { kind: 'article' | 'pulse' | 'bookmark' | 'follow'; at: string; item: Item };
const activityLabels: Record<Activity['kind'], string> = {
  article: '发布了文章', pulse: '发布了沸点', bookmark: '收藏了文章', follow: '关注了用户',
};

function ProfileAvatar({ url, name }: { url?: string | null; name: string }) {
  const [failed, setFailed] = useState<string>();
  if (url && url !== failed && /^(https?:\/\/|\/(?![\/\\]))/i.test(url)) {
    return <img className="avatar" src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(url)}/>;
  }
  return <span className="avatar" aria-hidden="true">{Array.from(name)[0]}</span>;
}

export function Profile() {
  const { user, loading, error, retry } = useSession();
  const location = useLocation();
  if (user) return <ProfileContent key={user.id} user={user}/>;
  return <main className="surface work">
    <h1>个人详情</h1>
    {loading ? <p role="status">加载中…</p> : error ? <button className="subtle" onClick={retry}>重试会话</button> :
      <Link to={'/login?next=' + encodeURIComponent(location.pathname + location.search)} state={{ background: location }}>登录后查看</Link>}
  </main>;
}

function ProfileContent({ user }: { user: User }) {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const requestedView = params.get('view');
  const tab = views.find(item => item.id === requestedView || item.alternate === requestedView);
  const collection = pathname === '/me/bookmarks';
  const selectedCollection = collection ? params.get('collection') : null;
  const view = collection ? 'bookmarks' : pathname === '/me/following' ? 'following'
    : tab?.alternate && tab.alternate === requestedView ? tab.alternate : tab?.id ?? 'activity';
  const requestedPage = Number(params.get('page'));
  const page = view !== 'activity' && Number.isInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 1000000 ? requestedPage : 1;
  const query = useQuery({
    queryKey: ['profile', user.id, view, page],
    queryFn: async ({ signal }) => {
      if (view !== 'activity') return fetchProfile(view, page, signal);
      return fetchProfile('published', 1, signal);
    },
    placeholderData: previous => previous,
    staleTime: 0,
  });
  const activity = useQuery({
    queryKey: ['profile', 'activity', user.id],
    enabled: view === 'activity',
    queryFn: ({ signal }) => api<Activity[]>('/api/me/activity', 'GET', undefined, signal),
    staleTime: 0,
  });
  const stats = query.data?.stats;
  const isPeople = view === 'following' || view === 'followers';
  const isLikes = view === 'liked' || view === 'likedPulses';
  const items = !query.data || query.isPlaceholderData ? <Pending error={query.error} retry={() => void query.refetch()}/>
    : query.data.items.length ? query.data.items.map(item => <ProfileItem key={('body' in item ? 'pulse-' : 'item-') + item.id} item={item} view={view}/>)
    : <p className="empty meta">{emptyMessages[view]}</p>;
  const pageLink = (next: number) => profileUrl(view, next);
  const paging = !query.isPlaceholderData && (page > 1 || query.data?.hasMore) &&
    <nav className="profile-pages" aria-label="内容分页">
      {page > 1 && <Link className="subtle" to={pageLink(page - 1)}>上一页</Link>}
      {query.data?.hasMore && page < 1000000 && <Link className="subtle" to={pageLink(page + 1)}>下一页</Link>}
    </nav>;

  if (collection) return <main className="profile-collection-page">
    <header className="profile-collection-banner"><div>
      {selectedCollection ? <Link to="/me/bookmarks">返回收藏合集</Link> : <Link to={profileUrl('bookmarks')}>返回个人主页</Link>}
      <h1>我的收藏</h1>
      <div className="profile-collection-owner"><ProfileAvatar url={query.data?.avatarUrl} name={user.displayName}/>{user.displayName}</div>
    </div></header>
    <section className="surface profile-collection-content" aria-label="收藏内容">
      {selectedCollection ? <CollectionArticles userId={user.id} collectionId={selectedCollection} page={Math.min(page,999999)}/>
        : <CollectionList userId={user.id}/>}
    </section>
  </main>;

  return <main className="profile-grid">
    <div className="profile-main">
      <section className="surface profile-identity">
        <ProfileAvatar url={query.data?.avatarUrl} name={user.displayName}/>
        <div><h1>{user.displayName}</h1><p className="meta">@{user.username}</p></div>
        <Link className="subtle profile-creator" to="/creator">创作者中心</Link>
      </section>
      <section className="surface profile-feed">
        <nav className="profile-links" aria-label="个人内容">
          {views.map(item => <Link key={item.id} to={profileUrl(item.id)}
            aria-current={item.id === view || item.alternate === view ? 'page' : undefined}>{item.label}</Link>)}
        </nav>
        {(isPeople || isLikes || view === 'bookmarks') && <div className="profile-subtabs">
          {isPeople && <><Link to={profileUrl('following')} aria-current={view === 'following' ? 'page' : undefined}>关注的用户</Link>
            <Link to={profileUrl('followers')} aria-current={view === 'followers' ? 'page' : undefined}>关注者</Link></>}
          {isLikes && <><Link to={profileUrl('liked')} aria-current={view === 'liked' ? 'page' : undefined}>文章</Link>
            <Link to={profileUrl('likedPulses')} aria-current={view === 'likedPulses' ? 'page' : undefined}>沸点</Link></>}
          {view === 'bookmarks' && <Link to="/me/bookmarks">查看我的收藏</Link>}
        </div>}
        {view === 'bookmarks' ? <CollectionList userId={user.id}/> : view === 'activity' ? (
          !activity.data ? <Pending error={activity.error} retry={() => void activity.refetch()}/> :
          activity.data.length ? activity.data.map(entry => <div key={entry.kind + ':' + entry.item.id} className="profile-activity-entry">
            <div className="profile-activity-label meta"><span>{activityLabels[entry.kind]}</span>
              <time dateTime={entry.at}>{date.format(new Date(entry.at))}</time></div>
            <ProfileItem item={entry.item} view={entry.kind === 'bookmark' ? 'bookmarks' : 'activity'}/>
          </div>) : <p className="empty meta">{emptyMessages.activity}</p>
        ) : <>{items}{paging}</>}
      </section>
    </div>
    <aside className="profile-aside" aria-label="个人数据">
      <section className="surface profile-stats"><h2>个人成就</h2>
        {stats ? <dl>
          <div><dt><ArticleIcon name="like"/>文章获赞</dt><dd>{format.format(stats.likes)}</dd></div>
          <div><dt><ArticleIcon name="view"/>文章阅读</dt><dd>{format.format(stats.reads)}</dd></div>
        </dl> : <Pending error={query.error} retry={() => void query.refetch()}/>}
      </section>
      {stats && <div className="surface profile-relations">
        <Link to={profileUrl('following')}>关注了<strong>{format.format(stats.following)}</strong></Link>
        <Link to={profileUrl('followers')}>关注者<strong>{format.format(stats.followers)}</strong></Link>
      </div>}
      {query.data?.joinedAt && <div className="profile-joined"><span>加入于</span>
        <time dateTime={query.data.joinedAt}>{date.format(new Date(query.data.joinedAt))}</time>
      </div>}
    </aside>
  </main>;
}

function CollectionArticles({ userId, collectionId, page }: { userId: string; collectionId: string; page: number }) {
  const query = useQuery({
    queryKey: ['collection-articles', userId, collectionId, page],
    queryFn: ({ signal }) => api<{ collection: Collection; items: Item[]; hasMore: boolean }>(
      '/api/me/bookmark-collections/' + encodeURIComponent(collectionId) + '/articles?page=' + page,
      'GET', undefined, signal),
  });
  if (!query.data) return <Pending error={query.error} retry={() => void query.refetch()}/>;
  function pageLink(next: number) {
    return '/me/bookmarks?' + new URLSearchParams({collection:collectionId,page:String(next)});
  }
  return <>
    <div className="bookmark-collections"><h2>{query.data.collection.name}</h2></div>
    {query.data.items.length ? query.data.items.map(item => <ProfileItem key={item.id} item={item} view="bookmarks"/>)
      : <p className="empty meta">此合集暂无文章</p>}
    {(page > 1 || query.data.hasMore) && <nav className="profile-pages" aria-label="收藏分页">
      {page > 1 && <Link className="subtle" to={pageLink(page - 1)}>上一页</Link>}
      {query.data.hasMore && page < 999999 && <Link className="subtle" to={pageLink(page + 1)}>下一页</Link>}
    </nav>}
  </>;
}

function ProfileItem({ item, view }: { item: Item; view: View }) {
  if ('body' in item) return <article className="profile-entry profile-pulse">
    <div className="profile-entry-author"><ProfileAvatar name={item.author.displayName} url={item.author.avatarUrl}/>
      <span><strong>{item.author.displayName}</strong><time className="meta" dateTime={item.createdAt}>{date.format(new Date(item.createdAt))}</time></span>
    </div>
    <Link className="profile-pulse-body" to={'/pulses/' + item.id}>{item.body || '查看沸点图片'}</Link>
    {!!item.images.length && <div className="profile-pulse-images">{item.images.map((url, index) => <img key={index} src={url} alt={'沸点配图 ' + (index + 1)} loading="lazy" referrerPolicy="no-referrer"/>)}</div>}
    <div className="profile-entry-meta meta"><span><ArticleIcon name="like"/>{format.format(item._count.likes)} 赞</span>
      <Link to={'/pulses/' + item.id + '#pulse-comments'}><ArticleIcon name="comment"/>{format.format(item._count.comments)} 评论</Link></div>
  </article>;
  if ('displayName' in item) return <ProfilePerson person={item} following={view === 'following'}/>;
  if ('category' in item) return <article className="profile-entry">
    <Link className="item-title" to={'/courses/' + item.id}>{item.title}</Link>
    <p className="description">{item.summary}</p>
    <div className="profile-entry-meta meta"><span>{item.category.name}</span><span>{item.level === 'BEGINNER' ? '入门' : '进阶'}</span>
      <span>{format.format(item._count.lessons)} 节</span></div>
  </article>;
  return <article className="profile-entry">
    {view === 'activity' && <div className="profile-entry-author"><ProfileAvatar name={item.author.displayName}/><strong>{item.author.displayName}</strong></div>}
    <Link className="item-title" to={'/articles/' + item.id}>{item.title}</Link>
    {item.summary && <p className="description">{item.summary}</p>}
    <div className="profile-entry-meta meta">
      {(view === 'liked' || view === 'bookmarks') && <span>{item.author.displayName}</span>}
      {item.publishedAt && <time dateTime={item.publishedAt}>{date.format(new Date(item.publishedAt))}</time>}
      <span><ArticleIcon name="view"/>{format.format(item.viewCount)} 阅读</span>
      {item._count && <><span><ArticleIcon name="like"/>{format.format(item._count.likes)} 赞</span>
        <Link to={'/articles/' + item.id + '#article-comments'}><ArticleIcon name="comment"/>{format.format(item._count.comments)} 评论</Link></>}
    </div>
  </article>;
}

function ProfilePerson({ person, following }: { person: Person; following: boolean }) {
  const client = useQueryClient();
  const unfollow = useMutation({
    mutationFn: () => api('/api/users/' + person.id + '/follow', 'PUT', { active: false }),
    onSuccess: async () => {
      await Promise.all(['profile', 'following', 'interaction', 'pulses', 'pulse-detail', 'articles']
        .map(key => client.invalidateQueries({ queryKey: [key] })));
    },
  });
  return <article className="profile-entry profile-person">
    <div className="profile-entry-author"><ProfileAvatar name={person.displayName} url={person.avatarUrl}/>
      <span><strong>{person.displayName}</strong><span className="meta">@{person.username}</span></span>
    </div>
    {following && <button type="button" className="subtle profile-unfollow" disabled={unfollow.isPending}
      onClick={() => unfollow.mutate()}>取消关注</button>}
    {unfollow.error && <p className="error" role="alert">{unfollow.error.message}</p>}
  </article>;
}
