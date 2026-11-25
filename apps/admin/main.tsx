import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityEditor, ActivityQueue } from './activities';
import { LeaderboardAdmin, PulseReview } from './pulse-review';
import { AdminDateRange, adminTime, appendAdminRange, emptyRange } from './date-range';
import { AdminDialog } from './dialog';
import { api } from '../web/api';
import { CommentMessage } from '../web/comments';
import { AuthPage } from '../web/auth-page';
import { SessionProvider, useSession } from '../web/session';
import { Markdown } from '../web/markdown';
import { Pending, statusText, type Article } from '../web/articles';
import '../web/styles.css';
import './admin.css';
import { AppSelect } from '../web/select';

const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
type List<T>={items:T[];hasMore:boolean};
type AdminArticle=Article&{reviews:{articleVersion:number;action:string;reason:string|null;actor:{displayName:string}}[]};
type CommentBase={id:string;createdAt:string;body:string;status:'VISIBLE'|'HIDDEN';author:{displayName:string}};
type Comment=CommentBase & {parent:{id:string;status:'VISIBLE'|'HIDDEN'}|null;article:{id:string;title:string}};
type PulseComment=CommentBase & {pulse:{id:string;body:string}};
const errors=(error:unknown)=>error instanceof Error?error.message:'处理失败，请重试';
const actionText:Record<string,string>={SUBMIT:'提交审核',APPROVE:'审核通过',REJECT:'驳回',UNLIST:'下架',RELIST:'重新上架',RETURN_TO_DRAFT:'转回草稿'};

function AdminShell() {
  const {user,loading,error,retry,update}=useSession();
  const [failure,setFailure]=useState('');
  async function logout() {setFailure('');try{await api('/api/auth/logout','POST');update(null);}catch(error){setFailure(errors(error));}}
  if(loading||error)return <main className="surface work"><Pending error={error} retry={retry}/></main>;
  if(!user)return <Routes><Route path="/login" element={<AuthPage admin/>}/><Route path="*" element={<Navigate to="/login" replace/>}/></Routes>;
  if(user.role!=='ADMIN')return <main className="surface work"><h1>没有后台访问权限</h1><button className="subtle" onClick={logout}>退出并换账号</button>{failure&&<p className="error" role="alert">{failure}</p>}</main>;
  return <div className="admin-shell"><header className="site-header admin-header"><div className="header-inner"><Link className="wordmark" to="/"><span className="brand-mark">◇</span>码栈管理后台</Link><div className="account"><span className="nickname">{user.displayName}</span><button className="subtle" onClick={logout}>退出</button></div></div></header>
    <main className="admin admin-grid"><nav className="surface admin-nav" aria-label="管理导航"><NavLink to="/comments">评论管理</NavLink><NavLink end to="/pulses">沸点管理</NavLink><NavLink to="/pulses/featured">精选沸点</NavLink><NavLink to="/articles">文章管理</NavLink><NavLink to="/activities">活动管理</NavLink><NavLink to="/leaderboard">社区排行榜</NavLink><a className="front-link" href="/">访问前台</a></nav><div className="surface admin-panel">
      {failure&&<p className="error" role="alert">{failure}</p>}
      <Routes><Route path="/" element={<Navigate to="/articles" replace/>}/><Route path="/login" element={<Navigate to="/articles" replace/>}/><Route path="/articles" element={<ReviewQueue/>}/><Route path="/articles/:id" element={<ReviewArticle/>}/><Route path="/comments" element={<Comments key="articles"/>}/><Route path="/comments/pulses" element={<Comments key="pulses" pulse/>}/><Route path="/pulses" element={<PulseReview key="review"/>}/><Route path="/pulses/featured" element={<PulseReview key="featured" featured/>}/><Route path="/leaderboard" element={<LeaderboardAdmin/>}/><Route path="/activities" element={<ActivityQueue/>}/><Route path="/activities/new" element={<ActivityEditor/>}/><Route path="/activities/:id" element={<ActivityEditor/>}/><Route path="*" element={<Navigate to="/articles" replace/>}/></Routes>
    </div></main></div>;
}
function PageSwitch({page,more,update}:{page:number;more:boolean;update:(page:number)=>void}) {
  return <div className="editor-actions"><button className="subtle" disabled={page===1} onClick={()=>update(page-1)}>上一页</button><button className="subtle" disabled={!more} onClick={()=>update(page+1)}>下一页</button></div>;
}
type ArticleAction = 'APPROVE' | 'REJECT' | 'UNLIST' | 'RELIST';
const articleActionLabel: Record<ArticleAction, string> = {
  APPROVE: '审核通过并上架', REJECT: '驳回', UNLIST: '下架', RELIST: '重新上架',
};

