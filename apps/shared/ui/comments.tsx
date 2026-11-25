import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { api, HttpError } from '../api/api';
import { ArticleIcon } from './article-icons';
import { useSession } from '../auth/session';
import './comments.css';

type Comment = {
  id: string;
  body: string;
  createdAt: string;
  author: { displayName: string };
  parentId?: string | null;
  replies?: Comment[];
  liked?: boolean;
  likeCount?: number;
};
type Likes = Pick<Required<Comment>, 'liked' | 'likeCount'>;
const commentTime = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });

export function CommentMessage({ author, body, createdAt, details }: {
  author: string;
  body: string;
  createdAt?: string;
  details?: ReactNode;
}) {
  return <div className="comment-message">
    <span className="comment-avatar" aria-hidden="true">{Array.from(author)[0]}</span>
    <div className="comment-message-content">
      <div className="comment-meta">
        <strong>{author}</strong>
        {createdAt && <time className="meta" dateTime={createdAt}>{commentTime.format(new Date(createdAt))}</time>}
        {details}
      </div>
      <p className="comment-text">{body}</p>
    </div>
  </div>;
}

export function CommentSection({ path, id, label = '评论', threaded = false, count, variant = 'default', allHref, refresh = [] }: {
  path: string;
  id?: string;
  label?: string;
  threaded?: boolean;
  count?: number;
  variant?: 'default'|'article'|'pulse-preview'|'pulse-detail';
  allHref?: string;
  refresh?: QueryKey[];
}) {
  const { user } = useSession();
  const location = useLocation();
  const login = '/login?next=' + encodeURIComponent(location.pathname + location.search + (id ? '#' + id : location.hash));
  const loginState = { background: location };
  const loginLink = <Link to={login} state={loginState}>登录后发表评论</Link>;
  const [sort,setSort]=useState<'hot'|'latest'>('hot');
  const [page,setPage]=useState(1);
  const [expanded,setExpanded]=useState<Set<string>>(()=>new Set());
  const paged=variant==='pulse-detail'||variant==='pulse-preview';
  const key = ['comments', path, user?.id, ...(paged?[page,sort]:[])];
  const client = useQueryClient();
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => api<Comment[]>(paged?path+'?page='+page+'&sort='+sort:path, 'GET', undefined, signal) });
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const sorted = query.data && (variant==='article'?[...query.data].sort((a,b)=>
    (sort==='hot'?((b.likeCount??0)-(a.likeCount??0))||((b.replies?.length??0)-(a.replies?.length??0)):0)||Date.parse(b.createdAt)-Date.parse(a.createdAt)
  ):query.data);
  const rows = variant==='pulse-preview'?sorted?.slice(0,3):paged?sorted?.slice(0,20):sorted;
  const more=!!sorted&&sorted.length>20;
  const total=count??query.data?.length;
  function toggleReplies(id:string) {
    setExpanded(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;});
  }

  function replyButton(rootId:string) {
    const icon=<><ArticleIcon name="comment"/><span>回复</span></>;
    return user?<button type="button" className="subtle article-action-icon" aria-label="回复" title="回复"
      aria-expanded={replyTo===rootId} onClick={()=>setReplyTo(replyTo===rootId?null:rootId)}>{icon}</button>
      :<Link className="subtle article-action-icon" to={login} state={loginState} aria-label="登录后回复">{icon}</Link>;
  }

  async function save(body: string, parentId?: string) {
    const comment = await api<Comment>(path, 'POST', { body, ...(parentId ? { parentId } : {}) });
    await client.cancelQueries({ queryKey: key });
    if(paged)setPage(1);
    else client.setQueryData<Comment[]>(key, current => {
      const rows = current ?? [];
      if (!comment.parentId) return [...rows.filter(row => row.id !== comment.id), comment].slice(-100);
      return rows.map(row => row.id === comment.parentId ? {
        ...row, replies: [...(row.replies ?? []).filter(reply => reply.id !== comment.id), comment].slice(-20),
      } : row);
    });
    await Promise.all([['comments',path], ...refresh].map(queryKey => client.invalidateQueries({ queryKey })));
    if (parentId) setReplyTo(current => current === parentId ? null : current);
  }

  async function toggleLike(comment: Comment) {
    const result = await api<Likes>(path + '/' + comment.id + '/like', 'PUT', { active: !comment.liked });
    await client.cancelQueries({ queryKey: key });
    client.setQueryData<Comment[]>(key, current => current?.map(row => row.id === comment.id
      ? { ...row, ...result }
      : { ...row, replies: row.replies?.map(reply => reply.id === comment.id ? { ...reply, ...result } : reply) }));
    await client.invalidateQueries({ queryKey: ['comments',path] });
  }

  return <section id={id} className={'comments comments-'+variant} aria-label={label}>
    <div className="comment-heading"><h2>评论</h2>
      {(count !== undefined || query.data) && <span className="comment-count">{count ?? query.data?.length}</span>}
    </div>
    <div className="comment-composer"><span className="comment-avatar" aria-hidden="true">{user?Array.from(user.displayName)[0]:'◇'}</span>
      {user ? <CommentForm key={user.id} save={save} loginLink={loginLink}/> : <div className="comment-guest">{loginLink}</div>}
    </div>
    {(variant==='article'||paged)&&<div className="comment-sort" aria-label="评论排序">
      <button type="button" className="subtle" aria-pressed={sort==='hot'} onClick={()=>{setSort('hot');setPage(1);}}>最热</button>
      <button type="button" className="subtle" aria-pressed={sort==='latest'} onClick={()=>{setSort('latest');setPage(1);}}>最新</button>
    </div>}
    {query.isPending && !query.error && <p role="status" className="comment-notice">加载评论…</p>}
    {query.error && <p className="error comment-notice" role="alert">{query.error.message}
      <button className="subtle" onClick={() => void query.refetch()}>重试</button></p>}
    {rows && (rows.length ? <>
      {!paged && query.data?.length === 100 && <p className="meta">显示最近 100 条{threaded ? '一级' : ''}评论</p>}
      <ul className="comment-list">{rows.map(comment => <li key={comment.id}>
        <CommentMessage author={comment.author.displayName} body={comment.body} createdAt={comment.createdAt}/>
        {threaded && <div className="comment-controls">
          <CommentLike comment={comment} toggle={toggleLike} login={login}/>
          {replyButton(comment.id)}
        </div>}
        {!!comment.replies?.length && <ul className="comment-replies" aria-label="二级回复">
          {comment.replies.length === 20 && <li className="meta">显示最近 20 条回复</li>}
          {(expanded.has(comment.id)?comment.replies:comment.replies.slice(0,2)).map(reply => <li key={reply.id}>
            <CommentMessage author={reply.author.displayName} body={reply.body} createdAt={reply.createdAt}/>
            <div className="comment-controls comment-reply-actions"><CommentLike comment={reply} toggle={toggleLike} login={login}/>{replyButton(comment.id)}</div>
          </li>)}
          {comment.replies.length>2&&<li><button className="subtle" type="button" aria-expanded={expanded.has(comment.id)} onClick={()=>toggleReplies(comment.id)}>{expanded.has(comment.id)?'收起回复':'展开 '+comment.replies.length+' 条回复'}</button></li>}
        </ul>}
        {replyTo === comment.id && user && <CommentForm key={user.id + comment.id} parentId={comment.id}
          save={save} loginLink={loginLink} cancel={() => setReplyTo(null)}/>}
      </li>)}</ul>
    </> : <p className="comment-notice">暂无评论</p>)}
    {allHref&&<Link className="comment-see-all" to={allHref}>{total?'查看全部 '+total+' 条评论':'查看沸点详情'}</Link>}
    {variant==='pulse-detail'&&(page>1||more)&&<nav className="comment-pagination" aria-label="评论分页">
      <button type="button" className="subtle" disabled={page===1} onClick={()=>setPage(page-1)}>上一页</button><span className="meta">第 {page} 页</span>
      <button type="button" className="subtle" disabled={!more} onClick={()=>setPage(page+1)}>下一页</button>
    </nav>}
  </section>;
}

