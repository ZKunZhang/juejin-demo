import { useEffect, useState } from 'react';
import { Input } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../shared/api/api';
import { statusText, type Article } from '../../../shared/content/articles';
import { Markdown } from '../../../shared/ui/markdown';
import { Pending } from '../../../shared/ui/pending';
import { AppSelect } from '../../../shared/ui/select';
import { errors } from '../../shared/errors';
import { AdminDateRange, adminTime, appendAdminRange, emptyRange } from '../../shared/ui/date-range';
import { AdminPageSwitch as PageSwitch } from '../../shared/ui/page-switch';
import { AdminDialog } from '../../shared/ui/dialog';
import { Comments } from '../comments/comment-review';

type List<T>={items:T[];hasMore:boolean};
type AdminArticle=Article&{reviews:{articleVersion:number;action:string;reason:string|null;actor:{displayName:string}}[]};
const actionText:Record<string,string>={SUBMIT:'提交审核',APPROVE:'审核通过',REJECT:'驳回',UNLIST:'下架',RELIST:'重新上架',RETURN_TO_DRAFT:'转回草稿'};

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

export function ReviewQueue() {
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
      {requiresReason && <label>{label + '原因'}<Input.TextArea rows={3} maxLength={1000} disabled={busy} required value={reason} onChange={event=>setReason(event.target.value)}/></label>}
      {failure && <p className="error" role="alert">{failure}</p>}
      <div className="editor-actions"><button className="primary" disabled={busy || (requiresReason && !reason.trim())} type="submit">确认{label}</button></div>
    </form>
  </AdminDialog>;
}
export function ReviewArticle() {
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
      {row.status!=='UNLISTED' && <label>审核原因<Input.TextArea value={reason} maxLength={1000} rows={3} onChange={event=>setReason(event.target.value)}/></label>}
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
