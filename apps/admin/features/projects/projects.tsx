import { useState } from 'react';
import { Button, Input, Select, Table, Tag } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, HttpError } from '../../../shared/api/api';
import { Markdown } from '../../../shared/ui/markdown';
import { Pending } from '../../../shared/ui/pending';
import { AdminDialog } from '../../shared/ui/dialog';
import { AdminDateRange, adminTime, appendAdminRange, emptyRange } from '../../shared/ui/date-range';
import { AdminPageSwitch } from '../../shared/ui/page-switch';

type Project = {
  id: string; title: string; summary: string; bodyMarkdown: string;
  projectUrl: string; repositoryUrl: string | null;
  status: 'DRAFT' | 'PENDING' | 'PUBLISHED' | 'REJECTED' | 'UNLISTED' | 'DELETED'; version: number;
  author: { id: string; displayName: string }; submittedAt: string | null;
  viewCount: number; likeCount: number;
};
const statuses = { DRAFT: '草稿', PENDING: '待审核', PUBLISHED: '已发布', REJECTED: '已驳回', UNLISTED: '已下架', DELETED: '已删除' };

export function AdminProjects() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [range, setRange] = useState(emptyRange);
  const [selected, setSelected] = useState<Project>();
  const [notice, setNotice] = useState('');
  const client = useQueryClient();
  const params = appendAdminRange(new URLSearchParams({ page: String(page), ...(status ? { status } : {}) }), range);
  const list = useQuery({
    queryKey: ['admin-projects', status, page, range],
    queryFn: ({ signal }) => api<{ items: Project[]; hasMore: boolean }>('/api/admin/projects?' + params, 'GET', undefined, signal),
  });
  async function reloadSelected() {
    const refreshed = await list.refetch();
    if (refreshed.error) throw refreshed.error;
    const latest = refreshed.data?.items.find(item => item.id === selected?.id);
    if (!latest) {
      setSelected(undefined);
      setNotice('作品状态已更新，请重新选择作品');
      return;
    }
    setSelected(latest);
  }
  async function reviewed(message: string) {
    setSelected(undefined);
    setNotice(message);
    await Promise.all([
      client.invalidateQueries({ queryKey: ['admin-projects'] }),
      client.invalidateQueries({ queryKey: ['projects'] }),
      client.invalidateQueries({ queryKey: ['projects-popular'] }),
      client.invalidateQueries({ queryKey: ['project', selected?.id] }),
    ]);
  }
  return <>
    <h1>作品管理</h1>
    <div className="admin-filter">
      <span>作品状态</span>
      <Select aria-label="作品状态" value={status} style={{ minWidth: 140 }} virtual={false}
        options={[{ value: '', label: '全部' }, ...Object.entries(statuses).map(([value, label]) => ({ value, label }))]}
        onChange={value => { setStatus(value); setPage(1); }}/>
    </div>
    <AdminDateRange label="提交日期（北京时间）" applied={range} onApply={value => { setRange(value); setPage(1); }}/>
    {notice && <p role="status">{notice}</p>}
    {!list.data ? <Pending error={list.error} retry={() => void list.refetch()}/> : <>
      <Table<Project> rowKey="id" dataSource={list.data.items} pagination={false} scroll={{ x: 700 }}
        locale={{ emptyText: '没有匹配的作品' }} columns={[
          { title: '作品', dataIndex: 'title', render: (title: string, item) => <><strong>{title}</strong><p className="meta">{item.summary}</p></> },
          { title: '作者', render: (_, item) => item.author.displayName },
          { title: '状态', render: (_, item) => <Tag>{statuses[item.status]}</Tag> },
          { title: '提交时间', render: (_, item) => item.submittedAt ? adminTime(item.submittedAt) : '未提交' },
          { title: '操作', render: (_, item) => <Button onClick={() => { setSelected(item); setNotice(''); }}>
            {item.status === 'PENDING' ? '审核作品' : item.status === 'DELETED' ? '查看作品' : '管理作品'}
          </Button> },
        ]}/>
      <AdminPageSwitch page={page} more={list.data.hasMore} update={setPage}/>
    </>}
    {selected && <ProjectReview key={selected.id + ':' + selected.version} item={selected}
      close={() => setSelected(undefined)} refresh={reloadSelected} done={reviewed}/>}
  </>;
}

function ProjectReview({ item, close, done, refresh }: {
  item: Project;
  close: () => void;
  done: (message: string) => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [conflict, setConflict] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  async function review(status: 'PUBLISHED' | 'REJECTED' | 'UNLISTED' | 'DELETED') {
    setBusy(true);
    setFailure('');
    setConflict(false);
    try {
      await api('/api/admin/projects/' + item.id + '/status', 'PATCH', {
        version: item.version,
        status,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      const notice = status === 'PUBLISHED'
        ? (item.status === 'UNLISTED' ? '作品已重新上架' : '作品已通过审核并发布')
        : status === 'REJECTED' ? '作品已驳回' : status === 'UNLISTED' ? '作品已下架' : '作品已删除';
      await done(notice);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : '处理失败，请重试');
      setConflict(error instanceof HttpError && error.status === 409);
    } finally { setBusy(false); }
  }
  async function loadLatest() {
    setBusy(true);
    setFailure('');
    try { await refresh(); }
    catch (error) { setFailure(error instanceof Error ? error.message : '刷新失败，请重试'); }
    finally { setBusy(false); }
  }
  return <AdminDialog title={item.title} close={close} busy={busy}>
    <p className="meta">{item.author.displayName} · {statuses[item.status]} · {item.viewCount} 浏览 · {item.likeCount} 赞</p>
    <p>{item.summary}</p>
    <p>
      <a href={item.projectUrl} target="_blank" rel="noopener noreferrer">访问作品 ↗</a>
      {item.repositoryUrl && <> · <a href={item.repositoryUrl} target="_blank" rel="noopener noreferrer">查看源码 ↗</a></>}
    </p>
    <Markdown source={item.bodyMarkdown}/>
    {['PENDING', 'PUBLISHED'].includes(item.status) && <>
      <label>处理原因
        <Input.TextArea rows={3} maxLength={1000} value={reason} disabled={busy}
          onChange={event => setReason(event.target.value)}
          placeholder={item.status === 'PENDING' ? '驳回时必填' : '下架时必填'}/>
      </label>
      <div className="editor-actions">
        {item.status === 'PENDING' ? <>
          <Button disabled={busy || !reason.trim()} onClick={() => void review('REJECTED')}>驳回作品</Button>
          <Button type="primary" loading={busy} onClick={() => void review('PUBLISHED')}>审核通过</Button>
        </> : <Button danger disabled={busy || !reason.trim()} onClick={() => void review('UNLISTED')}>下架作品</Button>}
      </div>
    </>}
    {item.status === 'UNLISTED' && <div className="editor-actions">
      <Button type="primary" loading={busy} onClick={() => void review('PUBLISHED')}>上架作品</Button>
    </div>}
    {item.status !== 'DELETED' && <div className="editor-actions">
      {confirmDelete ? <>
        <span>删除后作品将从广场和作者列表移除。</span>
        <Button disabled={busy} onClick={() => setConfirmDelete(false)}>取消删除</Button>
        <Button danger type="primary" loading={busy} onClick={() => void review('DELETED')}>确认删除</Button>
      </> : <Button danger disabled={busy} onClick={() => setConfirmDelete(true)}>删除作品</Button>}
    </div>}
    {failure && <p className="error" role="alert">{failure}</p>}
    {conflict && <Button disabled={busy} onClick={() => void loadLatest()}>加载最新状态</Button>}
  </AdminDialog>;
}