function CommentLike({ comment, toggle, login }: {
  comment: Comment;
  toggle: (comment: Comment) => Promise<void>;
  login: string;
}) {
  const { user } = useSession();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const label = comment.liked ? '取消评论点赞' : '点赞评论';
  const icon = <><ArticleIcon name="like"/><span>{comment.likeCount}</span></>;

  async function submit() {
    setBusy(true);
    setFailure('');
    try { await toggle(comment); }
    catch (error) { setFailure(error instanceof Error ? error.message : '点赞失败，请重试'); }
    finally { setBusy(false); }
  }

  return <div className="comment-like">
    {user ? <button className="subtle article-action-icon" type="button" aria-label={label} title={label}
      aria-pressed={!!comment.liked} disabled={busy} onClick={() => void submit()}>{icon}</button>
      : <Link className="subtle article-action-icon" to={login} state={{ background: location }}
        aria-label="登录后点赞评论">{icon}</Link>}
    {failure && <p className="error" role="alert">{failure}</p>}
  </div>;
}

function CommentForm({ save, loginLink, parentId, cancel }: {
  save: (content: string, parentId?: string) => Promise<void>;
  loginLink: ReactNode;
  parentId?: string;
  cancel?: () => void;
}) {
  const inputId = useId();
  const label = parentId ? '回复评论' : '发表评论';
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const content = body.trim();
    if (!content || busy) return;
    setBusy(true);
    setFailure('');
    setStatus('');
    setNeedsLogin(false);
    try {
      await save(content, parentId);
      setBody('');
      setStatus(parentId ? '回复已发布' : '评论已发布');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : '评论提交失败，请重试');
      setNeedsLogin(error instanceof HttpError && error.status === 401);
    } finally {
      setBusy(false);
    }
  }

  return <form className="comment-form" onSubmit={submit}>
    <label htmlFor={inputId}>{label}</label>
    <textarea id={inputId} rows={3} maxLength={2000} readOnly={busy} autoFocus={!!parentId}
      placeholder={parentId ? '写下你的回复' : '写下你的评论'} aria-describedby={inputId + '-length'}
      value={body} onChange={event => setBody(event.target.value)}/>
    <div className="comment-form-actions">
      <span className="meta" id={inputId + '-length'}>{body.length} / 2000</span>
      <div className="comment-controls">
        {cancel && <button className="subtle" type="button" disabled={busy} onClick={cancel}>取消</button>}
        <button className="primary" type="submit" disabled={busy || !body.trim()}>
          {busy ? '发送中…' : parentId ? '发送回复' : label}
        </button>
      </div>
    </div>
    {failure && <p className="error" role="alert">{failure}</p>}
    {needsLogin && loginLink}
    {status && <p className="meta" role="status">{status}</p>}
  </form>;
}
