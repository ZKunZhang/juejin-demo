import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { api, HttpError } from './api';
import { useSession } from './session';
import type { Article } from './articles';

type Status={liked:boolean;bookmarked:boolean;following:boolean};
type Person={id:string;displayName:string;username:string};
type Comment={id:string;body:string;createdAt:string;author:Person;parentId:string|null};
type CommentThread=Comment & {replies:Comment[]};

export function ArticleInteractions({article,children}:{article:Article;children:(value:{actions:React.ReactNode;follow:React.ReactNode;comments:React.ReactNode})=>React.ReactNode}) {
  const {user}=useSession();
  const location=useLocation();
  const login='/login?next='+encodeURIComponent(location.pathname+location.search);
  const client=useQueryClient();
  const key=['interaction',article.id,user?.id];
  const state=useQuery({queryKey:key,enabled:!!user,queryFn:({signal})=>api<Status>('/api/articles/'+article.id+'/interaction','GET',undefined,signal)});
  const [busy,setBusy]=useState(false);
  const [failure,setFailure]=useState('');
  async function change(kind:keyof Status,path:string) {
    if (!state.data) return;
    setBusy(true);setFailure('');
    try {
      const result=await api<{active:boolean}>(path,'PUT',{active:!state.data[kind]});
      client.setQueryData<Status>(key,{...state.data,[kind]:result.active});
      await Promise.all(['articles','article','bookmarks','following'].map(name=>client.invalidateQueries({queryKey:[name]})));
    }catch(error){setFailure(error instanceof Error?error.message:'操作失败');}
    finally{setBusy(false);}
  }
  function action(kind:keyof Status,path:string,on:string,off:string) {
    return user ? <button className="subtle" aria-pressed={state.data?.[kind]||false} disabled={busy||!state.data} onClick={()=>void change(kind,path)}>{state.data?.[kind]?off:on}</button>
      : <Link className="subtle" to={login}>{on}</Link>;
  }
  return <>{children({
    actions:<>{action('liked','/api/articles/'+article.id+'/like','点赞','取消点赞')}{action('bookmarked','/api/articles/'+article.id+'/bookmark','收藏','取消收藏')}<a className="subtle" href="#article-comments">评论</a>{state.error&&<button className="subtle" onClick={()=>void state.refetch()}>重试互动状态</button>}{failure&&<span className="error" role="alert">{failure}</span>}</>,
    follow:user?.id!==article.author.id?action('following','/api/users/'+article.author.id+'/follow','关注作者','取消关注'):null,
    comments:<CommentList key={user?.id} articleId={article.id} />,
  })}</>;
}
const commentTime = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });

