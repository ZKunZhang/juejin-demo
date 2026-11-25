import { AdminPageSwitch } from './page-switch';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../web/api';
import { Pending } from '../web/articles';
import { AppSelect } from '../web/select';
import { AdminDateRange, adminTime, appendAdminRange, emptyRange } from './date-range';
import { AdminDialog } from './dialog';

type PulseStatus = 'PENDING' | 'PUBLISHED' | 'REJECTED' | 'UNLISTED';
type Pulse = {
  id: string;
  body: string;
  images: string[];
  createdAt: string;
  status: PulseStatus;
  featured: boolean;
  viewCount: number;
  _count?: { comments: number };
  reviewReason: string | null;
  author: { displayName: string };
};
const statusLabels: Record<PulseStatus, string> = {
  PENDING: '待审核',
  PUBLISHED: '已发布',
  REJECTED: '已拒绝',
  UNLISTED: '已下架',
};
const reviewFilters = [{ value: '', label: '全部' }, ...(Object.keys(statusLabels) as PulseStatus[]).map(value => ({ value, label: statusLabels[value] }))];
const featuredFilters = [{ value: 'true', label: '已精选' }, { value: 'false', label: '未精选' }, { value: '', label: '全部已发布' }];
const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });

export function PulseReview({ featured = false }: { featured?: boolean }) {
  const [filter, setFilter] = useState(featured ? 'true' : '');
  const [page, setPage] = useState(1);
  const [range,setRange]=useState(emptyRange);
  const [selected, setSelected] = useState<{ id: string; action: 'review' | 'featured' }>();
  const [notice, setNotice] = useState('');
  const client = useQueryClient();
  const params = appendAdminRange(new URLSearchParams({ page: String(page) }),range);
  if (featured) {
    params.set('status', 'PUBLISHED');
    if (filter) params.set('featured', filter);
  } else if (filter) params.set('status', filter);
  const query = useQuery({
    queryKey: ['admin-pulses', featured, filter, page, range],
    queryFn: ({ signal }) => api<{ items: Pulse[]; hasMore: boolean }>('/api/admin/pulses?' + params, 'GET', undefined, signal),
  });
  const pulse = query.data?.items.find(item => item.id === selected?.id);
  const title = featured ? '精选沸点' : '沸点管理';
  const emptyMessage = featured
    ? filter === 'true' ? '暂无精选沸点，可切换到「未精选」添加' : '没有匹配的已发布沸点'
    : filter === 'PENDING' ? '暂无待审核沸点，可切换状态查看其他记录' : '没有匹配的沸点';
  return <>
    <h1>{title}</h1>
    <div className="admin-filter"><span>状态</span><AppSelect label="状态" value={filter} onChange={value => {
      setFilter(value);
      setPage(1);
      setNotice('');
    }} options={featured ? featuredFilters : reviewFilters}/></div>
    <AdminDateRange applied={range} onApply={value=>{setRange(value);setPage(1);}}/>
    {notice && <p role="status">{notice}</p>}
    {!query.data ? <Pending error={query.error} retry={() => void query.refetch()}/> : <>
      <div className="admin-list-scroll"><table className="admin-table" aria-label={title + '列表'}>
        <thead><tr><th scope="col">内容摘要</th><th scope="col">作者</th><th scope="col">创建时间</th><th scope="col">状态</th><th scope="col">沸点浏览</th><th scope="col">操作</th></tr></thead>
        <tbody>{query.data.items.length ? query.data.items.map(item => <tr key={item.id}>
          <td>{item.body.length > 96 ? item.body.slice(0, 96) + '…' : item.body || '图片沸点'}</td>
          <td>{item.author.displayName}</td><td>{adminTime(item.createdAt)}</td>
          <td>{statusLabels[item.status]}{item.status === 'PUBLISHED' && item.featured && <span className="meta"> · 已精选</span>}</td>
          <td>{item.viewCount}</td>
          <td><div className="pulse-row-actions">
            {item.status === 'PUBLISHED' && <button className="subtle" onClick={() => { setSelected({id:item.id,action:'featured'}); setNotice(''); }}>
              {item.featured ? '取消精选' : '设为精选'}
            </button>}
            <button className="subtle" onClick={() => { setSelected({id:item.id,action:'review'}); setNotice(''); }}>
              {item.status === 'PENDING' ? '审核' : item.status === 'PUBLISHED' ? '下架' : '查看'}
            </button>
            <Link className="subtle" to={'/comments/pulses?pulseId='+item.id}>评论审核{item._count?.comments != null ? '（' + item._count.comments + '）' : ''}</Link>
          </div></td>
        </tr>) : <tr><td colSpan={6}><p className="meta admin-table-empty">{emptyMessage}</p></td></tr>}</tbody>
      </table></div>
      <AdminPageSwitch page={page} more={query.data.hasMore} update={setPage}/>
    </>}
    {pulse && <PulseDialog key={pulse.id} pulse={pulse} featured={selected?.action==='featured'} close={() => setSelected(undefined)}
      refresh={async () => { await query.refetch(); }} done={async message => {
        setSelected(undefined);
        setNotice(message);
        await client.invalidateQueries({ queryKey: ['admin-pulses'] });
      }}/>}
  </>;
}

