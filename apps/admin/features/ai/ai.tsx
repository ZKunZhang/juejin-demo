import { useState, type FormEvent } from 'react';
import dayjs from 'dayjs';
import { Button, DatePicker, Input, Select } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../shared/api/api';
import { Pending } from '../../../shared/ui/pending';
import './ai.css';

type Option = { id: string; name: string };
type Options = { providers: (Option & { slug: string })[]; models: Option[]; tools: Option[] };
type Price = {
  model: Option & { modelKey: string }; provider: Option & { slug: string };
  currency: string; inputPrice: string; outputPrice: string; cacheReadPrice: string | null; cacheWritePrice: string | null;
  effectiveFrom: string; sourceUrl: string;
};
type Kind = 'provider' | 'model' | 'tool';
const errors = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试';
const decimalPattern = '^\\d+(\\.\\d{1,8})?$';

export function AdminAi() {
  const client = useQueryClient();
  const options = useQuery({ queryKey: ['admin-ai-options'], queryFn: ({ signal }) => api<Options>('/api/ai/options', 'GET', undefined, signal) });
  const prices = useQuery({ queryKey: ['admin-ai-prices'], queryFn: ({ signal }) => api<{ items: Price[] }>('/api/ai/prices', 'GET', undefined, signal) });
  const [kind, setKind] = useState<Kind>('provider');
  const [providerId, setProviderId] = useState('');
  const [modelId, setModelId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState<string | null>(null);
  const [effectiveTo, setEffectiveTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function save(operation: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try {
      await operation();
      await Promise.all([
        client.invalidateQueries({ queryKey: ['admin-ai-options'] }),
        client.invalidateQueries({ queryKey: ['admin-ai-prices'] }),
      ]);
    } catch (error) { setError(errors(error)); }
    finally { setBusy(false); }
  }
  function createCatalog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    void save(async () => {
      const name = String(fields.get('name') || '').trim();
      await api('/api/admin/ai/catalog', 'POST', kind === 'model'
        ? { kind, name, providerId, modelKey: String(fields.get('modelKey') || '').trim() }
        : { kind, name, slug: String(fields.get('slug') || '').trim() });
      form.reset(); setNotice('目录项已保存');
    });
  }
  function createPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    void save(async () => {
      await api('/api/admin/ai/prices', 'POST', {
        modelId, currency: String(fields.get('currency') || '').trim().toUpperCase(), effectiveFrom, effectiveTo,
        inputPrice: String(fields.get('inputPrice') || '').trim(), outputPrice: String(fields.get('outputPrice') || '').trim(),
        cacheReadPrice: String(fields.get('cacheReadPrice') || '').trim() || null,
        cacheWritePrice: String(fields.get('cacheWritePrice') || '').trim() || null,
        sourceUrl: String(fields.get('sourceUrl') || '').trim(),
      });
      form.reset(); setEffectiveFrom(null); setEffectiveTo(null); setNotice('价格记录已保存');
    });
  }
  return <div className="admin-ai"><h1>AI 用量配置</h1>
    <p className="meta">维护供应商、工具、模型与带生效区间的历史价格。</p>
    {notice && <p className="admin-ai-feedback" role="status">{notice}</p>}
    {error && <p className="error admin-ai-feedback" role="alert">{error}</p>}
    {!options.data ? <Pending error={options.error} retry={() => void options.refetch()}/> : <div className="admin-ai-forms">
      <section><h2>新增目录项</h2><form key={kind} onSubmit={createCatalog}>
        <label htmlFor="ai-catalog-kind">类型</label><Select id="ai-catalog-kind" aria-label="目录类型" value={kind} disabled={busy} onChange={setKind} options={[
          { value: 'provider', label: '供应商' }, { value: 'model', label: '模型' }, { value: 'tool', label: '工具' },
        ]}/>
        <label htmlFor="ai-catalog-name">名称</label><Input id="ai-catalog-name" name="name" required maxLength={kind === 'model' ? 160 : 120} disabled={busy}/>
        {kind === 'model' ? <>
          <label htmlFor="ai-catalog-provider">供应商</label><Select id="ai-catalog-provider" aria-label="模型供应商" value={providerId || undefined} placeholder="选择供应商" disabled={busy} onChange={setProviderId} options={options.data.providers.map(item => ({ value: item.id, label: item.name }))}/>
          <label htmlFor="ai-catalog-key">模型标识</label><Input id="ai-catalog-key" name="modelKey" required maxLength={160} disabled={busy} placeholder="供应商的模型标识"/>
        </> : <><label htmlFor="ai-catalog-slug">唯一标识</label><Input id="ai-catalog-slug" name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={64} disabled={busy} placeholder="小写字母、数字或连字符"/></>}
        <Button htmlType="submit" type="primary" loading={busy} disabled={kind === 'model' && !providerId}>保存目录项</Button>
      </form>
      <details className="admin-ai-directory"><summary>查看现有目录</summary>
        {([['供应商', options.data.providers], ['模型', options.data.models], ['工具', options.data.tools]] as const).map(([title, items]) => <div key={title}><h3>{title}</h3>{items.length ? <ul>{items.map(item => <li key={item.id}>{item.name}</li>)}</ul> : <p className="meta">暂无记录</p>}</div>)}
      </details></section>
      <section><h2>新增价格记录</h2><p className="meta">单价单位为每百万 Token。结束时间留空表示持续生效。</p><form onSubmit={createPrice}>
        <label htmlFor="ai-price-model">模型</label><Select id="ai-price-model" aria-label="计价模型" value={modelId || undefined} placeholder="选择模型" disabled={busy} onChange={setModelId} options={options.data.models.map(item => ({ value: item.id, label: item.name }))}/>
        <label htmlFor="ai-price-currency">币种</label><Input id="ai-price-currency" name="currency" required pattern="[A-Za-z]{3}" maxLength={3} defaultValue="USD" disabled={busy}/>
        <div className="admin-ai-price-pair"><div><label htmlFor="ai-price-input">输入单价</label><Input id="ai-price-input" name="inputPrice" inputMode="decimal" required maxLength={21} pattern={decimalPattern} disabled={busy}/></div>
          <div><label htmlFor="ai-price-output">输出单价</label><Input id="ai-price-output" name="outputPrice" inputMode="decimal" required maxLength={21} pattern={decimalPattern} disabled={busy}/></div></div>
        <div className="admin-ai-price-pair"><div><label htmlFor="ai-price-read">缓存读单价</label><Input id="ai-price-read" name="cacheReadPrice" inputMode="decimal" maxLength={21} pattern={decimalPattern} placeholder="未提供可留空" disabled={busy}/></div>
          <div><label htmlFor="ai-price-write">缓存写单价</label><Input id="ai-price-write" name="cacheWritePrice" inputMode="decimal" maxLength={21} pattern={decimalPattern} placeholder="未提供可留空" disabled={busy}/></div></div>
        <label htmlFor="ai-price-from">生效时间</label><DatePicker id="ai-price-from" aria-label="生效时间" showTime format="YYYY-MM-DD HH:mm:ss" value={effectiveFrom ? dayjs(effectiveFrom) : null} disabled={busy} onChange={value => setEffectiveFrom(value?.toISOString() ?? null)} needConfirm={false}/>
        {effectiveFrom && <p className="meta">已选 {new Date(effectiveFrom).toLocaleString('zh-CN')}</p>}
        <label htmlFor="ai-price-to">结束时间</label><DatePicker id="ai-price-to" aria-label="结束时间" showTime format="YYYY-MM-DD HH:mm:ss" value={effectiveTo ? dayjs(effectiveTo) : null} disabled={busy} onChange={value => setEffectiveTo(value?.toISOString() ?? null)} needConfirm={false}/>
        <label htmlFor="ai-price-source">价格来源</label><Input id="ai-price-source" type="url" name="sourceUrl" required maxLength={2000} disabled={busy} placeholder="https://"/>
        <Button htmlType="submit" type="primary" loading={busy} disabled={!modelId || !effectiveFrom || (!!effectiveTo && !!effectiveFrom && effectiveTo <= effectiveFrom)}>保存价格</Button>
      </form></section>
    </div>}
    <section className="admin-ai-current"><h2>当前有效价格</h2>
      {!prices.data ? <Pending error={prices.error} retry={() => void prices.refetch()}/> : !prices.data.items.length ? <p className="meta">暂无有效价格。</p> : <div className="admin-list-scroll"><table className="admin-table" aria-label="当前 AI 价格"><thead><tr><th scope="col">模型 / 供应商</th><th scope="col">输入 / 输出</th><th scope="col">缓存读 / 写</th><th scope="col">生效时间</th></tr></thead><tbody>
        {prices.data.items.map(price => <tr key={price.model.id + price.currency}><td><strong>{price.model.name}</strong><p className="meta">{price.provider.name} · {price.model.modelKey}</p></td><td>{price.inputPrice} / {price.outputPrice} {price.currency}</td><td>{price.cacheReadPrice ?? '未提供'} / {price.cacheWritePrice ?? '未提供'}</td><td>{new Date(price.effectiveFrom).toLocaleString('zh-CN')}<p><a href={price.sourceUrl} target="_blank" rel="noopener noreferrer">价格来源</a></p></td></tr>)}
      </tbody></table></div>}
    </section>
  </div>;
}