function CommentList({ articleId }: { articleId: string }) {
  const { user } = useSession();
  const location = useLocation();
  const login = '/login?next=' + encodeURIComponent(location.pathname + location.search + '#article-comments');
  const path = '/api/articles/' + articleId + '/comments';
  const key = ['comments', articleId];
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => api<CommentThread[]>(path, 'GET', undefined, signal) });
  const client = useQueryClient();
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const loginLink = <Link to={login} state={{ background: location }}>登录后发表评论</Link>;

  async function save(content: string, parentId?: string) {
    const comment = await api<Comment>(path, 'POST', { body: content, ...(parentId ? { parentId } : {}) });
    await client.cancelQueries({ queryKey: key });
    client.setQueryData<CommentThread[]>(key, current => {
      const threads = current ?? [];
      if (!comment.parentId) return [...threads, { ...comment, replies: [] }].slice(-100);
      return threads.map(thread => thread.id === comment.parentId
        ? { ...thread, replies: [...thread.replies, comment].slice(-20) }
        : thread);
    });
    await Promise.all([
      client.invalidateQueries({ queryKey: key }),
      client.invalidateQueries({ queryKey: ['article', articleId] }),
      client.invalidateQueries({ queryKey: ['articles'] }),
    ]);
  }

  return <section id="article-comments" className="comments">
    <h2>评论</h2>
    {user ? <CommentForm save={save} loginLink={loginLink}/> : loginLink}
    <div role="status" className="meta">{query.isPending && !query.error ? '加载评论…' : ''}</div>
    {query.error && <p className="error" role="alert">{query.error.message} <button className="subtle" onClick={() => void query.refetch()}>重试</button></p>}
    {query.data && (query.data.length ? <>
      {query.data.length === 100 && <p className="meta">显示最近 100 条一级评论</p>}
      <ul className="comment-list">{query.data.map(thread => <li key={thread.id}>
        <CommentContent comment={thread}/>
        {user ? <button type="button" className="subtle" aria-expanded={replyTo === thread.id}
          onClick={() => setReplyTo(replyTo === thread.id ? null : thread.id)}>回复</button>
          : <Link className="comment-reply-link" to={login} state={{ background: location }}>登录后回复</Link>}
        {thread.replies.length === 20 && <p className="meta">显示最近 20 条回复</p>}
        {thread.replies.length > 0 && <ul className="comment-replies" aria-label="二级回复">
          {thread.replies.map(reply => <li key={reply.id}><CommentContent comment={reply}/></li>)}
        </ul>}
        {replyTo === thread.id && user && <CommentForm key={thread.id} parentId={thread.id}
          save={save} loginLink={loginLink} cancel={() => setReplyTo(null)}/>}
      </li>)}</ul>
    </> : <p className="meta">暂无评论</p>)}
  </section>;
}

function CommentContent({ comment }: { comment: Comment }) {
  return <>
    <div className="comment-meta"><strong>{comment.author.displayName}</strong>
      <time className="meta" dateTime={comment.createdAt}>{commentTime.format(new Date(comment.createdAt))}</time></div>
    <p>{comment.body}</p>
  </>;
}

function CommentForm({ save, loginLink, parentId, cancel }: {
  save: (content: string, parentId?: string) => Promise<void>;
  loginLink: React.ReactNode;
  parentId?: string;
  cancel?: () => void;
}) {
  const inputId = parentId ? 'reply-' + parentId : 'comment-body';
  const label = parentId ? '回复评论' : '发表评论';
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);

  async function send(event: FormEvent) {
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
      setFailure(error instanceof Error ? error.message : '评论提交失败');
      setNeedsLogin(error instanceof HttpError && error.status === 401);
    } finally {
      setBusy(false);
    }
  }

  return <form className="comment-form" onSubmit={send}>
    <label htmlFor={inputId}>{label}</label>
    <textarea id={inputId} rows={3} maxLength={2000} readOnly={busy} autoFocus={!!parentId}
      aria-describedby={inputId + '-length'} value={body} onChange={event => setBody(event.target.value)}/>
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
export function MyRelations({type}:{type:'bookmarks'|'following'}) {
  const {user,loading,error,retry}=useSession();
  const title=type==='bookmarks'?'我的收藏':'我的关注';
  const path='/api/me/'+type;
  const query=useQuery({queryKey:[type,user?.id],enabled:!!user,queryFn:({signal})=>api<(Article|Person)[]>(path,'GET',undefined,signal)});
  return <main className="surface work"><h1>{title}</h1>
    {loading?<p role="status">加载中…</p>:error?<button className="subtle" onClick={retry}>重试会话</button>:!user?<Link to={'/login?next='+encodeURIComponent('/me/'+type)}>登录后查看</Link>:!query.data?query.error?<button className="subtle" onClick={()=>void query.refetch()}>重试加载</button>:<p role="status">加载中…</p>:query.data.length?<ul className="work-list">{query.data.map(item=><li key={item.id}>{'title'in item?<Link to={'/articles/'+item.id}>{item.title}</Link>:<span>{item.displayName} <small className="meta">@{item.username}</small></span>}</li>)}</ul>:<p className="meta">暂无记录</p>}
  </main>;
}
