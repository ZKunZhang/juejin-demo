import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useSession } from './session';
import { Pending, type Tag } from './articles';
import './pulses.css';
import './leaderboard.css';

type Pulse={id:string;body:string;images:string[];featured:boolean;createdAt:string;author:{id:string;displayName:string;avatarUrl:string|null};tags:{tag:Tag}[];_count:{likes:number};liked:boolean;following:boolean};
type Topic=Tag&{_count:{pulses:number}};
type RankedAuthor={id:string;displayName:string;likes:number;pulses:number};
const labels={following:'关注',recommended:'推荐',latest:'最新'} as const;
type Tab=keyof typeof labels;

export function PulseLeaderboard() {
  const {user}=useSession();
  const location=useLocation();
  const [shareStatus,setShareStatus]=useState('');
  const query=useQuery({queryKey:['pulse-leaderboard'],queryFn:({signal})=>api<RankedAuthor[]>('/api/pulses/leaderboard','GET',undefined,signal)});
  const myRank=user?query.data?.findIndex(author=>author.id===user.id):-1;
  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareStatus('链接已复制');
    } catch {
      setShareStatus('无法复制，可从地址栏复制链接');
    }
  }
  return <main className="leaderboard-layout">
    <aside className="surface leaderboard-sidebar">
      <div className="leaderboard-identity">
        <span className="leaderboard-avatar" aria-hidden="true">{user?Array.from(user.displayName)[0]:'◇'}</span>
        <strong>{user?.displayName||'游客'}</strong>
        {!user&&<Link to="/login?next=/pulses/leaderboard" state={{background:location}}>登录查看我的排名</Link>}
      </div>
      <nav aria-label="沸点社区">
        <Link to="/pulses">沸点首页</Link>
        <Link to="/pulses/leaderboard" aria-current="page">社区排行榜</Link>
      </nav>
    </aside>
    <section className="surface leaderboard-board" aria-labelledby="leaderboard-title">
      <header className="leaderboard-heading">
        <div>
          <h1 id="leaderboard-title">社区排行榜</h1>
          <p>按已发布沸点的获赞数排序，同分时按发布量排序。</p>
        </div>
        <button className="subtle leaderboard-share" type="button" onClick={share}>分享链接</button>
      </header>
      {shareStatus&&<p className="meta leaderboard-share-status" role="status">{shareStatus}</p>}
      <div className="leaderboard-section-heading">
        <h2>沸点人气榜</h2>
        {user&&query.data&&<span className="leaderboard-personal">我的排名 <strong>{typeof myRank==='number'&&myRank>=0?'第 '+(myRank+1)+' 名':'未上榜'}</strong></span>}
      </div>
      {!query.data?<Pending error={query.error} retry={()=>void query.refetch()}/>:query.data.length?
        <div className="leaderboard-table-frame">
          <table className="leaderboard-table" aria-label="沸点人气榜">
            <thead><tr><th scope="col">排名</th><th scope="col">用户</th><th scope="col">发布</th><th scope="col">获赞</th></tr></thead>
            <tbody>{query.data.map((author,index)=><tr key={author.id} data-rank={index+1} className={author.id===user?.id?'leaderboard-self':undefined}>
              <td><span className="leaderboard-rank">{index+1}</span></td>
              <th scope="row"><div className="leaderboard-author"><span className="leaderboard-avatar" aria-hidden="true">{Array.from(author.displayName)[0]}</span><span>{author.displayName}</span></div></th>
              <td>{author.pulses.toLocaleString('zh-CN')}</td><td>{author.likes.toLocaleString('zh-CN')}</td>
            </tr>)}</tbody>
          </table>
        </div>:<p className="work-message meta">暂无排行</p>}
    </section>
  </main>;
}

