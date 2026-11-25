import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { api } from './api';
import { useSession } from './session';
import type { Article } from './articles';

type Status={liked:boolean;bookmarked:boolean;following:boolean};
type Person={id:string;displayName:string;username:string};
type Comment={id:string;body:string;createdAt:string;author:Person};

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
    comments:<CommentList articleId={article.id} login={login}/>,
  })}</>;
}
function CommentList({articleId,login}:{articleId:string;login:string}) {
  const {user}=useSession();
  const path='/api/articles/'+articleId+'/comments';
  const query=useQuery({queryKey:['comments',articleId],queryFn:({signal})=>api<Comment[]>(path,'GET',undefined,signal)});
  const client=useQueryClient();
  const [body,setBody]=useState('');
  const [busy,setBusy]=useState(false);
  const [failure,setFailure]=useState('');
  async function send(event:FormEvent) {
    event.preventDefault();
    setBusy(true);setFailure('');
    try{await api(path,'POST',{body:body.trim()});setBody('');await Promise.all([query.refetch(),client.invalidateQueries({queryKey:['article',articleId]}),client.invalidateQueries({queryKey:['articles']})]);}
    catch(error){setFailure(error instanceof Error?error.message:'评论提交失败');}
    finally{setBusy(false);}
  }
  return <section id="article-comments" className="comments"><h2>评论</h2>
    {user?<form className="comment-form" onSubmit={send}><label htmlFor="comment-body">发表评论</label><textarea id="comment-body" rows={3} maxLength={2000} value={body} onChange={event=>setBody(event.target.value)}/><button className="primary" type="submit" disabled={busy||!body.trim()}>{busy?'发送中…':'发表评论'}</button>{failure&&<p className="error" role="alert">{failure}</p>}</form>:<Link to={login}>登录后发表评论</Link>}
    {!query.data? query.error?<p className="error" role="alert">{query.error.message} <button className="subtle" onClick={()=>void query.refetch()}>重试</button></p>:<p role="status" className="meta">加载评论…</p>
      :query.data.length?<ul className="comment-list">{query.data.map(comment=><li key={comment.id}><strong>{comment.author.displayName}</strong><p>{comment.body}</p></li>)}</ul>:<p className="meta">暂无评论</p>}
  </section>;
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
