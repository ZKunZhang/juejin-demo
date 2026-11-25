import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../shared/api/api';
import { AppSelect } from '../../../shared/ui/select';
import { ArticleIcon } from '../../../shared/ui/article-icons';
import './bookmark-collections.css';

export type Collection = { id: string | null; name: string };
type CollectionSummary = Collection & { articleCount: number };
export const defaultCollectionKey = 'default';
const endpoint = '/api/me/bookmark-collections';

function useCollections(userId: string) {
  return useQuery({ queryKey: ['bookmark-collections', userId], queryFn: ({ signal }) =>
    api<CollectionSummary[]>(endpoint, 'GET', undefined, signal) });
}

function CreateCollectionForm({ onCreate, busy, setBusy }: {
  onCreate: (collection: Collection) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const client = useQueryClient();

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const collection = await api<Collection>(endpoint, 'POST', { name: name.trim() });
      await client.invalidateQueries({ queryKey: ['bookmark-collections'] });
      onCreate(collection);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '创建合集失败');
    } finally {
      setBusy(false);
    }
  }

  return <form className="editor bookmark-create-form" onSubmit={create}>
    <label>合集名称<input required maxLength={60} value={name} onChange={event => setName(event.target.value)} disabled={busy}/></label>
    {error && <p className="error" role="alert">{error}</p>}
    <button type="submit" className="primary" disabled={busy || !name.trim()}>创建合集</button>
  </form>;
}

export function CollectionList({ userId }: { userId: string }) {
  const query = useCollections(userId);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  return <div className="bookmark-collections">
    <div className="bookmark-collections-heading"><h2>收藏合集</h2>
      <button className="subtle" type="button" aria-expanded={creating} disabled={busy} onClick={() => setCreating(!creating)}>新建合集</button>
    </div>
    {creating && <CreateCollectionForm busy={busy} setBusy={setBusy} onCreate={() => setCreating(false)}/>}
    {query.error && <p className="error" role="alert">{query.error.message} <button className="subtle" onClick={() => void query.refetch()}>重试</button></p>}
    {query.isPending && <p role="status" className="meta">正在加载合集…</p>}
    <ul>{query.data?.map(collection => <li key={collection.id ?? defaultCollectionKey}>
      <Link to={'/me/bookmarks?collection=' + (collection.id ?? defaultCollectionKey)}>
        <span className="bookmark-collection-icon"><ArticleIcon name="bookmark"/></span>
        <span><strong>{collection.name}</strong><span className="meta">{collection.articleCount} 篇文章</span></span>
      </Link>
    </li>)}</ul>
  </div>;
}

export function BookmarkDialog({ userId, bookmarked, collectionId, close, save }: {
  userId: string;
  bookmarked: boolean;
  collectionId: string | null;
  close: () => void;
  save: (active: boolean, collectionId?: string | null) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const query = useCollections(userId);
  const [selection, setSelection] = useState(collectionId ?? defaultCollectionKey);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  async function submit(active: boolean) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await save(active, selection === defaultCollectionKey ? null : selection);
      close();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '收藏操作失败');
    } finally {
      setBusy(false);
    }
  }

  return <dialog ref={dialog} className="surface bookmark-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <div className="bookmark-collections-heading"><h2 id={titleId}>{bookmarked ? '管理收藏' : '收藏文章'}</h2>
      <button type="button" className="subtle" onClick={close} disabled={busy}>关闭</button>
    </div>
    {query.data && <div className="bookmark-picker"><span>选择合集</span>
      <AppSelect label="收藏合集" value={selection} onChange={setSelection} disabled={busy}
        options={query.data.map(collection => ({ value: collection.id ?? defaultCollectionKey, label: collection.name }))}/>
    </div>}
    {query.isPending && <p role="status" className="meta">正在加载合集…</p>}
    {query.error && <p className="error" role="alert">{query.error.message} <button className="subtle" onClick={() => void query.refetch()}>重试</button></p>}
    <button className="subtle" type="button" aria-expanded={creating} disabled={busy} onClick={() => setCreating(!creating)}>新建合集</button>
    {creating && <CreateCollectionForm busy={busy} setBusy={setBusy} onCreate={collection => {
      setSelection(collection.id ?? defaultCollectionKey);
      setCreating(false);
    }}/>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="editor-actions">
      {bookmarked && <button type="button" className="subtle" disabled={busy} onClick={() => void submit(false)}>取消收藏</button>}
      <button type="button" className="primary" disabled={busy || !query.data?.some(item =>
        (item.id ?? defaultCollectionKey) === selection)} onClick={() => void submit(true)}>保存到合集</button>
    </div>
  </dialog>;
}
