import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, HttpError } from '../web/api';
import { Pending } from '../web/articles';
import { AdminDateRange, adminTime, appendAdminRange, emptyRange } from './date-range';
import { AppSelect } from '../web/select';

type Status='DRAFT'|'PUBLISHED'|'UNLISTED';
type Activity={id:string;title:string;summary:string;url:string|null;coverUrl:string|null;status:Status;sortOrder:number;visibleFrom:string|null;visibleTo:string|null;version:number;createdAt:string};
const labels:Record<Status,string>={DRAFT:'草稿',PUBLISHED:'已发布',UNLISTED:'已下架'};
function localDate(value:string|null|undefined) {
  if(!value)return '';
  const date=new Date(value);
  return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
export function ActivityQueue() {
  const [page,setPage]=useState(1);
  const [range,setRange]=useState(emptyRange);
  const params=appendAdminRange(new URLSearchParams({page:String(page)}),range);
  const result=useQuery({queryKey:['admin-activities',page,range],queryFn:({signal})=>api<{items:Activity[];hasMore:boolean}>('/api/admin/activities?'+params,'GET',undefined,signal)});
  return <><div className="work-title"><h1>活动管理</h1><Link className="primary" to="/activities/new">新建活动</Link></div>
    <AdminDateRange applied={range} onApply={value=>{setRange(value);setPage(1);}}/>
    {!result.data?<Pending error={result.error} retry={()=>void result.refetch()}/>:<>{result.data.items.length?
      <ul className="work-list">{result.data.items.map(row=><li key={row.id}><Link to={'/activities/'+row.id}>{row.title}</Link><span className="meta">{labels[row.status]} · 顺序 {row.sortOrder}{row.createdAt?' · '+adminTime(row.createdAt):''}</span></li>)}</ul>:<p className="meta">没有匹配的活动</p>}
      <div className="editor-actions"><button className="subtle" disabled={page===1} onClick={()=>setPage(page-1)}>上一页</button><button className="subtle" disabled={!result.data.hasMore} onClick={()=>setPage(page+1)}>下一页</button></div></>}
  </>;
}
export function ActivityEditor() {
  const {id}=useParams();
  const [revision,setRevision]=useState(0);
  const query=useQuery({queryKey:['admin-activity',id],enabled:!!id,queryFn:({signal})=>api<Activity>('/api/admin/activities/'+id,'GET',undefined,signal)});
  if(id&&!query.data)return <Pending error={query.error} retry={()=>void query.refetch()}/>;
  return <ActivityForm key={(id||'new')+':'+revision} item={query.data} reload={async()=>{
    const refreshed=await query.refetch();
    if(refreshed.error)throw refreshed.error;
    setRevision(value=>value+1);
  }}/>;
}
function ActivityForm({item,reload}:{item?:Activity;reload:()=>Promise<void>}) {
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState<Status>(item?.status||'DRAFT');
  const [failure,setFailure]=useState('');
  const [version,setVersion]=useState(item?.version);
  const [conflict,setConflict]=useState(false);
  const [saved,setSaved]=useState(false);
  const navigate=useNavigate();
  const client=useQueryClient();
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw=new FormData(event.currentTarget);
    const value=(key:string)=>String(raw.get(key)||'').trim();
    const iso=(key:string)=>value(key)?new Date(value(key)).toISOString():null;
    setBusy(true);setFailure('');setSaved(false);setConflict(false);
    try{
      const payload={title:value('title'),summary:value('summary'),url:value('url')||null,coverUrl:value('coverUrl')||null,status,sortOrder:Number(value('sortOrder')),visibleFrom:iso('visibleFrom'),visibleTo:iso('visibleTo')};
      const path='/api/admin/activities'+(item?'/'+item.id:'');
      const row=await api<Activity>(path,item?'PATCH':'POST',item?{...payload,version}:payload);
      setVersion(row.version);setSaved(true);
      client.setQueryData(['admin-activity',row.id],row);
      await client.invalidateQueries({queryKey:['admin-activities']});
      if(!item)navigate('/activities/'+row.id,{replace:true});
    }catch(error){setFailure(error instanceof Error?error.message:'保存失败，请重试');setConflict(error instanceof HttpError&&error.status===409);}
    finally{setBusy(false);}
  }
  async function loadLatest() {
    setBusy(true);
    try{await reload();}catch(error){setFailure(error instanceof Error?error.message:'重新加载失败');}
    finally{setBusy(false);}
  }
  return <div className="editor"><h1>{item?'编辑活动':'新建活动'}</h1>
    <form onSubmit={submit}>
      <label htmlFor="activity-title">活动标题</label><input id="activity-title" name="title" required maxLength={120} defaultValue={item?.title}/>
      <label htmlFor="activity-summary">活动摘要</label><textarea id="activity-summary" name="summary" required maxLength={300} rows={3} defaultValue={item?.summary}/>
      <label htmlFor="activity-url">活动链接</label><input id="activity-url" name="url" type="url" maxLength={1000} defaultValue={item?.url||''}/>
      <label htmlFor="activity-cover">活动封面（HTTPS 图片地址）</label><input id="activity-cover" name="coverUrl" type="url" maxLength={2000} defaultValue={item?.coverUrl||''}/>
      <p className="activity-status-label">发布状态</p><AppSelect label="发布状态" value={status} onChange={setStatus}
        options={(Object.keys(labels) as Status[]).map(value=>({value,label:labels[value]}))}/>
      <label htmlFor="activity-sort">展示顺序（由小到大）</label><input id="activity-sort" type="number" name="sortOrder" min={0} max={9999} step={1} required defaultValue={item?.sortOrder||0}/>
      <label htmlFor="activity-from">展示开始（本地时间）</label><input id="activity-from" name="visibleFrom" type="datetime-local" defaultValue={localDate(item?.visibleFrom)}/>
      <label htmlFor="activity-to">展示结束（本地时间）</label><input id="activity-to" name="visibleTo" type="datetime-local" defaultValue={localDate(item?.visibleTo)}/>
      {failure&&<p className="error" role="alert">{failure}</p>}
      {conflict&&<button className="subtle" type="button" onClick={loadLatest} disabled={busy}>放弃当前修改并加载最新版本</button>}
      {saved&&<p role="status">活动已保存</p>}
      <div className="editor-actions"><button className="primary" type="submit" disabled={busy}>{busy?'保存中…':'保存活动'}</button></div>
    </form>
  </div>;
}
