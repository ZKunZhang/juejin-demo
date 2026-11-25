import { useState, type FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useSession } from './session';
import { Pending, type Tag } from './articles';
import './pulses.css';

type Pulse={id:string;body:string;images:string[];featured:boolean;createdAt:string;author:{id:string;displayName:string};tags:{tag:Tag}[];_count:{likes:number};liked:boolean};
const labels={following:'关注',recommended:'推荐',latest:'最新'} as const;
type Tab=keyof typeof labels;

export function Pulses() {
  const {user}=useSession();
  const location=useLocation();
  const client=useQueryClient();
  const [params,setParams]=useSearchParams();
  const tab:Tab=params.get('tab')==='latest'?'latest':params.get('tab')==='following'?'following':'recommended';
  const tag=params.get('tagId')||'';
  const login='/login?next='+encodeURIComponent(location.pathname+location.search);
  const [text,setText]=useState('');
  const [images,setImages]=useState('');
  const [selected,setSelected]=useState('');
  const [failure,setFailure]=useState('');
  const [publishing,setPublishing]=useState(false);
  const tags=useQuery({queryKey:['tags'],queryFn:({signal})=>api<Tag[]>('/api/tags','GET',undefined,signal)});
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
      await client.invalidateQueries({queryKey:['pulses']});
    }catch(error){setFailure(error instanceof Error?error.message:'发布失败');}
    finally{setPublishing(false);}
  }
  return <main className="home-grid pulse-layout">
    <aside className="surface filter"><h2>沸点话题</h2><button className="subtle" aria-pressed={!tag} onClick={()=>select('tagId','')}>全部</button>{tags.data?.map(item=><button className="subtle" key={item.id} aria-pressed={tag===item.id} onClick={()=>select('tagId',item.id)}>{item.name}</button>)}</aside>
    <div className="pulse-main">
      <section className="surface pulse-compose"><h1>发布沸点</h1>
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
    </aside>
  </main>;
}
function PulseCard({item,login}:{item:Pulse;login:string}) {
  const {user}=useSession();
  const location=useLocation();
  const client=useQueryClient();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function like() {
    setBusy(true);setError('');
    try{await api('/api/pulses/'+item.id+'/like','PUT',{active:!item.liked});await client.invalidateQueries({queryKey:['pulses']});}
    catch(error){setError(error instanceof Error?error.message:'操作失败');}
    finally{setBusy(false);}
  }
  return <article className="pulse-card"><div className="article-meta"><strong>{item.author.displayName}</strong><time className="meta" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</time>{item.featured&&<span className="tag">精选</span>}</div>
    {item.body&&<p>{item.body}</p>}
    {!!item.images.length&&<div className="pulse-images">{item.images.map((url,index)=><a href={url} key={url} target="_blank" rel="noreferrer"><img src={url} alt={'沸点图片 '+(index+1)} loading="lazy" referrerPolicy="no-referrer"/></a>)}</div>}
    <div className="article-meta">{item.tags.map(({tag})=><span className="tag" key={tag.id}>{tag.name}</span>)}
      {user?<button className="subtle" type="button" aria-pressed={item.liked} onClick={like} disabled={busy}>{item.liked?'取消点赞':'点赞'} · {item._count.likes}</button>:<Link to={login} state={{background:location}} className="subtle">点赞 · {item._count.likes}</Link>}
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
