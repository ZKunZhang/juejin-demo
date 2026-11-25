import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useSession } from './session';
import { Pending, statusText, type Article } from './articles';
import './creator.css';

type Overview={
  profile:{avatarUrl:string|null;createdAt:string};
  stats:{followers:number;following:number;views:number;likes:number;comments:number;bookmarks:number};
  recentArticles:Pick<Article,'id'|'title'|'status'|'reviewStatus'>[];
  recentPulses:{id:string;body:string;createdAt:string}[];
};
type Activity={id:string;title:string;summary:string;url:string|null;coverUrl:string|null};
type Topic={id:string;name:string;_count:{pulses:number}};
const metrics=[['followers','粉丝数'],['following','关注数'],['views','文章阅读'],['likes','文章获赞'],['comments','文章评论'],['bookmarks','文章收藏']] as const;
const shortcuts=[['写文章','/creator/articles/new','文'],['发沸点','/pulses#publish','沸'],['草稿箱','/creator/articles?status=draft','稿']] as const;
const date = new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium'});

export function CreatorMenu() {
  const {user}=useSession();
  const location=useLocation();
  const menu=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    const panel=menu.current;
    if(!panel)return;
    panel.open=false;
    function outside(event:PointerEvent){if(event.target instanceof Node&&!panel!.contains(event.target))panel!.open=false;}
    function escape(event:KeyboardEvent){if(event.key==='Escape'&&panel!.open){panel!.open=false;panel!.querySelector('summary')?.focus();}}
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape);
    return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[location.key]);
  const target='/creator';
  const next=user?target:'/login?next='+encodeURIComponent(target);
  return <div className="creator-menu">
    <Link className="primary" to={next} state={user?undefined:{background:location}}>创作者中心</Link>
    <details ref={menu}>
      <summary aria-label="创作快捷入口" title="创作快捷入口">⌄</summary>
      <div className="surface creator-menu-panel">
        {shortcuts.map(([label,path,icon])=><Link key={path} to={user?path:'/login?next='+encodeURIComponent(path)}
          state={user ? (path === '/creator/articles/new' ? { returnToPrevious: true } : undefined) : {background:location}} onClick={()=>{if(menu.current)menu.current.open=false;}}><span aria-hidden="true">{icon}</span>{label}</Link>)}
      </div>
    </details>
  </div>;
}

export function CreatorDashboard() {
  const location=useLocation();
  const {user,loading,error,retry}=useSession();
  const [tab,setTab]=useState<'articles'|'pulses'>('articles');
  const overview=useQuery({queryKey:['creator-overview',user?.id],enabled:!!user,queryFn:({signal})=>api<Overview>('/api/me/creator','GET',undefined,signal)});
  const activities=useQuery({queryKey:['activities'],enabled:!!user,queryFn:({signal})=>api<Activity[]>('/api/activities','GET',undefined,signal)});
  const topics=useQuery({queryKey:['pulse-topics'],enabled:!!user,queryFn:({signal})=>api<Topic[]>('/api/pulses/topics','GET',undefined,signal)});
  if(loading||error)return <main className="surface work"><Pending error={error} retry={retry}/></main>;
  if(!user)return <main className="surface work"><h1>创作者中心</h1><Link to="/login?next=/creator" state={{background:location}}>登录后开始创作</Link></main>;
  const data=overview.data;
  return <main className="creator-layout">
    <aside className="surface creator-sidebar"><Link className="primary" to="/creator/articles/new" state={{ returnToPrevious: true }}>写文章</Link>
      <nav aria-label="创作者导航"><Link to="/creator" aria-current="page">首页</Link><Link to="/creator/articles">文章管理</Link><Link to="/creator/articles?status=draft">草稿箱</Link><Link to="/pulses#publish">发沸点</Link><Link to="/me">个人主页</Link></nav>
    </aside>
    <div className="creator-main">
      <section className="surface creator-card creator-account">
        <span className="creator-avatar" aria-hidden="true">{data?.profile.avatarUrl&&/^https?:\/\//i.test(data.profile.avatarUrl)?<img src={data.profile.avatarUrl} alt=""/>:Array.from(user.displayName)[0]}</span>
        <div><h1>{user.displayName}</h1>{data&&<p className="meta">加入码栈于 {date.format(new Date(data.profile.createdAt))}</p>}</div>
      </section>
      <section className="surface creator-card"><h2>数据概览</h2>
        {data?<dl className="creator-metrics">{metrics.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{data.stats[key].toLocaleString('zh-CN')}</dd></div>)}</dl>:<Pending error={overview.error} retry={()=>void overview.refetch()}/>}
      </section>
      <section className="surface creator-card"><div className="work-title"><h2>近期内容</h2><Link to="/creator/articles">文章管理</Link></div>
        <nav className="creator-content-tabs" aria-label="近期内容"><button className="subtle" aria-pressed={tab==='articles'} onClick={()=>setTab('articles')}>文章</button><button className="subtle" aria-pressed={tab==='pulses'} onClick={()=>setTab('pulses')}>沸点</button></nav>
        {!data?<Pending error={overview.error} retry={()=>void overview.refetch()}/>:tab==='articles'?(data.recentArticles.length?<ul className="work-list">{data.recentArticles.map(item=><li key={item.id}><Link to={'/creator/articles/'+item.id+'/edit'} state={{ returnToPrevious: true }}>{item.title||'未命名文章'}</Link><span className="tag">{statusText(item)}</span></li>)}</ul>:<p className="meta">暂无文章</p>):(data.recentPulses.length?<ul className="work-list creator-recent-pulses">{data.recentPulses.map(item=><li key={item.id}><span>{item.body||'图片沸点'}</span><time className="meta" dateTime={item.createdAt}>{date.format(new Date(item.createdAt))}</time></li>)}</ul>:<p className="meta">暂无沸点</p>)}
      </section>
    </div>
    <aside className="creator-main">
      <section className="surface creator-card"><h2>创作活动</h2>
        {!activities.data?<Pending error={activities.error} retry={()=>void activities.refetch()}/>:activities.data.length?activities.data.slice(0,3).map(item=><article className="creator-activity" key={item.id}>
          {item.coverUrl&&<img className="activity-cover" src={item.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event=>{event.currentTarget.hidden=true;}}/>}
          {item.url?<a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>:<strong>{item.title}</strong>}<p className="meta">{item.summary}</p>
        </article>):<p className="meta">暂无活动</p>}
      </section>
      <section className="surface creator-card"><h2>创作话题</h2>
        {!topics.data?<Pending error={topics.error} retry={()=>void topics.refetch()}/>:<ul className="creator-topic-list">{[...topics.data].sort((a,b)=>b._count.pulses-a._count.pulses).slice(0,5).map(item=><li key={item.id}><Link to={'/pulses?tagId='+item.id}>#{item.name}</Link><span className="meta">{item._count.pulses} 条</span></li>)}</ul>}
      </section>
    </aside>
  </main>;
}
