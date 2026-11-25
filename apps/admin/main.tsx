import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityEditor, ActivityQueue } from './activities';
import { api } from '../web/api';
import { AuthPage } from '../web/auth-page';
import { SessionProvider, useSession } from '../web/session';
import { Markdown } from '../web/markdown';
import { Pending, statusText, type Article } from '../web/articles';
import '../web/styles.css';
import './admin.css';

const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
type List<T>={items:T[];hasMore:boolean};
type AdminArticle=Article&{reviews:{articleVersion:number;action:string;reason:string|null;actor:{displayName:string}}[]};
type Comment={id:string;body:string;status:'VISIBLE'|'HIDDEN';parent:{id:string;status:'VISIBLE'|'HIDDEN'}|null;author:{displayName:string};article:{id:string;title:string}};
const errors=(error:unknown)=>error instanceof Error?error.message:'处理失败，请重试';
const actionText:Record<string,string>={SUBMIT:'提交审核',APPROVE:'审核通过',REJECT:'驳回',UNLIST:'下架',RETURN_TO_DRAFT:'转回草稿'};

function AdminShell() {
  const {user,loading,error,retry,update}=useSession();
  const [failure,setFailure]=useState('');
  async function logout() {setFailure('');try{await api('/api/auth/logout','POST');update(null);}catch(error){setFailure(errors(error));}}
  if(loading||error)return <main className="surface work"><Pending error={error} retry={retry}/></main>;
  if(!user)return <Routes><Route path="/login" element={<AuthPage admin/>}/><Route path="*" element={<Navigate to="/login" replace/>}/></Routes>;
  if(user.role!=='ADMIN')return <main className="surface work"><h1>没有后台访问权限</h1><button className="subtle" onClick={logout}>退出并换账号</button>{failure&&<p className="error" role="alert">{failure}</p>}</main>;
  return <div className="admin-shell"><header className="site-header admin-header"><div className="header-inner"><Link className="wordmark" to="/"><span className="brand-mark">◇</span>码栈管理后台</Link><div className="account"><span className="nickname">{user.displayName}</span><button className="subtle" onClick={logout}>退出</button></div></div></header>
    <main className="admin admin-grid"><nav className="surface admin-nav" aria-label="管理导航"><NavLink to="/articles">文章审核</NavLink><NavLink to="/comments">评论管理</NavLink><NavLink to="/activities">活动管理</NavLink><a className="front-link" href="/">访问前台</a></nav><div className="surface admin-panel">
      {failure&&<p className="error" role="alert">{failure}</p>}
      <Routes><Route path="/" element={<Navigate to="/articles" replace/>}/><Route path="/login" element={<Navigate to="/articles" replace/>}/><Route path="/articles" element={<ReviewQueue/>}/><Route path="/articles/:id" element={<ReviewArticle/>}/><Route path="/comments" element={<Comments/>}/><Route path="/activities" element={<ActivityQueue/>}/><Route path="/activities/new" element={<ActivityEditor/>}/><Route path="/activities/:id" element={<ActivityEditor/>}/><Route path="*" element={<Navigate to="/articles" replace/>}/></Routes>
    </div></main></div>;
}
function PageSwitch({page,more,update}:{page:number;more:boolean;update:(page:number)=>void}) {
  return <div className="editor-actions"><button className="subtle" disabled={page===1} onClick={()=>update(page-1)}>上一页</button><button className="subtle" disabled={!more} onClick={()=>update(page+1)}>下一页</button></div>;
}
function ReviewQueue() {
  const [filter,setFilter]=useState('reviewStatus=PENDING');
  const [page,setPage]=useState(1);
  const query=useQuery({queryKey:['admin-articles',filter,page],queryFn:({signal})=>api<List<Article>>('/api/admin/articles?page='+page+(filter?'&'+filter:''),'GET',undefined,signal)});
  return <><h1>文章审核</h1><label className="admin-filter">状态<select value={filter} onChange={event=>{setFilter(event.target.value);setPage(1);}}><option value="reviewStatus=PENDING">待审核</option><option value="status=PUBLISHED">已发布</option><option value="status=UNLISTED">已下架</option><option value="">全部</option></select></label>
    {!query.data?<Pending error={query.error} retry={()=>void query.refetch()}/>:<>{query.data.items.length?<ul className="work-list">{query.data.items.map(item=><li key={item.id}><Link to={'/articles/'+item.id}>{item.title||'未命名文章'}</Link><span className="meta">{item.author.displayName} · {statusText(item)}</span></li>)}</ul>:<p className="meta">此状态下没有文章</p>}<PageSwitch page={page} more={query.data.hasMore} update={setPage}/></>}
  </>;
}
function ReviewArticle() {
  const {id}=useParams();
  const [reason,setReason]=useState('');
  const [failure,setFailure]=useState('');
  const [status,setStatus]=useState('');
  const [busy,setBusy]=useState(false);
  const query=useQuery({queryKey:['admin-article',id],queryFn:({signal})=>api<AdminArticle>('/api/admin/articles/'+id,'GET',undefined,signal)});
  const queryClient=useQueryClient();
  const row=query.data;
  useEffect(()=>{setReason('');setFailure('');setStatus('');},[id]);
  if(!row)return <Pending error={query.error} retry={()=>void query.refetch()}/>;
  async function run(action:'APPROVE'|'REJECT'|'UNLIST') {
    if(!row)return;
    setBusy(true);setFailure('');setStatus('');
    try {
      await api('/api/admin/articles/'+id+(action==='UNLIST'?'/unlist':'/review'),'POST',action==='UNLIST'?{version:row.version,reason}:{version:row.version,action,...(reason.trim()?{reason}:{})});
      setReason('');setStatus(actionText[action]+'成功');
      await Promise.all([query.refetch(),queryClient.invalidateQueries({queryKey:['admin-articles']})]);
    }catch(error){setFailure(errors(error));}
    finally{setBusy(false);}
  }
  return <><Link to="/articles">返回审核列表</Link><h1>{row.title||'未命名文章'}</h1><p className="meta">{row.author.displayName} · {statusText(row)} · 版本 {row.version}</p>
    <Markdown source={row.bodyMarkdown}/>
    {(row.reviewStatus==='PENDING'||row.status==='PUBLISHED')&&<section className="admin-action"><label>审核原因<textarea value={reason} maxLength={1000} rows={3} onChange={event=>setReason(event.target.value)}/></label>
      <div className="editor-actions">{row.reviewStatus==='PENDING'?<><button className="subtle" disabled={busy||!reason.trim()} onClick={()=>run('REJECT')}>驳回</button><button className="primary" disabled={busy} onClick={()=>run('APPROVE')}>审核通过</button></>:<button className="primary" disabled={busy||!reason.trim()} onClick={()=>run('UNLIST')}>下架</button>}</div>
    </section>}
    {failure&&<p className="error" role="alert">{failure} <button className="subtle" onClick={()=>void query.refetch()}>刷新</button></p>}
    {status&&<p role="status">{status}</p>}
    <h2>操作记录</h2>{row.reviews.length?<ul className="work-list">{row.reviews.map(log=><li key={log.articleVersion}><span>{actionText[log.action]||log.action} · {log.actor.displayName}</span><span>{log.reason}</span></li>)}</ul>:<p className="meta">暂无操作记录</p>}
  </>;
}
function Comments() {
  const [filter,setFilter]=useState('');
  const [page,setPage]=useState(1);
  const query=useQuery({queryKey:['admin-comments',filter,page],queryFn:({signal})=>api<List<Comment>>('/api/admin/comments?page='+page+(filter?'&status='+filter:''),'GET',undefined,signal)});
  return <><h1>评论管理</h1><label className="admin-filter">状态<select value={filter} onChange={event=>{setFilter(event.target.value);setPage(1);}}><option value="">全部</option><option value="VISIBLE">可见</option><option value="HIDDEN">已隐藏</option></select></label>
    {!query.data?<Pending error={query.error} retry={()=>void query.refetch()}/>:<>{query.data.items.length?query.data.items.map(comment=><CommentRow key={comment.id+comment.status} comment={comment} refresh={()=>void query.refetch()}/>):<p className="meta">没有匹配的评论</p>}<PageSwitch page={page} more={query.data.hasMore} update={setPage}/></>}
  </>;
}
function CommentRow({comment,refresh}:{comment:Comment;refresh:()=>void}) {
  const [reason,setReason]=useState('');
  const [failure,setFailure]=useState('');
  const [busy,setBusy]=useState(false);
  const visible=comment.status==='VISIBLE';
  async function moderate() {
    setBusy(true);setFailure('');
    try{await api('/api/admin/comments/'+comment.id+'/status','PATCH',{expectedStatus:comment.status,status:visible?'HIDDEN':'VISIBLE',...(visible?{reason}:{})});refresh();}
    catch(error){setFailure(errors(error));}
    finally{setBusy(false);}
  }
  return <article className="admin-comment"><p className="meta">{comment.author.displayName} · <Link to={'/articles/'+comment.article.id}>{comment.article.title}</Link> · {visible?'可见':'已隐藏'}{comment.parent && (comment.parent.status === 'HIDDEN' ? ' · 回复 · 所属评论已隐藏' : ' · 回复')}</p><p>{comment.body}</p>
    {visible&&<label>隐藏原因<textarea rows={2} value={reason} maxLength={1000} onChange={event=>setReason(event.target.value)}/></label>}
    <button className="subtle" disabled={busy||(visible&&!reason.trim())} onClick={moderate}>{visible?'隐藏评论':'恢复评论'}</button>
    {failure&&<p className="error" role="alert">{failure}</p>}
  </article>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><SessionProvider><BrowserRouter basename="/admin"><AdminShell/></BrowserRouter></SessionProvider></QueryClientProvider>);