function PulseDialog({ pulse, featured, close, refresh, done }: {
  pulse: Pulse; featured: boolean; close: () => void; refresh: () => Promise<void>; done: (notice: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  async function save(path: string, body: object, notice: string) {
    if (busy) return;
    setBusy(true);
    setFailure('');
    try {
      await api('/api/admin/pulses/' + pulse.id + '/' + path, 'PATCH', body);
      await done(notice);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  }
  function moderate(status: PulseStatus) {
    const notice = status === 'PUBLISHED' ? '审核已通过' : status === 'REJECTED' ? '审核已拒绝' : '沸点已下架';
    return save('status', { expectedStatus: pulse.status, status, ...(status === 'PUBLISHED' ? {} : { reason: reason.trim() }) }, notice);
  }
  const pending = pulse.status === 'PENDING';
  const actionable = pending || pulse.status === 'PUBLISHED';
  return <AdminDialog title={featured ? '管理精选' : pending ? '审核沸点' : '沸点详情'} close={close} busy={busy}>
    <p className="meta">{pulse.author.displayName} · {date.format(new Date(pulse.createdAt))} · {statusLabels[pulse.status]}</p>
    {pulse.body && <p className="admin-pulse-body">{pulse.body}</p>}
    {pulse.images.length > 0 && <div className="admin-pulse-images">{pulse.images.map((url, index) =>
      <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={'沸点图片 ' + (index + 1)} referrerPolicy="no-referrer"/></a>)}</div>}
    {pulse.reviewReason && <p className="meta">{pulse.status === 'REJECTED' ? '拒绝理由' : '处理原因'}：{pulse.reviewReason}</p>}
    {featured ? <div className="editor-actions">
      <button className="primary" disabled={busy} onClick={() => void save('featured',
        { expectedFeatured: pulse.featured, featured: !pulse.featured }, pulse.featured ? '已取消精选' : '已设为精选')}>
        {pulse.featured ? '取消精选' : '设为精选'}
      </button>
    </div> : actionable && <>
      <label>{pending ? '拒绝理由（拒绝时必填）' : '下架原因'}<textarea rows={2} maxLength={1000} disabled={busy} value={reason} onChange={event => setReason(event.target.value)}/></label>
      <div className="editor-actions">{pending ? <>
        <button className="subtle" disabled={busy || !reason.trim()} onClick={() => void moderate('REJECTED')}>审核拒绝</button>
        <button className="primary" disabled={busy} onClick={() => void moderate('PUBLISHED')}>审核通过</button>
      </> : <button className="primary" disabled={busy || !reason.trim()} onClick={() => void moderate('UNLISTED')}>下架</button>}</div>
    </>}
    {failure && <p className="error" role="alert">{failure} <button className="subtle" onClick={() => { setFailure(''); void refresh(); }}>刷新</button></p>}
  </AdminDialog>;
}

type Leader = { id: string; displayName: string; likes: number; pulses: number };

export function LeaderboardAdmin() {
  const [selected, setSelected] = useState<{ leader: Leader; rank: number }>();
  const query = useQuery({
    queryKey: ['admin-leaderboard'],
    queryFn: ({ signal }) => api<Leader[]>('/api/pulses/leaderboard', 'GET', undefined, signal),
  });
  return <>
    <h1>社区排行榜</h1>
    <p className="meta">显示前 50 名。按已发布沸点获赞数排序，点赞数相同时按发布数排序。</p>
    {!query.data ? <Pending error={query.error} retry={() => void query.refetch()}/> :
      <div className="admin-list-scroll"><table className="admin-table" aria-label="社区排行榜">
        <thead><tr><th scope="col">名次</th><th scope="col">用户</th><th scope="col">获赞</th><th scope="col">已发布沸点</th><th scope="col">操作</th></tr></thead>
        <tbody>{query.data.length ? query.data.map((leader, index) => <tr key={leader.id}>
          <td>{index + 1}</td><td>{leader.displayName}</td><td>{leader.likes}</td><td>{leader.pulses}</td>
          <td className="row-actions"><button className="subtle" onClick={() => setSelected({ leader, rank: index + 1 })}>查看详情</button></td>
        </tr>) : <tr><td colSpan={5}><p className="meta admin-table-empty">暂无榜单记录</p></td></tr>}</tbody>
      </table></div>}
    {selected && <AdminDialog title={selected.leader.displayName + ' · 榜单详情'} close={() => setSelected(undefined)}>
      <p>当前排名第 {selected.rank} 名</p>
      <p>获赞 {selected.leader.likes} 次 · 已发布沸点 {selected.leader.pulses} 条</p>
    </AdminDialog>}
  </>;
}
