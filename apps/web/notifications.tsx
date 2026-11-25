import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from './api';
import { Pending } from './articles';
import { useSession } from './session';
import './notifications.css';

type Notification = {
  id: string;
  kind: 'ARTICLE_PUBLISHED' | 'PULSE_PUBLISHED';
  targetId: string;
  preview: string;
  createdAt: string;
  readAt: string | null;
  actor: { displayName: string };
};
type Kind=Notification['kind'];
const categories=[['','全部通知'],['ARTICLE_PUBLISHED','文章发布'],['PULSE_PUBLISHED','沸点发布']] as const;
type Unread={count:number;byKind:Record<Kind,number>};
type Page = { items: Notification[]; nextCursor: string | null };
const endpoint = '/api/me/notifications';
const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });

function useUnread(userId: string | undefined) {
  return useQuery({
    queryKey: ['notification-unread', userId],
    queryFn: ({signal}) => api<Unread>(endpoint+'/unread','GET',undefined,signal),
    enabled: !!userId,
    refetchInterval: 15_000,
  });
}

export function NotificationBell({userId}: {userId:string}) {
  const data = useUnread(userId).data;
  const count = data?.count ?? 0;
  const location = useLocation();
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
  return <details className="notification-menu" ref={menu}>
    <summary className="notification-bell subtle" aria-label={count?'通知，'+count+' 条未读':'通知'}>
      <span className="notification-bell-icon" aria-hidden="true"/>
      {count>0&&<span className="notification-badge" aria-hidden="true">{count>99?'99+':count}</span>}
    </summary>
    <nav className="surface notification-menu-panel" aria-label="通知分类">
      {categories.map(([kind,label])=>{
        const quantity=kind?data?.byKind?.[kind]:count;
        return <Link key={kind} to={'/notifications'+(kind?'?kind='+kind:'')} onClick={()=>{if(menu.current)menu.current.open=false;}}>
          {label}{!!quantity&&<span className="notification-pill">{quantity>99?'99+':quantity}</span>}
        </Link>;
      })}
    </nav>
  </details>;
}

export function Notifications() {
  const {user,loading,error,retry}=useSession();
  const location=useLocation();
  const [params,setParams]=useSearchParams();
  const rawKind=params.get('kind');
  const kind:Kind|''=rawKind==='ARTICLE_PUBLISHED'||rawKind==='PULSE_PUBLISHED'?rawKind:'';
  const navigate=useNavigate();
  const client=useQueryClient();
  const unread=useUnread(user?.id);
  const [busy,setBusy]=useState(false);
  const [failure,setFailure]=useState('');
  const list=useInfiniteQuery({
    queryKey:['notifications',user?.id,kind],enabled:!!user,initialPageParam:'',
    queryFn:({pageParam,signal})=>api<Page>(endpoint+'?'+new URLSearchParams({
      ...(pageParam?{cursor:pageParam}:{}),...(kind?{kind}:{}),
    }),'GET',undefined,signal),
    getNextPageParam:page=>page.nextCursor??undefined,
  });
  if(loading||error)return <main className="surface work"><Pending error={error} retry={retry}/></main>;
  if(!user)return <main className="surface work"><h1>通知</h1><Link to="/login?next=/notifications" state={{background:location}}>登录查看通知</Link></main>;
  const rows=list.data?.pages.flatMap(page=>page.items);

  async function action(item?:Notification) {
    if(busy)return;
    const target=item?(item.kind==='ARTICLE_PUBLISHED'?'/articles/':'/pulses/')+item.targetId:null;
    if(item?.readAt&&target){navigate(target);return;}
    setBusy(true);
    setFailure('');
    try{
      if(item)await api(endpoint+'/'+item.id+'/read','PUT');
      else await api(endpoint+'/read-all'+(kind?'?kind='+kind:''),'POST');
      void Promise.all(['notifications','notification-unread'].map(key=>client.invalidateQueries({queryKey:[key,user?.id]})));
      if(target)navigate(target);
    }catch(error){setFailure(error instanceof Error?error.message:'更新通知失败，请重试');}
    finally{setBusy(false);}
  }

  const currentUnread=kind?unread.data?.byKind?.[kind]:unread.data?.count;
  return <main className="notifications-page">
    <nav className="surface notification-tabs" aria-label="通知筛选">{categories.map(([value,label])=>{
      const count=value?unread.data?.byKind?.[value]:unread.data?.count;
      return <button key={value} className="subtle" type="button" aria-pressed={value===kind}
        onClick={()=>{setFailure('');setParams(value?{kind:value}:{});}}>{label}{!!count&&<span className="notification-pill">{count>99?'99+':count}</span>}</button>;
    })}</nav>
    <section className="surface notification-board" aria-label="通知列表">
    <div className="work-title"><h1>通知</h1><button className="subtle" type="button" onClick={()=>void action()} disabled={busy||(!currentUnread&&!rows?.some(item=>!item.readAt))}>{kind?'本类标为已读':'全部标为已读'}</button></div>
    {failure&&<p className="error" role="alert">{failure}</p>}
    {!rows?<Pending error={list.error} retry={()=>void list.refetch()}/>:rows.length?
      <ul className="notification-list">{rows.map(item=><li key={item.id}>
        <button type="button" className="notification-item" disabled={busy} onClick={()=>void action(item)}>
          <span className="notification-avatar" data-unread={!item.readAt} title={item.readAt?'已读':'未读'}>{Array.from(item.actor.displayName)[0]}</span>
          <span className="notification-message"><strong>{item.actor.displayName}</strong> {item.kind==='ARTICLE_PUBLISHED'?'发布了新文章':'发布了新沸点'}
            <span className="notification-preview">{item.preview}</span></span>
          <time className="meta" dateTime={item.createdAt}>{date.format(new Date(item.createdAt))}</time>
        </button>
      </li>)}</ul>:<p className="work-message meta">暂无通知</p>}
    {list.hasNextPage&&<button className="subtle" type="button" disabled={list.isFetchingNextPage} onClick={()=>void list.fetchNextPage()}>{list.isFetchingNextPage?'加载中…':'加载更多'}</button>}
    {list.isFetchNextPageError&&<p className="error" role="alert">加载更多失败，请重试。</p>}
    </section>
  </main>;
}