function articleActions(article: Article): ArticleAction[] {
  if (article.status === 'DRAFT' && article.reviewStatus === 'PENDING') return ['APPROVE', 'REJECT'];
  if (article.reviewStatus !== 'APPROVED') return [];
  if (article.status === 'PUBLISHED') return ['UNLIST'];
  if (article.status === 'UNLISTED') return ['RELIST'];
  return [];
}

function applyArticleAction(article: Article, action: ArticleAction, reason: string) {
  const path = action === 'UNLIST' ? 'unlist' : action === 'RELIST' ? 'relist' : 'review';
  const body = {
    version: article.version,
    ...(path === 'review' ? { action } : {}),
    ...(reason.trim() ? { reason: reason.trim() } : {}),
  };
  return api('/api/admin/articles/' + article.id + '/' + path, 'POST', body);
}

function ReviewQueue() {
  const [filter,setFilter]=useState('');
  const [page,setPage]=useState(1);
  const [range,setRange]=useState(emptyRange);
  const [selected,setSelected]=useState<{ kind: 'comments' | ArticleAction; article: Article }>();
  const [notice,setNotice]=useState('');
  const client=useQueryClient();
  const params=appendAdminRange(new URLSearchParams(filter),range);
  params.set('page',String(page));
  const query=useQuery({queryKey:['admin-articles',filter,page,range],queryFn:({signal})=>api<List<Article&{createdAt:string}>>('/api/admin/articles?'+params,'GET',undefined,signal)});
  const selectedAction = selected?.kind === 'comments' ? undefined : selected?.kind;
  return <><h1>文章管理</h1><div className="admin-filter"><span>状态</span><AppSelect label="状态" value={filter} onChange={value=>{setFilter(value);setPage(1);}} options={[{ value: '', label: '全部' }, { value: 'reviewStatus=PENDING', label: '待审核' }, { value: 'status=PUBLISHED', label: '已发布' }, { value: 'status=UNLISTED', label: '已下架' }]}/></div>
    <AdminDateRange applied={range} onApply={value=>{setRange(value);setPage(1);}}/>
    {notice && <p role="status">{notice}</p>}
    {!query.data ? <Pending error={query.error} retry={()=>void query.refetch()}/> : <>
      <div className="admin-list-scroll"><table className="admin-table" aria-label="文章列表">
        <thead><tr><th scope="col">标题</th><th scope="col">作者</th><th scope="col">创建时间</th><th scope="col">状态</th><th scope="col">文章浏览</th><th scope="col">操作</th></tr></thead>
        <tbody>{query.data.items.length ? query.data.items.map(item => <tr key={item.id}>
          <td><Link to={'/articles/'+item.id}>{item.title||'未命名文章'}</Link></td><td>{item.author.displayName}</td><td>{item.createdAt?adminTime(item.createdAt):'—'}</td><td>{statusText(item)}</td>
          <td>{item.viewCount}</td>
          <td className="row-actions"><button className="subtle" onClick={()=>setSelected({kind:'comments',article:item})}>管理评论（{item._count?.comments ?? 0}）</button>
            {articleActions(item).map(action => <button key={action} className="subtle" onClick={() => {
              setNotice(''); setSelected({ kind: action, article: item });
            }}>{articleActionLabel[action]}</button>)}
          </td>
        </tr>) : <tr><td colSpan={6}><p className="meta admin-table-empty">没有匹配的文章</p></td></tr>}</tbody>
      </table></div>
      <PageSwitch page={page} more={query.data.hasMore} update={setPage}/>
    </>}
    {selected?.kind==='comments' && <AdminDialog title={'管理评论 · '+(selected.article.title||'未命名文章')} close={()=>setSelected(undefined)}>
      <Comments articleId={selected.article.id}/>
    </AdminDialog>}
    {selected && selectedAction && <ArticleActionDialog
      article={selected.article} action={selectedAction} close={() => setSelected(undefined)}
      done={async () => {
        setSelected(undefined);
        setNotice(articleActionLabel[selectedAction] + '成功');
        await Promise.all([
          client.invalidateQueries({ queryKey: ['admin-articles'] }),
          client.invalidateQueries({ queryKey: ['admin-article', selected.article.id] }),
        ]);
      }}
    />}
  </>;
}
function ArticleActionDialog({article,action,close,done}:{
  article:Article; action:ArticleAction; close:()=>void; done:()=>Promise<void>;
}) {
  const [reason,setReason]=useState('');
  const [busy,setBusy]=useState(false);
  const [failure,setFailure]=useState('');
  const requiresReason = action === 'UNLIST' || action === 'REJECT';
  const label = articleActionLabel[action];
  return <AdminDialog title={label + '文章'} close={close} busy={busy}>
    <p>{article.title||'未命名文章'}</p>
    <form onSubmit={async event=>{
      event.preventDefault();
      if (busy || (requiresReason && !reason.trim())) return;
      setBusy(true);setFailure('');
      try {
        await applyArticleAction(article, action, reason);
        await done();
      } catch(error) {setFailure(errors(error));}
      finally {setBusy(false);}
    }}>
      {requiresReason && <label>{label + '原因'}<textarea rows={3} maxLength={1000} disabled={busy} required value={reason} onChange={event=>setReason(event.target.value)}/></label>}
      {failure && <p className="error" role="alert">{failure}</p>}
      <div className="editor-actions"><button className="primary" disabled={busy || (requiresReason && !reason.trim())} type="submit">确认{label}</button></div>
    </form>
  </AdminDialog>;
}
function ReviewArticle() {
  const {id}=useParams();
  const [showComments,setShowComments]=useState(false);
  const [reason,setReason]=useState('');
  const [failure,setFailure]=useState('');
  const [status,setStatus]=useState('');
  const [busy,setBusy]=useState(false);
  const query=useQuery({queryKey:['admin-article',id],queryFn:({signal})=>api<AdminArticle>('/api/admin/articles/'+id,'GET',undefined,signal)});
  const queryClient=useQueryClient();
  const row=query.data;
  useEffect(()=>{setReason('');setFailure('');setStatus('');setShowComments(false);},[id]);
  if(!row)return <Pending error={query.error} retry={()=>void query.refetch()}/>;
  async function run(action:ArticleAction) {
    if(!row)return;
    setBusy(true);setFailure('');setStatus('');
    try {
      await applyArticleAction(row,action,reason);
      setReason('');setStatus(actionText[action]+'成功');
      await Promise.all([query.refetch(),queryClient.invalidateQueries({queryKey:['admin-articles']})]);
    }catch(error){setFailure(errors(error));}
    finally{setBusy(false);}
  }
  return <><h1>{row.title||'未命名文章'}</h1><p className="meta">{row.author.displayName} · {statusText(row)} · 版本 {row.version}</p>
    <button className="subtle" onClick={()=>setShowComments(true)}>管理评论</button>
    {showComments && <AdminDialog title="管理评论" close={()=>setShowComments(false)}><Comments articleId={row.id}/></AdminDialog>}
    <Markdown source={row.bodyMarkdown}/>
    {articleActions(row).length > 0 && <section className="admin-action">
      {row.status!=='UNLISTED' && <label>审核原因<textarea value={reason} maxLength={1000} rows={3} onChange={event=>setReason(event.target.value)}/></label>}
      <div className="editor-actions">{articleActions(row).map(action => <button key={action}
        className={action==='REJECT'?'subtle':'primary'}
        disabled={busy || ((action==='REJECT'||action==='UNLIST') && !reason.trim())}
        onClick={()=>run(action)}>{articleActionLabel[action]}</button>)}</div>
    </section>}
    {failure&&<p className="error" role="alert">{failure} <button className="subtle" onClick={()=>void query.refetch()}>刷新</button></p>}
    {status&&<p role="status">{status}</p>}
    <h2>操作记录</h2>{row.reviews.length?<ul className="work-list">{row.reviews.map(log=><li key={log.articleVersion}><span>{actionText[log.action]||log.action} · {log.actor.displayName}</span><span>{log.reason}</span></li>)}</ul>:<p className="meta">暂无操作记录</p>}
  </>;
}
function Comments({pulse:legacyPulse=false,articleId}:{pulse?:boolean;articleId?:string}) {
  const [params]=useSearchParams();
  const navigate=useNavigate();
  const pulse=!articleId&&(legacyPulse||params.get('type')==='pulse');
  const scopeId=articleId??params.get(pulse?'pulseId':'articleId')??undefined;
  return <CommentList key={(pulse?'pulse:':'article:')+(scopeId??'')} pulse={pulse} scopeId={scopeId} embedded={!!articleId}
    onTypeChange={type=>navigate(type==='pulse'?'/comments?type=pulse':'/comments')}/>;
}
function CommentList({pulse,scopeId,embedded,onTypeChange}:{pulse:boolean;scopeId?:string;embedded:boolean;onTypeChange:(value:string)=>void}) {
  const [filter,setFilter]=useState('');
  const [page,setPage]=useState(1);
  const [range,setRange]=useState(emptyRange);
  const [keyword,setKeyword]=useState('');
  const [lookup,setLookup]=useState('');
  const [selection,setSelection]=useState<{value:string;label:string}|undefined>(
    !embedded&&scopeId?{value:'source:'+scopeId,label:pulse?'当前沸点':'当前文章'}:undefined,
  );
  const path=pulse?'/api/admin/pulse-comments':'/api/admin/comments';
  const scope=pulse?'沸点':'文章';
  const fixedScope=embedded;
  const word=keyword.trim();
  useEffect(()=>{
    const timer=window.setTimeout(()=>setLookup(word),200);
    return ()=>window.clearTimeout(timer);
  },[word]);
  const sources=useQuery({
    queryKey:['admin-comment-sources',path,lookup],enabled:!fixedScope,
    queryFn:({signal})=>api<{id:string;label:string}[]>(path+'/sources?'+new URLSearchParams({q:lookup}),'GET',undefined,signal),
  });
  const sourceId=selection?.value.startsWith('source:') ? selection.value.slice(7) : undefined;
  const search=selection?.value.startsWith('keyword:') ? selection.value.slice(8) : undefined;
  const options=[
    ...(!fixedScope?[{value:'all',label:'全部'+scope}]:[]),
    ...(!fixedScope && lookup===word ? sources.data??[] : []).map(item=>({value:'source:'+item.id,label:item.label})),
    ...(word ? [{value:'keyword:'+word,label:'搜索评论：'+word}] : []),
  ];
  if(selection && !options.some(item=>item.value===selection.value)) options.push(selection);
  const selectedArticleId=embedded?scopeId:!pulse?sourceId:undefined;
  const selectedPulseId=pulse?sourceId:undefined;
  const params=appendAdminRange(new URLSearchParams({page:String(page)}),range);
  if(filter) params.set('status',filter);
  if(selectedArticleId) params.set('articleId',selectedArticleId);
  if(selectedPulseId) params.set('pulseId',selectedPulseId);
  if(search) params.set('q',search);
  const query=useQuery({queryKey:['admin-comments',pulse,selectedArticleId,selectedPulseId,filter,search,page,range],queryFn:({signal})=>api<List<Comment|PulseComment>>(path+'?'+params,'GET',undefined,signal)});
  return <>{!embedded&&<h1>评论管理</h1>}
    <div className="admin-comment-filters">
      {!embedded&&<div className="admin-filter"><span>内容类型</span><AppSelect label="内容类型" value={pulse?'pulse':'article'}
        options={[{value:'article',label:'文章'},{value:'pulse',label:'沸点'}]} onChange={onTypeChange}/></div>}
      <div className="admin-comment-search">
        <AppSelect label={fixedScope?'搜索评论':scope+'来源'} value={selection?.value??(!fixedScope?'all':undefined)} options={options}
          placeholder={fixedScope?'输入评论关键词':pulse?'搜索沸点正文、ID 或评论关键词':'搜索文章标题、ID 或评论关键词'}
          search={{value:keyword,onChange:value=>setKeyword(value.slice(0,100)),
            loading:!fixedScope && (lookup!==word || sources.isFetching),
            emptyText:fixedScope?'输入关键词搜索评论':sources.isError?'无法加载候选内容':'暂无候选内容'}}
          onChange={value=>{setSelection(options.find(item=>item.value===value));setKeyword('');setPage(1);}}/>
        {((selection&&selection.value!=='all')||keyword) && <button className="subtle" type="button" onClick={()=>{setKeyword('');setSelection(undefined);setPage(1);}}>清除搜索</button>}
      </div>
      <div className="admin-filter"><span>状态</span><AppSelect label="状态" value={filter} onChange={value=>{setFilter(value);setPage(1);}} options={[{ value: '', label: '全部' }, { value: 'VISIBLE', label: '可见' }, { value: 'HIDDEN', label: '已隐藏' }]}/></div>
    </div>
    <AdminDateRange applied={range} onApply={value=>{setRange(value);setPage(1);}}/>
    {!query.data?<Pending error={query.error} retry={()=>void query.refetch()}/>:<>{query.data.items.length?query.data.items.map(comment=><CommentRow key={comment.id+comment.status} comment={comment} path={path} scoped={fixedScope || !!sourceId} refresh={()=>query.refetch()}/>):<p className="meta">没有匹配的{scope}评论</p>}<PageSwitch page={page} more={query.data.hasMore} update={setPage}/></>}
  </>;
}
function CommentRow({comment,path,scoped,refresh}:{comment:Comment|PulseComment;path:string;scoped:boolean;refresh:()=>Promise<unknown>}) {
  const [reason,setReason]=useState('');
  const [failure,setFailure]=useState('');
  const [busy,setBusy]=useState(false);
  const visible=comment.status==='VISIBLE';
  async function moderate() {
    setBusy(true);setFailure('');
    try{await api(path+'/'+comment.id+'/status','PATCH',{expectedStatus:comment.status,status:visible?'HIDDEN':'VISIBLE',...(visible?{reason}:{})});await refresh();}
    catch(error){setFailure(errors(error));}
    finally{setBusy(false);}
  }
  return <article className="admin-comment">
    <CommentMessage author={comment.author.displayName} body={comment.body} details={<>
      {!scoped && ('article' in comment
        ? <><Link className="meta" to={'/articles/'+comment.article.id}>{comment.article.title||'未命名文章'}</Link>
          <Link to={'/comments?articleId='+comment.article.id}>查看该文章评论</Link></>
        : <><span className="meta">沸点 · {comment.pulse.body.slice(0,80)||'图片沸点'}</span>
          <Link to={'/comments/pulses?pulseId='+comment.pulse.id}>查看该沸点评论</Link></>)}
      <span className="meta">{comment.createdAt?adminTime(comment.createdAt)+' · ':''}{visible?'可见':'已隐藏'}{'parent' in comment && comment.parent &&
        (comment.parent.status === 'HIDDEN' ? ' · 回复 · 所属评论已隐藏' : ' · 回复')}</span>
    </>}/>
    {visible&&<label>隐藏原因<textarea rows={2} value={reason} disabled={busy} maxLength={1000} onChange={event=>setReason(event.target.value)}/></label>}
    <button className="subtle" disabled={busy||(visible&&!reason.trim())} onClick={moderate}>{visible?'隐藏评论':'恢复评论'}</button>
    {failure&&<p className="error" role="alert">{failure} <button className="subtle" onClick={()=>void refresh()}>刷新</button></p>}
  </article>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><SessionProvider><BrowserRouter basename="/admin"><AdminShell/></BrowserRouter></SessionProvider></QueryClientProvider>);
