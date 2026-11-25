import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, HttpError } from './api';
import { useSession } from './session';
import { Markdown, MarkdownWithToc } from './markdown';
import { ArticleInteractions } from './interactions';

export type Tag = {id:string;name:string;slug:string};
export type Article = {
  id:string;title:string;summary:string|null;bodyMarkdown:string;
  author:{id:string;displayName:string;username:string};tags:{tag:Tag}[];publishedAt:string|null;
  status:'DRAFT'|'PUBLISHED'|'UNLISTED';reviewStatus:'NOT_SUBMITTED'|'PENDING'|'APPROVED'|'REJECTED';version:number;
  _count?:{likes:number;comments:number};
  related?:{id:string;title:string}[];reason?:string|null;
};
type Feed = {items:Article[];nextCursor:string|null};
const date = (value:string|null) => value ? new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium'}).format(new Date(value)) : '';
export function Pending({error,retry}: {error:Error|null;retry:()=>void}) {
  return error ? <p className="error work-message" role="alert">{error.message} <button className="subtle" onClick={retry}>重试</button></p> : <p className="work-message meta" role="status">加载中…</p>;
}
function useTags() { return useQuery({queryKey:['tags'],queryFn:({signal})=>api<Tag[]>('/api/tags','GET',undefined,signal)}); }
type PublicActivity={id:string;title:string;summary:string;url:string|null;coverUrl:string|null};
function ActivitySidebar() {
  const query=useQuery({queryKey:['activities'],queryFn:({signal})=>api<PublicActivity[]>('/api/activities','GET',undefined,signal)});
  return <aside className="surface side"><h2>社区活动</h2>
    {!query.data?<Pending error={query.error} retry={()=>void query.refetch()}/>:query.data.length?
      <ul className="activity-list">{query.data.map(item=><li key={item.id}>
        {item.coverUrl&&<img className="activity-cover" src={item.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event=>{event.currentTarget.hidden=true;}}/>}
        {item.url?<a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>:<strong>{item.title}</strong>}
        <p>{item.summary}</p>
      </li>)}</ul>:<p>暂无活动</p>}
  </aside>;
}
export function Home() {
  const tags=useTags();
  const [params,setParams]=useSearchParams();
  const filter=params.get('tagId')||'', word=params.get('q')||'', cursor=params.get('cursor')||'';
  const query=new URLSearchParams();
  if(filter)query.set('tagId',filter);
  if(word)query.set('q',word);
  if(cursor)query.set('cursor',cursor);
  const {data,error,refetch}=useQuery({queryKey:['articles',filter,word,cursor],queryFn:({signal})=>api<Feed>('/api/articles?'+query,'GET',undefined,signal)});
  function select(tagId:string) {
    const next=new URLSearchParams(params);
    next.delete('cursor');
    if(tagId)next.set('tagId',tagId);else next.delete('tagId');
    setParams(next);
    window.scrollTo(0,0);
  }
  return <main className="home-grid">
    <aside className="surface filter"><h2>分类</h2><button className="subtle" aria-pressed={!filter} onClick={()=>select('')}>全部文章</button>{tags.error ? <button className="subtle" onClick={()=>void tags.refetch()}>重试分类</button> : tags.data?.map(tag=><button key={tag.id} className="subtle" aria-pressed={filter===tag.id} onClick={()=>select(tag.id)}>{tag.name}</button>)}</aside>
    <section className="surface feed"><h1>{word?'搜索结果':'技术文章'}</h1>
    {!data ? <Pending error={error} retry={()=>void refetch()}/> : data.items.length ? data.items.map(item=><article key={item.id} className="feed-item">
      <Link className="item-title" to={'/articles/'+item.id}>{item.title}</Link>
      {item.summary && <p className="description">{item.summary}</p>}
      <div className="meta article-meta"><span>{item.author.displayName}</span><time dateTime={item.publishedAt||undefined}>{date(item.publishedAt)}</time>{item._count&&<span>{item._count.likes} 赞 · {item._count.comments} 评论</span>}{item.tags.map(({tag})=><button className="tag" onClick={()=>select(tag.id)} key={tag.id}>{tag.name}</button>)}</div>
    </article>) : <div className="empty"><p>{word||filter?'没有匹配的文章':'暂无公开文章'}</p>{(word||filter)&&<button className="subtle" onClick={()=>setParams(new URLSearchParams())}>清除筛选</button>}</div>}
    {data?.nextCursor&&<button className="subtle pager" onClick={()=>{query.set('cursor',data.nextCursor!);setParams(query);window.scrollTo(0,0);}}>下一页</button>}
    </section>
    <ActivitySidebar/>
  </main>;
}
export function ArticlePage() {
  const {id}=useParams();
  const query=useQuery({queryKey:['article',id],queryFn:({signal})=>api<Article>('/api/articles/'+id,'GET',undefined,signal)});
  if (!query.data) return <main className="surface work">{query.error instanceof HttpError && query.error.status===404 ? <><h1>文章不存在或已下架</h1><Link to="/">返回文章列表</Link></> : <Pending error={query.error} retry={()=>void query.refetch()}/>}</main>;
  const item=query.data;
  return <ArticleInteractions key={item.id} article={item}>{({actions,follow,comments})=><main className="detail-grid">
    <div className="detail-actions">{actions}<Link className="subtle" to="/">文章列表</Link><button className="subtle" onClick={async event=>{const button=event.currentTarget;try{await navigator.clipboard.writeText(location.href);button.textContent='已复制';}catch{button.textContent='复制失败';}}}>分享</button></div>
    <article className="surface detail">
      <h1>{item.title}</h1><div className="meta article-meta"><span>{item.author.displayName}</span><time dateTime={item.publishedAt||undefined}>{date(item.publishedAt)}</time>{item._count&&<span>{item._count.likes} 赞 · {item._count.comments} 评论</span>}{item.tags.map(({tag})=><Link className="tag" to={'/?tagId='+tag.id} key={tag.id}>{tag.name}</Link>)}</div>
      <MarkdownWithToc source={item.bodyMarkdown} after={comments} aside={<><section className="surface side"><h2>作者</h2><p>{item.author.displayName}</p>{follow}</section>{!!item.related?.length&&<section className="surface side"><h2>相关推荐</h2><ul className="toc-list">{item.related.map(row=><li key={row.id}><Link to={'/articles/'+row.id}>{row.title}</Link></li>)}</ul></section>}</>}/>
    </article>
  </main>}</ArticleInteractions>;
}
export const statusText=(row:Article)=>row.status==='PUBLISHED'?'已发布':row.status==='UNLISTED'?'已下架':row.reviewStatus==='PENDING'?'待审核':row.reviewStatus==='REJECTED'?'已驳回':'草稿';
export function Creator() {
  const location = useLocation();
  const {user,loading,error,retry}=useSession();
  const query=useQuery({queryKey:['creator',user?.id],enabled:!!user,queryFn:({signal})=>api<Article[]>('/api/me/articles','GET',undefined,signal)});
  if(loading||error)return <main className="surface work"><Pending error={error} retry={retry}/></main>;
  if(!user)return <main className="surface work"><Link to="/login?next=/creator/articles" state={{ background: location }}>登录创作者中心</Link></main>;
  return <main className="surface work"><div className="work-title"><h1>我的文章</h1><Link className="primary" to="/creator/articles/new">写文章</Link></div>
    {!query.data ? <Pending error={query.error} retry={()=>void query.refetch()}/> : query.data.length ? <ul className="work-list">{query.data.map(row=><li key={row.id}><Link to={'/creator/articles/'+row.id+'/edit'}>{row.title||'未命名文章'}</Link><span className="tag">{statusText(row)}</span></li>)}</ul> : <p className="work-message meta">暂无文章</p>}
  </main>;
}
export function Editor() {
  const {id}=useParams();
  const location=useLocation();
  const {user,loading,error,retry}=useSession();
  const tags=useTags();
  const draft=useQuery({queryKey:['draft',id,user?.id],enabled:!!id&&!!user,queryFn:({signal})=>api<Article>('/api/me/articles/'+id,'GET',undefined,signal)});
  if(loading||error)return <main className="surface work"><Pending error={error} retry={retry}/></main>;
  if(!user)return <main className="surface work"><Link to={'/login?next='+encodeURIComponent(location.pathname)} state={{ background: location }}>登录后写文章</Link></main>;
  if(!tags.data || (id&&!draft.data))return <main className="surface work"><Pending error={tags.error||draft.error} retry={()=>{void tags.refetch();if(id)void draft.refetch();}}/></main>;
  return <ArticleForm key={id||'new'} article={draft.data} tags={tags.data}/>;
}
function ArticleForm({article,tags}:{article?:Article;tags:Tag[]}) {
  const [row,setRow]=useState(article);
  const [title,setTitle]=useState(article?.title||'');
  const [summary,setSummary]=useState(article?.summary||'');
  const [body,setBody]=useState(article?.bodyMarkdown||'');
  const [tagIds,setTagIds]=useState(article?.tags.map(t=>t.tag.id)||[]);
  const [status,setStatus]=useState('');
  const [failure,setFailure]=useState('');
  const [busy,setBusy]=useState(false);
  const [preview,setPreview]=useState(false);
  const client=useQueryClient();
  const navigate=useNavigate();
  const readOnly=!!row&&(row.status!=='DRAFT'||row.reviewStatus==='PENDING');
  useEffect(()=>{if(row)document.title=(row.title||'草稿')+' · 码栈';return()=>{document.title='码栈 · 开发者社区';};},[row]);
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action=(event.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
    setBusy(true);setFailure('');setStatus('');
    try {
      const values={title,summary,bodyMarkdown:body,tagIds};
      let saved=row ? await api<Article>('/api/articles/'+row.id,'PATCH',{...values,version:row.version}) : await api<Article>('/api/articles','POST',values);
      setRow(saved);
      client.setQueryData(['draft',saved.id,saved.author.id],saved);
      await client.invalidateQueries({queryKey:['creator']});
      if(action==='submit') {
        saved=await api<Article>('/api/articles/'+saved.id+'/submit','POST',{version:saved.version});
        setRow(saved);
        client.setQueryData(['draft',saved.id,saved.author.id],saved);
        await client.invalidateQueries({queryKey:['creator']});
        setStatus('已提交审核');
        if(!article)navigate('/creator/articles/'+saved.id+'/edit',{replace:true});
      }else{setStatus('草稿已保存');if(!article)navigate('/creator/articles/'+saved.id+'/edit',{replace:true});}
    }catch(error){setFailure(error instanceof Error?error.message:'保存失败，请重试');}
    finally{setBusy(false);}
  }
  async function returnToDraft() {
    if (!row) return;
    setBusy(true);setFailure('');
    try {
      const saved=await api<Article>('/api/articles/'+row.id+'/return-to-draft','POST',{version:row.version});
      setRow(saved);client.setQueryData(['draft',saved.id,saved.author.id],saved);
      await client.invalidateQueries({queryKey:['creator']});
    } catch(error) { setFailure(error instanceof Error?error.message:'操作失败'); }
    finally {setBusy(false);}
  }
  return <main className="surface work editor"><div className="work-title"><h1>{row?'编辑文章':'写文章'}</h1><Link to="/creator/articles">我的文章</Link></div>
    {row&&<p className="meta">{statusText(row)} · 版本 {row.version}</p>}
    {row?.reason&&(row.reviewStatus==='REJECTED'||row.status==='UNLISTED')&&<p className="error">处理原因：{row.reason}</p>}
    {row?.status==='UNLISTED'&&<button className="subtle" onClick={returnToDraft} disabled={busy}>转回草稿</button>}
    <form onSubmit={save}>
      <label htmlFor="title">标题</label><input id="title" maxLength={160} value={title} disabled={busy||readOnly} onChange={event=>setTitle(event.target.value)}/>
      <label htmlFor="summary">摘要</label><input id="summary" maxLength={500} value={summary} disabled={busy||readOnly} onChange={event=>setSummary(event.target.value)}/>
      <fieldset disabled={busy||readOnly}><legend>标签</legend><div className="tag-options">{tags.map(tag=><label key={tag.id}><input type="checkbox" checked={tagIds.includes(tag.id)} onChange={event=>setTagIds(event.target.checked?[...tagIds,tag.id]:tagIds.filter(id=>id!==tag.id))}/>{tag.name}</label>)}</div></fieldset>
      <div className="work-title"><label htmlFor="body">Markdown 正文</label><button type="button" className="subtle" aria-pressed={preview} onClick={()=>setPreview(!preview)}>{preview?'返回编辑':'预览'}</button></div>
      {preview?<div className="preview"><Markdown source={body}/></div>:<textarea id="body" rows={16} maxLength={60000} value={body} disabled={busy||readOnly} onChange={event=>setBody(event.target.value)}/>}
      {failure&&<p className="error" role="alert">{failure}</p>}{status&&<p role="status">{status}</p>}
      {!readOnly&&<div className="editor-actions"><button type="submit" className="subtle" disabled={busy}>保存草稿</button><button type="submit" value="submit" className="primary" disabled={busy||!title.trim()||!body.trim()}>提交审核</button></div>}
    </form>
  </main>;
}
