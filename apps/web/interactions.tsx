import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { api } from './api';
import { useSession } from './session';
import { refreshFollowState } from './follow-cache';
import type { Article } from './articles';
import { ArticleIcon } from './article-icons';
import { CommentSection } from './comments';
import { BookmarkDialog } from './bookmark-collections';

type Status={liked:boolean;bookmarked:boolean;collectionId:string|null;following:boolean};
type Person={id:string;displayName:string;username:string};

export function ArticleInteractions({article,children}:{article:Article;children:(value:{actions:React.ReactNode;follow:React.ReactNode;comments:React.ReactNode})=>React.ReactNode}) {
  const {user}=useSession();
  const location=useLocation();
  const login='/login?next='+encodeURIComponent(location.pathname+location.search);
  const client=useQueryClient();
  const key=['interaction',article.id,user?.id];
  const state=useQuery({queryKey:key,enabled:!!user,queryFn:({signal})=>api<Status>('/api/articles/'+article.id+'/interaction','GET',undefined,signal)});
  const [busy,setBusy]=useState(false);
  const [failure,setFailure]=useState('');
  const [bookmarkOpen,setBookmarkOpen]=useState(false);
  async function change(kind:keyof Omit<Status,'collectionId'>,path:string) {
    if (!state.data) return;
    setBusy(true);setFailure('');
    try {
      const result=await api<{active:boolean}>(path,'PUT',{active:!state.data[kind]});
      client.setQueryData<Status>(key,{...state.data,[kind]:result.active});
      if(kind==='following') await refreshFollowState(client);
      else await Promise.all(['articles','article','bookmarks','profile'].map(name=>client.invalidateQueries({queryKey:[name]})));
    }catch(error){setFailure(error instanceof Error?error.message:'操作失败');}
    finally{setBusy(false);}
  }
  async function saveBookmark(active:boolean,collectionId?:string|null) {
    const result=await api<{active:boolean}>('/api/articles/'+article.id+'/bookmark','PUT',{active,collectionId});
    client.setQueryData<Status>(key,current=>current && {...current,bookmarked:result.active,collectionId:active?collectionId??null:null});
    await Promise.all(['bookmarks','profile','bookmark-collections','collection-articles'].map(name=>
      client.invalidateQueries({queryKey:[name]})));
  }
  function action(kind:keyof Omit<Status,'collectionId'>,path:string,on:string,off:string,icon?:'like'|'bookmark',count?:number) {
    const active=state.data?.[kind]||false;
    const label=active?off:on;
    const content=icon?<><ArticleIcon name={icon}/>
      {icon==='bookmark' ? <span>{active?'已收藏':'收藏'}</span> : count!==undefined&&<span>{count}</span>}
    </>:label;
    const className=icon==='bookmark'?'subtle article-action-icon article-bookmark-action':icon?'subtle article-action-icon':'subtle';
    return user ? <button className={className} aria-label={label} title={icon?label:undefined}
      aria-pressed={active} disabled={busy||!state.data} onClick={()=>kind==='bookmarked'?setBookmarkOpen(true):void change(kind,path)}>{content}</button>
      : <Link className={className} aria-label={on} title={icon?on:undefined} to={login} state={{background:location}}>{content}</Link>;
  }
  return <>{children({
    actions:<>
      {action('liked','/api/articles/'+article.id+'/like','点赞','取消点赞','like',article._count?.likes)}
      <a className="subtle article-action-icon" href="#article-comments" aria-label="评论" title="评论">
        <ArticleIcon name="comment"/>{article._count&&<span>{article._count.comments}</span>}
      </a>
      {action('bookmarked','/api/articles/'+article.id+'/bookmark','收藏','管理收藏','bookmark')}
      {state.error&&<button className="subtle" onClick={()=>void state.refetch()}>重试互动状态</button>}
      {failure&&<span className="error" role="alert">{failure}</span>}
    </>,
    follow:user?.id!==article.author.id?action('following','/api/users/'+article.author.id+'/follow','关注作者','取消关注'):null,
    comments:<CommentSection key={user?.id} id="article-comments" threaded variant="article" count={article._count?.comments}
      path={'/api/articles/'+article.id+'/comments'} refresh={[['article',article.id],['articles']]}/>,
  })}
    {bookmarkOpen&&user&&state.data&&<BookmarkDialog key={user.id} userId={user.id} bookmarked={state.data.bookmarked}
      collectionId={state.data.collectionId??null} close={()=>setBookmarkOpen(false)} save={saveBookmark}/>}
  </>;
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