export function Pulses() {
  const {user}=useSession();
  const location=useLocation();
  const client=useQueryClient();
  const [params,setParams]=useSearchParams();
  const tab:Tab=params.get('tab')==='latest'?'latest':params.get('tab')==='following'?'following':'recommended';
  const tag=params.get('tagId')||'';
  const login='/login?next='+encodeURIComponent(location.pathname+location.search);
  useEffect(()=>{
    if(location.hash==='#publish'&&user)document.getElementById('pulse-body')?.focus();
  },[location.hash,user]);
  const [text,setText]=useState('');
  const [images,setImages]=useState('');
  const [selected,setSelected]=useState('');
  const [failure,setFailure]=useState('');
  const [publishing,setPublishing]=useState(false);
  const tags=useQuery({queryKey:['pulse-topics'],queryFn:({signal})=>api<Topic[]>('/api/pulses/topics','GET',undefined,signal)});
  const recommendedTopics=tags.data?.filter(item=>item._count.pulses>0).sort((a,b)=>b._count.pulses-a._count.pulses).slice(0,5);
  const feed=useQuery({queryKey:['pulses',tab,tag,user?.id],enabled:tab!=='following'||!!user,queryFn:({signal})=>api<Pulse[]>('/api/pulses?'+new URLSearchParams({tab,...(tag?{tagId:tag}:{})}),'GET',undefined,signal)});
  const featured=useQuery({queryKey:['featured-pulses',user?.id],queryFn:({signal})=>api<Pulse[]>('/api/pulses?tab=featured','GET',undefined,signal)});
  function select(key:string,value:string) {
    const next=new URLSearchParams(params);
    if(value)next.set(key,value);else next.delete(key);
    setParams(next);
  }
  async function publish(event:FormEvent) {
    event.preventDefault();setFailure('');setPublishing(true);
    try{
      await api('/api/pulses','POST',{body:text,images:images.split('\n').map(url=>url.trim()).filter(Boolean),...(selected?{tagId:selected}:{})});
      setText('');setImages('');setSelected('');setParams(new URLSearchParams({tab:'latest'}));
      await Promise.all(['pulses','pulse-topics','pulse-leaderboard','creator-overview'].map(key=>client.invalidateQueries({queryKey:[key]})));
    }catch(error){setFailure(error instanceof Error?error.message:'发布失败');}
    finally{setPublishing(false);}
  }
  return <main className="home-grid pulse-layout">
    <aside className="pulse-left"><section className="surface filter"><h2>沸点话题</h2><button className="subtle" aria-pressed={!tag} onClick={()=>select('tagId','')}>全部</button>{tags.data?.map(item=><button className="subtle" key={item.id} aria-pressed={tag===item.id} onClick={()=>select('tagId',item.id)}>{item.name}</button>)}</section>
      <Link className="surface subtle pulse-leaderboard-link" to="/pulses/leaderboard">社区排行榜</Link>
    </aside>
    <div className="pulse-main">
      <section id="publish" className="surface pulse-compose"><h1>发布沸点</h1>
        {user?<form onSubmit={publish}>
          <label htmlFor="pulse-body">分享动态</label><textarea id="pulse-body" rows={3} maxLength={2000} value={text} onChange={event=>setText(event.target.value)}/>
          <label htmlFor="pulse-images">图片地址（每行一个，最多四张）</label><textarea id="pulse-images" rows={2} maxLength={8000} value={images} onChange={event=>setImages(event.target.value)} placeholder="https://"/>
          <div className="pulse-controls"><select aria-label="发布话题" value={selected} onChange={event=>setSelected(event.target.value)}><option value="">选择话题</option>{tags.data?.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="primary" type="submit" disabled={publishing||(!text.trim()&&!images.trim())}>{publishing?'发布中…':'发布沸点'}</button></div>
          {failure&&<p className="error" role="alert">{failure}</p>}
        </form>:<Link to={login} state={{background:location}}>登录后发布沸点</Link>}
      </section>
      <section className="surface" aria-label="沸点列表">
        <nav className="pulse-tabs" aria-label="沸点排序">{Object.entries(labels).map(([value,label])=><button className="subtle" key={value} aria-pressed={tab===value} onClick={()=>select('tab',value)}>{label}</button>)}</nav>
        {tab==='following'&&!user ? <p className="work-message"><Link to={login} state={{background:location}}>登录后查看关注沸点</Link></p>
          :!feed.data?<Pending error={feed.error} retry={()=>void feed.refetch()}/>:feed.data.length?feed.data.map(item=><PulseCard key={item.id} item={item} login={login}/>):<p className="work-message meta">暂无沸点</p>}
      </section>
    </div>
    <aside className="pulse-side">
      <section className="surface side"><h2>我的沸点</h2>{user?<><p>{user.displayName}</p><Checkin userId={user.id}/></>:<Link to={login} state={{background:location}}>登录后签到</Link>}</section>
      <section className="surface side"><h2>精选沸点</h2>{!featured.data?<Pending error={featured.error} retry={()=>void featured.refetch()}/>:featured.data.length?<ul className="toc-list">{featured.data.map(item=><li key={item.id}>{item.body.slice(0,56)||item.author.displayName+'分享了图片'}</li>)}</ul>:<p>暂无精选</p>}</section>
      <section className="surface side" aria-labelledby="pulse-recommended-title">
        <h2 id="pulse-recommended-title">推荐话题</h2>
        {!recommendedTopics?<Pending error={tags.error} retry={()=>void tags.refetch()}/>:recommendedTopics.length?
          <ul className="pulse-recommendations">{recommendedTopics.map(item=><li key={item.id}>
            <button className="subtle" type="button" aria-pressed={tag===item.id} onClick={()=>select('tagId',item.id)}>
              <span>{item.name}</span><span className="meta">{item._count.pulses} 条</span>
            </button>
          </li>)}</ul>:<p>暂无推荐话题</p>}
      </section>
    </aside>
  </main>;
}
function PulseCard({item,login}:{item:Pulse;login:string}) {
  const {user}=useSession();
  const location=useLocation();
  const client=useQueryClient();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function toggle(kind:'like'|'follow') {
    setBusy(true);setError('');
    try{
      if(kind==='like') await api('/api/pulses/'+item.id+'/like','PUT',{active:!item.liked});
      else await api('/api/users/'+item.author.id+'/follow','PUT',{active:!item.following});
      await Promise.all(['pulses','following','pulse-leaderboard'].map(key=>client.invalidateQueries({queryKey:[key]})));
    }
    catch(error){setError(error instanceof Error?error.message:'操作失败');}
    finally{setBusy(false);}
  }
  return <article className="pulse-card"><div className="article-meta"><span className="avatar" aria-hidden="true">{item.author.avatarUrl?.startsWith('https://')?<img src={item.author.avatarUrl} alt="" referrerPolicy="no-referrer"/>:Array.from(item.author.displayName)[0]}</span><strong>{item.author.displayName}</strong><time className="meta" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</time>{item.featured&&<span className="tag">精选</span>}{user&&user.id!==item.author.id&&<button className="subtle pulse-follow" type="button" aria-pressed={item.following} disabled={busy} onClick={()=>void toggle('follow')}>{item.following?'取消关注':'关注作者'}</button>}</div>
    {item.body&&<p>{item.body}</p>}
    {!!item.images.length&&<div className="pulse-images">{item.images.map((url,index)=><a href={url} key={url} target="_blank" rel="noreferrer"><img src={url} alt={'沸点图片 '+(index+1)} loading="lazy" referrerPolicy="no-referrer"/></a>)}</div>}
    <div className="article-meta">{item.tags.map(({tag})=><span className="tag" key={tag.id}>{tag.name}</span>)}
      {user?<button className="subtle" type="button" aria-pressed={item.liked} onClick={()=>void toggle('like')} disabled={busy}>{item.liked?'取消点赞':'点赞'} · {item._count.likes}</button>:<Link to={login} state={{background:location}} className="subtle">点赞 · {item._count.likes}</Link>}
    </div>{error&&<p className="error" role="alert">{error}</p>}
  </article>;
}
function Checkin({userId}:{userId:string}) {
  const key=['checkin',userId];
  const client=useQueryClient();
  const row=useQuery({queryKey:key,queryFn:({signal})=>api<{checked:boolean}>('/api/me/checkin','GET',undefined,signal)});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function check() {
    setBusy(true);setError('');
    try{client.setQueryData(key,await api('/api/me/checkin','POST'));}
    catch(error){setError(error instanceof Error?error.message:'签到失败');}
    finally{setBusy(false);}
  }
  if(!row.data)return <Pending error={row.error} retry={()=>void row.refetch()}/>;
  return <><button className="subtle" onClick={check} disabled={row.data.checked||busy}>{row.data.checked?'今日已签到':'今日签到'}</button>{error&&<p className="error" role="alert">{error}</p>}</>;
}
