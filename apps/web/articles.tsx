import { MatchingTags, SearchArticle } from './search';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, HttpError } from './api';
import { useSession } from './session';
import { Markdown, MarkdownWithToc } from './markdown';
import { ArticleInteractions } from './interactions';
import { ArticleIcon } from './article-icons';
import './creator.css';
import './article-detail.css';

export type Tag = {id:string;name:string;slug:string};
export type Article = {
  id:string;title:string;summary:string|null;bodyMarkdown:string;
  author:{id:string;displayName:string;username:string;avatarUrl?:string|null};tags:{tag:Tag}[];publishedAt:string|null;
  status:'DRAFT'|'PUBLISHED'|'UNLISTED';reviewStatus:'NOT_SUBMITTED'|'PENDING'|'APPROVED'|'REJECTED';version:number;
  viewCount:number;
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
const articleTabs={recommended:'推荐',latest:'最新',following:'关注'} as const;
export function Home() {
  const {user,loading}=useSession();
  const location=useLocation();
  const tags=useTags();
  const [params,setParams]=useSearchParams();
  const filter=params.get('tagId')||'', word=params.get('q')?.trim().slice(0,100)||'', cursor=params.get('cursor')||'';
  const tagsOnly=!!word && params.get('type')==='tag';
  const tab=!word&&params.get('tab')==='following'?'following':params.get('tab')==='latest'?'latest':'recommended';
  const query=new URLSearchParams({tab});
  if(filter)query.set('tagId',filter);
  if(word)query.set('q',word);
  if(cursor)query.set('cursor',cursor);
  const {data,error,refetch}=useQuery({queryKey:['articles',tab,filter,word,cursor,tab==='following'?user?.id:undefined],enabled:!tagsOnly&&(tab!=='following'||!!user),queryFn:({signal})=>api<Feed>('/api/articles?'+query,'GET',undefined,signal)});
  function changeTab(value:string) {
    const next=new URLSearchParams(params);
    next.delete('cursor');next.set('tab',value);
    setParams(next);
  }
  function select(tagId:string) {
    const next=new URLSearchParams(params);
    next.delete('cursor');
    next.delete('type');
    if(tagId)next.set('tagId',tagId);else next.delete('tagId');
    setParams(next);
    window.scrollTo(0,0);
  }
  if(word) return <main className="search-page">
    <header className="search-page-heading">
      <h1>搜索结果 <span>“{word}”</span></h1>
      <nav aria-label="搜索分类">
        {(['article','tag'] as const).map(type=><button key={type} aria-pressed={tagsOnly===(type==='tag')} onClick={()=>{
          const next=new URLSearchParams(params);
          next.delete('cursor');next.delete('tagId');
          if(type==='tag')next.set('type',type);else next.delete('type');
          setParams(next);
        }}>{type==='article'?'文章':'标签'}</button>)}
      </nav>
    </header>
    <section className="surface search-results" aria-label={tagsOnly?'标签结果':'文章结果'}>
      {tagsOnly ? !tags.data ? <Pending error={tags.error} retry={()=>void tags.refetch()}/> :
        <MatchingTags tags={tags.data} keyword={word} selectTag={tagId=>setParams({tagId})}/> : <>
        <div className="search-toolbar" role="group" aria-label="搜索结果排序">
          <button aria-pressed={tab==='recommended'} onClick={()=>changeTab('recommended')}>热门优先</button>
          <button aria-pressed={tab==='latest'} onClick={()=>changeTab('latest')}>最新优先</button>
          {filter&&<button className="tag" onClick={()=>select('')}>清除标签筛选</button>}
        </div>
        {!data ? <Pending error={error} retry={()=>void refetch()}/> : data.items.length ?
          data.items.map(item=><SearchArticle key={item.id} item={item} keyword={word} selectTag={select}/>) :
          <div className="empty"><p>没有匹配的文章</p></div>}
        {data?.nextCursor&&<button className="subtle pager" onClick={()=>{query.set('cursor',data.nextCursor!);setParams(query);window.scrollTo(0,0);}}>下一页</button>}
      </>}
    </section>
  </main>;
  return <main className="home-grid">
    <aside className="surface filter"><h2>分类</h2><button className="subtle" aria-pressed={!filter} onClick={()=>select('')}>全部文章</button>{tags.error ? <button className="subtle" onClick={()=>void tags.refetch()}>重试分类</button> : tags.data?.map(tag=><button key={tag.id} className="subtle" aria-pressed={filter===tag.id} onClick={()=>select(tag.id)}>{tag.name}</button>)}</aside>
    <section className="surface feed"><h1>技术文章</h1>
    <nav className="pulse-tabs" aria-label="文章排序">{Object.entries(articleTabs).map(([value,label])=><button key={value} className="subtle" type="button" aria-pressed={tab===value} onClick={()=>changeTab(value)}>{label}</button>)}</nav>
    {tab==='following'&&!user?(loading?<Pending error={null} retry={()=>{}}/>:<p className="work-message"><Link to={'/login?next='+encodeURIComponent(location.pathname+location.search)} state={{background:location}}>登录后查看关注文章</Link></p>):!data ? <Pending error={error} retry={()=>void refetch()}/> : data.items.length ? data.items.map(item=><article key={item.id} className="feed-item">
      <Link className="item-title" to={'/articles/'+item.id}>{item.title}</Link>
      {item.summary && <p className="description">{item.summary}</p>}
      <div className="meta article-meta"><span>{item.author.displayName}</span><time dateTime={item.publishedAt||undefined}>{date(item.publishedAt)}</time>{item._count&&<span>{item.viewCount} 阅读 · {item._count.likes} 赞 · {item._count.comments} 评论</span>}{item.tags.map(({tag})=><button className="tag" onClick={()=>select(tag.id)} key={tag.id}>{tag.name}</button>)}</div>
    </article>) : <div className="empty"><p>{filter?'没有匹配的文章':tab==='following'?'关注的作者暂无公开文章':'暂无公开文章'}</p>{filter&&<button className="subtle" onClick={()=>setParams(new URLSearchParams())}>清除筛选</button>}</div>}
    {data?.nextCursor&&<button className="subtle pager" onClick={()=>{query.set('cursor',data.nextCursor!);setParams(query);window.scrollTo(0,0);}}>下一页</button>}
    </section>
    <ActivitySidebar/>
  </main>;
}
export function ArticlePage() {
  const {id}=useParams();
  const [shareStatus,setShareStatus]=useState<{id:string;message:string}>();
  const client=useQueryClient();
  const query=useQuery({queryKey:['article',id],queryFn:({signal})=>api<Article>('/api/articles/'+id,'GET',undefined,signal)});
  const [counted,setCounted]=useState<{id:string;count:number}>();
  const available=!!query.data;
  useEffect(()=>{
    if(!id||!available)return;
    let current=true;
    void api<{viewCount:number}>('/api/articles/'+id+'/views','POST').then(result=>{
      if(current)setCounted({id,count:result.viewCount});
      void client.invalidateQueries({queryKey:['profile']});
    }).catch(()=>{});
    return()=>{current=false;};
  },[id,available,client]);
  if (!query.data) return <main className="surface work">{query.error instanceof HttpError && query.error.status===404 ? <><h1>文章不存在或已下架</h1><Link to="/">返回文章列表</Link></> : <Pending error={query.error} retry={()=>void query.refetch()}/>}</main>;
  const item=query.data;
  const shareMessage=shareStatus?.id===item.id?shareStatus.message:'';
  const readCount=counted&&counted.id===item.id ? Math.max(counted.count,item.viewCount) : item.viewCount;
  return <ArticleInteractions key={item.id} article={item}>{({actions,follow,comments})=><main className="detail-grid">
    <nav className="surface detail-actions" aria-label="文章操作">
      <div className="detail-action-group">{actions}</div>
      <div className="detail-action-group">
        <Link className="subtle article-action-icon" to="/" aria-label="文章列表" title="文章列表"><ArticleIcon name="list"/></Link>
        <button type="button" className="subtle article-action-icon" aria-label="分享" title="分享" onClick={async()=>{
          try {
            await navigator.clipboard.writeText(location.href);
            setShareStatus({id:item.id,message:'已复制'});
          } catch {
            setShareStatus({id:item.id,message:'复制失败'});
          }
        }}><ArticleIcon name={shareMessage==='已复制'?'check':'share'}/></button>
      </div>
      {shareMessage&&<span className="article-share-status" role="status">{shareMessage}</span>}
    </nav>
    <article className="surface detail">
      <h1>{item.title}</h1><div className="meta article-meta"><span>{item.author.displayName}</span><time dateTime={item.publishedAt||undefined}>{date(item.publishedAt)}</time>{item._count&&<span>{readCount} 阅读 · {item._count.likes} 赞 · {item._count.comments} 评论</span>}{item.tags.map(({tag})=><Link className="tag" to={'/?tagId='+tag.id} key={tag.id}>{tag.name}</Link>)}</div>
      <MarkdownWithToc source={item.bodyMarkdown} after={comments} aside={<><ArticleAuthor key={item.author.id} author={item.author} follow={follow}/>{!!item.related?.length&&<section className="surface side"><h2>相关推荐</h2><ul className="toc-list">{item.related.map(row=><li key={row.id}><Link to={'/articles/'+row.id}>{row.title}</Link></li>)}</ul></section>}</>}/>
    </article>
  </main>}</ArticleInteractions>;
}
function ArticleAuthor({author,follow}:{author:Article['author'];follow:React.ReactNode}) {
  const [failed,setFailed]=useState<string>();
  const avatar=author.avatarUrl && /^https?:\/\//i.test(author.avatarUrl) && author.avatarUrl!==failed ? author.avatarUrl : null;
  return <section className="surface article-author-card">
    <h2>作者</h2>
    <div className="article-author-identity">
      {avatar ? <img className="avatar" src={avatar} alt="" referrerPolicy="no-referrer" onError={()=>setFailed(avatar)}/> :
        <span className="avatar" aria-hidden="true">{Array.from(author.displayName)[0]}</span>}
      <strong>{author.displayName}</strong>
    </div>
    {follow && <div className="article-author-actions">{follow}</div>}
  </section>;
}
export const statusText=(row:Pick<Article,'status'|'reviewStatus'>)=>row.status==='PUBLISHED'?'已发布':row.status==='UNLISTED'?'已下架':row.reviewStatus==='PENDING'?'待审核':row.reviewStatus==='REJECTED'?'已驳回':'草稿';
export function Creator() {
  const location = useLocation();
  const {user,loading,error,retry}=useSession();
  const [params]=useSearchParams();
  const draftOnly=params.get('status')==='draft';
  const pageValue=params.get('page')||'1';
  const page=/^[1-9][0-9]{0,3}$/.test(pageValue)?Number(pageValue):1;
  const filter=new URLSearchParams({page:String(page),...(draftOnly?{status:'draft'}:{})});
  const pageLink=(number:number)=>'/creator/articles?'+new URLSearchParams({...Object.fromEntries(filter),page:String(number)});
  const query=useQuery({queryKey:['creator',user?.id,draftOnly,page],enabled:!!user,queryFn:({signal})=>api<Article[]>('/api/me/articles?'+filter,'GET',undefined,signal)});
  if(loading||error)return <main className="surface work"><Pending error={error} retry={retry}/></main>;
  if(!user)return <main className="surface work"><Link to="/login?next=/creator/articles" state={{ background: location }}>登录创作者中心</Link></main>;
  const rows=query.data;
  return <main className="surface work"><div className="work-title"><h1>{draftOnly?'草稿箱':'我的文章'}</h1><Link className="primary" to="/creator/articles/new" state={{ returnToPrevious: true }}>写文章</Link></div>
    <nav className="creator-content-tabs" aria-label="文章列表筛选"><Link to="/creator">创作者首页</Link><Link to="/creator/articles">全部文章</Link><Link to="/creator/articles?status=draft">草稿箱</Link></nav>
    {!query.data ? <Pending error={query.error} retry={()=>void query.refetch()}/> : rows?.length ? <ul className="work-list">{rows.map(row=><li key={row.id}><Link to={'/creator/articles/'+row.id+'/edit'} state={{ returnToPrevious: true }}>{row.title||'未命名文章'}</Link><span className="tag">{statusText(row)}</span></li>)}</ul> : <p className="work-message meta">暂无文章</p>}
    <div className="creator-content-tabs">{page>1&&<Link to={pageLink(page-1)}>上一页</Link>}{rows?.length===100&&page<9999&&<Link to={pageLink(page+1)}>下一页</Link>}</div>
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
  const [mode,setMode]=useState<'split'|'edit'|'preview'>('split');
  const bodyField=useRef<HTMLTextAreaElement>(null);
  function insert(before:string,after:string,sample:string) {
    const input=bodyField.current;
    if(!input)return;
    const {selectionStart:start,selectionEnd:end}=input;
    const value=body.slice(0,start)+before+(body.slice(start,end)||sample)+after+body.slice(end);
    if(value.length>60000)return;
    setBody(value);
    requestAnimationFrame(()=>{input.focus();input.setSelectionRange(start+before.length,start+before.length+(end-start||sample.length));});
  }
  const client=useQueryClient();
  const navigate=useNavigate();
  const location=useLocation();
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
      await Promise.all(['creator','creator-overview'].map(key=>client.invalidateQueries({queryKey:[key]})));
      if(action==='submit') {
        saved=await api<Article>('/api/articles/'+saved.id+'/submit','POST',{version:saved.version});
        setRow(saved);
        client.setQueryData(['draft',saved.id,saved.author.id],saved);
        await Promise.all(['creator','creator-overview'].map(key=>client.invalidateQueries({queryKey:[key]})));
        if(article) {
          if(location.state?.returnToPrevious === true) navigate(-1);
          else navigate('/creator/articles',{replace:true});
        } else navigate('/creator/articles/'+saved.id+'/edit',{replace:true,state:location.state});
      }else{
        setStatus('草稿已保存');
        if(!article)navigate('/creator/articles/'+saved.id+'/edit',{replace:true,state:location.state});
      }
    }catch(error){setFailure(error instanceof Error?error.message:'保存失败，请重试');}
    finally{setBusy(false);}
  }
  async function returnToDraft() {
    if (!row) return;
    setBusy(true);setFailure('');
    try {
      const saved=await api<Article>('/api/articles/'+row.id+'/return-to-draft','POST',{version:row.version});
      setRow(saved);client.setQueryData(['draft',saved.id,saved.author.id],saved);
      await Promise.all(['creator','creator-overview'].map(key=>client.invalidateQueries({queryKey:[key]})));
    } catch(error) { setFailure(error instanceof Error?error.message:'操作失败'); }
    finally {setBusy(false);}
  }
  const tools=[
    ['插入小节','H','## ','','小节标题'],
    ['粗体','B','**','**','粗体'],
    ['斜体','I','*','*','斜体'],
    ['引用','❝','> ','','引用文字'],
    ['链接','链接','[','](https://example.com)','链接文字'],
    ['图片','图片','![','](https://example.com/image.png)','图片说明'],
    ['代码块','代码','\n```\n','\n```\n','代码'],
    ['列表','列表','- ','','列表项'],
  ] as const;
  return <main className="surface editor creator-editor">
    <form className="creator-editor-form" onSubmit={save}>
      <div className="creator-editor-header">
        <div><Link to="/creator">创作者中心</Link><h1>{row?'编辑文章':'写文章'}</h1></div>
        <label className="creator-editor-title"><span>标题</span><input id="title" maxLength={160} placeholder="输入文章标题…" value={title} disabled={busy||readOnly} onChange={event=>setTitle(event.target.value)}/></label>
        <div className="creator-editor-actions"><Link className="subtle" to="/creator/articles?status=draft">草稿箱</Link>
          {!readOnly&&<><button type="submit" className="subtle" disabled={busy}>保存草稿</button><button type="submit" value="submit" className="primary" disabled={busy||!title.trim()||!body.trim()}>提交审核</button></>}
          {row?.status==='UNLISTED'&&<button type="button" className="subtle" onClick={returnToDraft} disabled={busy}>转回草稿</button>}
        </div>
      </div>
      <div className="creator-editor-toolbar">
        <div role="group" aria-label="Markdown 格式">{tools.map(([label,icon,before,after,sample])=><button key={label} type="button" className="subtle" title={label} aria-label={label} disabled={busy||readOnly||mode==='preview'} onClick={()=>insert(before,after,sample)}>{icon}</button>)}</div>
        <div className="editor-modes" role="group" aria-label="编辑视图">
          <details className="creator-editor-settings"><summary>发布设置</summary><div className="surface creator-editor-settings-panel">
        <label htmlFor="summary">摘要</label><input id="summary" maxLength={500} value={summary} disabled={busy||readOnly} onChange={event=>setSummary(event.target.value)}/>
        <fieldset disabled={busy||readOnly}><legend>标签</legend><div className="tag-options">{tags.map(tag=><label key={tag.id}><input type="checkbox" checked={tagIds.includes(tag.id)} disabled={tagIds.length>=10&&!tagIds.includes(tag.id)} onChange={event=>setTagIds(event.target.checked?[...tagIds,tag.id]:tagIds.filter(id=>id!==tag.id))}/>{tag.name}</label>)}</div></fieldset>
      </div></details>
          <button type="button" className="subtle editor-split-toggle" aria-pressed={mode==='split'} onClick={()=>setMode('split')}>双栏</button><button type="button" className="subtle" aria-pressed={mode==='edit'} onClick={()=>setMode('edit')}>编辑</button><button type="button" className="subtle" aria-pressed={mode==='preview'} onClick={()=>setMode('preview')}>预览</button>
        </div>
      </div>
      <div className={'creator-panes mode-'+mode}>
        <section className="creator-input-pane"><label htmlFor="body">Markdown 正文</label><textarea ref={bodyField} id="body" rows={16} maxLength={60000} value={body} readOnly={busy||readOnly} onChange={event=>setBody(event.target.value)} placeholder="从这里开始写作…"/></section>
        <section className="creator-preview-pane" aria-label="文章预览"><h2>预览</h2>{body?<Markdown source={body}/>:<p className="meta">输入正文后在这里预览</p>}</section>
      </div>
      <div className="creator-editor-footer"><span>字符数 {body.length.toLocaleString('zh-CN')}</span><span>行数 {body.split('\n').length}</span>{row&&<span>{statusText(row)} · 版本 {row.version}</span>}</div>
      {row?.reason&&(row.reviewStatus==='REJECTED'||row.status==='UNLISTED')&&<p className="error creator-editor-message">处理原因：{row.reason}</p>}
      {failure&&<p className="error creator-editor-message" role="alert">{failure}</p>}{status&&<p className="creator-editor-message" role="status">{status}</p>}

    </form>
  </main>;
}
