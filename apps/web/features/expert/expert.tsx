import { useState, type FormEvent } from 'react';
import { Button, Input } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../../shared/api/api';
import { useSession } from '../../../shared/auth/session';
import { Pending } from '../../../shared/ui/pending';
import './expert.css';

type Task = {id:string;title:string;summary:string;instructions:string;status:'OPEN'|'CLOSED';isDemo:boolean;createdAt:string};
type Annotation = {taskId:string;status:'CLAIMED'|'SUBMITTED';response:string|null;claimedAt:string;submittedAt:string|null;task:Task};
const message = (error:unknown) => error instanceof Error ? error.message : '操作失败，请重试';

export function ExpertAnnotation() {
  const {user,loading,error,retry}=useSession();
  const location=useLocation();
  const client=useQueryClient();
  const tasks=useQuery({queryKey:['expert-tasks'],queryFn:({signal})=>api<{items:Task[]}>('/api/expert/tasks','GET',undefined,signal)});
  const mine=useQuery({queryKey:['expert-annotations',user?.id],enabled:!!user,
    queryFn:({signal})=>api<{items:Annotation[]}>('/api/me/expert/annotations','GET',undefined,signal)});
  const [busy,setBusy]=useState<string|null>(null);
  const [failure,setFailure]=useState('');
  async function claim(taskId:string) {
    setBusy(taskId);setFailure('');
    try {
      await api('/api/expert/tasks/'+taskId+'/claim','POST');
      await client.invalidateQueries({queryKey:['expert-annotations',user?.id]});
    } catch(error) {setFailure(message(error));}
    finally {setBusy(null);}
  }
  return <main className="expert-page">
    <header className="expert-heading"><div><h1>专家标注</h1><p>阅读任务说明，记录你的判断与依据。</p></div>{user&&<a href="#my-annotations">我的标注</a>}</header>
    {failure&&<p className="error" role="alert">{failure}</p>}
    {loading||error?<Pending error={error} retry={retry}/>:!user&&<p className="expert-login"><Link to={'/login?next='+encodeURIComponent(location.pathname)} state={{background:location}}>登录后领取标注任务</Link></p>}
    <section aria-labelledby="expert-open-heading"><h2 id="expert-open-heading">开放任务</h2>
      {!tasks.data?<Pending error={tasks.error} retry={()=>void tasks.refetch()}/>:tasks.data.items.length?<div className="expert-task-grid">{tasks.data.items.map(task=>{
        const annotation=mine.data?.items.find(item=>item.taskId===task.id);
        return <article className="surface expert-task" key={task.id}>
          {task.isDemo&&<span className="expert-demo">演示任务</span>}<h3>{task.title}</h3><p>{task.summary}</p>
          <details><summary>查看任务说明</summary><p className="expert-instructions">{task.instructions}</p></details>
          {user&&(annotation?<a className="expert-task-status" href={'#annotation-'+task.id}>{annotation.status==='SUBMITTED'?'查看已提交标注':'继续标注'} ↗</a>:
            <Button disabled={!!busy||mine.isPending||!!mine.error} loading={busy===task.id} onClick={()=>void claim(task.id)}>领取任务</Button>)}
        </article>;
      })}</div>:<p className="surface expert-empty">当前没有开放任务。</p>}
    </section>
    {user&&<section className="expert-mine" id="my-annotations" aria-labelledby="expert-mine-heading"><h2 id="expert-mine-heading">我的标注</h2>
      {!mine.data?<Pending error={mine.error} retry={()=>void mine.refetch()}/>:mine.data.items.length?mine.data.items.map(annotation=>
        <AnnotationForm key={annotation.taskId+':'+annotation.status} annotation={annotation} done={()=>client.invalidateQueries({queryKey:['expert-annotations',user.id]})}/>):
        <p className="surface expert-empty">领取任务后，可在这里填写并提交标注。</p>}
    </section>}
  </main>;
}

function AnnotationForm({annotation,done}:{annotation:Annotation;done:()=>Promise<unknown>}) {
  const [response,setResponse]=useState(annotation.response??'');
  const [busy,setBusy]=useState(false);
  const [failure,setFailure]=useState('');
  const submitted=annotation.status==='SUBMITTED';
  const closed=annotation.task.status==='CLOSED';
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setFailure('');
    try {
      await api('/api/expert/tasks/'+annotation.taskId+'/submit','POST',{response:response.trim()});
      await done();
    } catch(error) {setFailure(message(error));}
    finally {setBusy(false);}
  }
  const id='annotation-'+annotation.taskId;
  return <article className="surface expert-annotation" id={id}>
    <header><h3>{annotation.task.title}</h3><span className="meta">{submitted?'已提交':closed?'任务已关闭':'处理中'}</span></header>
    <details><summary>任务说明</summary><p className="expert-instructions">{annotation.task.instructions}</p></details>
    {submitted?<><p className="expert-instructions">{annotation.response}</p><p className="meta">提交于 {new Date(annotation.submittedAt!).toLocaleString('zh-CN')}</p></>:
      <form onSubmit={submit}><label htmlFor={id+'-response'}>标注结果</label>
        <Input.TextArea id={id+'-response'} rows={5} maxLength={10000} required disabled={busy||closed} value={response}
          placeholder="填写判断结果和理由" onChange={event=>setResponse(event.target.value)}/>
        {failure&&<p className="error" role="alert">{failure}</p>}
        <Button type="primary" htmlType="submit" loading={busy} disabled={closed||!response.trim()}>提交标注</Button>
      </form>}
  </article>;
}
