import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../../../shared/api/api';
import { useSession } from '../../../shared/auth/session';
import { Pending } from '../../../shared/ui/pending';
import { AppSelect } from '../../../shared/ui/select';
import './ai.css';

type Option = { id: string; name: string };
type Options = { tools: Option[]; models: Option[]; providers: (Option & { slug: string })[] };
type Distribution = { id?: string; name: string; totalTokens: string; estimatedCostUsd: string | null };
type Usage = {
  totalTokens: string; inputTokens: string; outputTokens: string; estimatedCostUsd: string | null;
  daily: DailyUsage[];
  heatmap?: DailyUsage[];
  hourly?: { hour: string; totalTokens: string; estimatedCostUsd: string | null }[];
  tools: Distribution[]; models: Distribution[]; publicLeaderboard: boolean;
};
type DailyUsage = { date: string; totalTokens: string; estimatedCostUsd: string | null };
type Source = { id: string; label: string; tool: Option; revokedAt: string | null };
type Rank = { userId: string; displayName: string; avatarUrl: string | null; totalTokens: string; estimatedCostUsd: string | null };
type Price = {
  model: Option & { modelKey: string }; provider: Option & { slug: string };
  inputPrice: string; outputPrice: string; cacheReadPrice: string | null; cacheWritePrice: string | null;
  currency: string; effectiveFrom: string; sourceUrl: string;
};
const periods = [{ value: 'today', label: '今天' }, { value: '7d', label: '近 7 天' }, { value: '30d', label: '近 30 天' }, { value: '90d', label: '近 90 天' }] as const;
const rankingPeriods = [{ value: 'today', label: '今天' }, { value: 'week', label: '本周' }, { value: 'month', label: '本月' }, { value: 'all', label: '全部' }] as const;
const count = (value: string) => new Intl.NumberFormat('zh-CN').format(BigInt(value));
function money(value: string | null) {
  if (value === null) return '待估算';
  const [whole, fraction = ''] = value.split('.');
  return '$' + whole + '.' + fraction.replace(/0+$/, '').padEnd(2, '0');
}
const failure = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试';

export function AiUsage({ view = 'usage' }: { view?: 'usage' | 'leaderboard' | 'prices' }) {
  return <main className="ai-page">
    <header className="ai-heading"><h1>AI 用量</h1>
      <nav aria-label="AI 用量导航" className="ai-tabs">
        <NavLink to="/ai-usage" end>用量</NavLink>
        <NavLink to="/ai-usage/leaderboard">排行榜</NavLink>
        <NavLink to="/ai-usage/prices">模型价格</NavLink>
      </nav>
    </header>
    {view === 'usage' ? <PersonalUsage/> : view === 'leaderboard' ? <UsageLeaderboard/> : <ModelPrices/>}
  </main>;
}

function PersonalUsage() {
  const { user, loading, error, retry } = useSession();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const period = periods.find(item => item.value === params.get('period')) ?? periods[0];
  const query = useQuery({
    queryKey: ['ai-usage', user?.id, period.value], enabled: !!user,
    queryFn: ({ signal }) => api<Usage>('/api/me/ai/usage?period=' + period.value, 'GET', undefined, signal),
  });
  const options = useQuery({ queryKey: ['ai-options'], enabled: !!user, queryFn: ({ signal }) => api<Options>('/api/ai/options', 'GET', undefined, signal) });
  if (loading || error) return <section className="surface ai-panel"><Pending error={error} retry={retry}/></section>;
  if (!user) return <section className="surface ai-panel ai-empty"><h2>查看个人用量</h2><p>登录后管理用量来源、导入记录和查看统计。</p>
    <Link className="primary" to={'/login?next=' + encodeURIComponent(location.pathname + location.search)} state={{ background: location }}>登录</Link></section>;
  return <>
    <div className="ai-overview-tools"><div className="ai-periods" role="group" aria-label="统计周期">
      {periods.map(item => <button key={item.value} aria-pressed={item.value === period.value}
        onClick={() => setParams(item.value === 'today' ? {} : { period: item.value })}>{item.label}</button>)}
    </div><a className="ai-import-link" href="#usage-sources">导入用量</a></div>
    {!query.data ? <section className="surface ai-panel"><Pending error={query.error} retry={() => void query.refetch()}/></section> : <>
      <p className="ai-caption">按北京时间统计 · {period.label}</p>
      <dl className="ai-metrics">
        {[['预估费用', money(query.data.estimatedCostUsd)], ['总 Token', count(query.data.totalTokens)], ['输入 Token', count(query.data.inputTokens)], ['输出 Token', count(query.data.outputTokens)]].map(([label, value]) => <div className="surface" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {query.data.estimatedCostUsd === null && <p className="ai-caption">部分记录缺少适用价格，费用暂无法完整估算。</p>}
      <UsageHeatmap days={query.data.heatmap ?? query.data.daily}/>
      <div className="ai-dash-grid">
        <UsagePanel title="每日用量" items={query.data.daily.map(day => ({ name: day.date, totalTokens: day.totalTokens, estimatedCostUsd: day.estimatedCostUsd }))}/>
        {query.data.hourly && <UsagePanel title="小时用量" items={query.data.hourly.map(hour => ({ name: hour.hour, totalTokens: hour.totalTokens, estimatedCostUsd: hour.estimatedCostUsd }))}/>}
        <UsagePanel title="工具分布" items={query.data.tools}/>
        <UsagePanel title="模型分布" items={query.data.models}/>
      </div>
      <LeaderboardPreference selected={query.data.publicLeaderboard} userId={user.id}/>
    </>}
    <UsageSources userId={user.id} options={options.data} optionsError={options.error} retryOptions={() => void options.refetch()}/>
  </>;
}

const dayMs = 86_400_000;
const localCalendar = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });

function UsageHeatmap({ days }: { days: DailyUsage[] }) {
  const amounts = new Map(days.map(day => [day.date, BigInt(day.totalTokens)]));
  const maximum = days.reduce((max, day) => BigInt(day.totalTokens) > max ? BigInt(day.totalTokens) : max, 0n);
  const end = new Date(localCalendar.format(new Date()) + 'T00:00:00Z');
  const start = new Date(end.getTime() - 364 * dayMs);
  const firstWeekDay = start.getUTCDay();
  const cells = Array.from({length:365}, (_, index) => {
    const date = new Date(start.getTime() + index * dayMs);
    const key = date.toISOString().slice(0,10);
    const value = amounts.get(key) ?? 0n;
    const offset = index + firstWeekDay;
    return { key, value, date, column: Math.floor(offset / 7) + 2, weekday: offset % 7 };
  });
  return <section className="surface ai-panel ai-heatmap">
    <div className="ai-panel-heading"><h2>用量热力图</h2><span>最近 365 天</span></div>
    <div className="ai-heatmap-scroll" tabIndex={0} aria-label="滚动查看每日用量热力图">
      <div className="ai-heatmap-grid" role="img" aria-label={`最近 365 天，其中 ${cells.filter(cell => cell.value > 0n).length} 天记录了 Token 用量`}>
        {['日','一','二','三','四','五','六'].map((day,index)=><span key={day} className="ai-heatmap-label" style={{gridColumn:1,gridRow:index+2}}>{day}</span>)}
        {cells.map(cell=>{
          const level = cell.value && maximum ? Number(1n + cell.value * 3n / maximum) : 0;
          return <div key={cell.key} className="ai-heatmap-cell" data-level={level} title={`${cell.key} · ${count(cell.value.toString())} Token`}
            style={{gridColumn:cell.column,gridRow:cell.weekday+2}}/>;
        })}
        {cells.filter(cell=>cell.date.getUTCDate()===1).map(cell=><span key={'month-'+cell.key} className="ai-heatmap-month"
          style={{gridColumn:cell.column,gridRow:1}}>{cell.date.getUTCMonth()+1} 月</span>)}
      </div>
    </div>
    <div className="ai-heatmap-footer"><span>UTC+08:00</span><div aria-hidden="true">少 {[0,1,2,3,4].map(level=><i key={level} className="ai-heatmap-cell" data-level={level}/>)} 多</div></div>
  </section>;
}

function UsagePanel({ title, items }: { title: string; items: Distribution[] }) {
  const [byCost, setByCost] = useState(false);
  const costUnits = (value: string | null) => {
    const [whole, fraction = ''] = (value ?? '0').split('.');
    return BigInt(whole + fraction.padEnd(10, '0'));
  };
  const measure = (item: Distribution) => byCost ? costUnits(item.estimatedCostUsd) : BigInt(item.totalTokens);
  const maximum = items.reduce((max, item) => measure(item) > max ? measure(item) : max, 0n);
  return <section className="surface ai-panel ai-chart">
    <div className="ai-panel-heading"><h2>{title}</h2>
      <div className="ai-periods" role="group" aria-label={title+'指标'}>
        <button type="button" aria-pressed={!byCost} onClick={()=>setByCost(false)}>Token</button>
        <button type="button" aria-pressed={byCost} onClick={()=>setByCost(true)}>费用</button>
      </div>
    </div>
    {items.length ? <ul className="ai-bars">{items.map((item, index) => <li key={item.id ?? item.name + index}>
      <div><span>{item.name}</span><strong>{byCost ? money(item.estimatedCostUsd) : count(item.totalTokens)+' Token'}</strong></div>
      <span className="ai-bar-track" aria-hidden="true"><span style={{ width: (maximum ? Number(measure(item) * 1000n / maximum) / 10 : 0) + '%' }}/></span>
    </li>)}</ul> : <p className="ai-empty">当前范围暂无用量记录</p>}
  </section>;
}

function LeaderboardPreference({ selected, userId }: { selected: boolean; userId: string }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function update() {
    setBusy(true); setError('');
    try {
      await api('/api/me/ai/preferences', 'PUT', { publicLeaderboard: !selected });
      await Promise.all([client.invalidateQueries({ queryKey: ['ai-usage', userId] }), client.invalidateQueries({ queryKey: ['ai-leaderboard'] })]);
    } catch (error) { setError(failure(error)); }
    finally { setBusy(false); }
  }
  return <section className="surface ai-panel ai-preferences"><div><h2>公开排行</h2><p>开启后，其他人可在排行榜看到你的昵称、用量及已知费用。</p></div>
    <button className="subtle" aria-pressed={selected} disabled={busy} onClick={() => void update()}>{selected ? '退出公开排行' : '加入公开排行'}</button>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

function UsageSources({ userId, options, optionsError, retryOptions }: { userId: string; options?: Options; optionsError: Error | null; retryOptions: () => void }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['ai-sources', userId], queryFn: ({ signal }) => api<{ items: Source[] }>('/api/me/ai/sources', 'GET', undefined, signal) });
  const [toolId, setToolId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [payload, setPayload] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function mutate(operation: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); }
    catch (error) { setError(failure(error)); }
    finally { setBusy(false); }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const label = String(new FormData(form).get('label') || '').trim();
    await mutate(async () => {
      await api('/api/me/ai/sources', 'POST', { toolId, label });
      await client.invalidateQueries({ queryKey: ['ai-sources', userId] });
      form.reset(); setNotice('用量来源已创建');
    });
  }
  async function importEvents(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutate(async () => {
      let events: unknown;
      try { events = JSON.parse(payload); } catch { throw new Error('请输入有效的 JSON 数组'); }
      if (!Array.isArray(events)) throw new Error('用量记录需要是 JSON 数组');
      if (!events.length || events.length > 100) throw new Error('每次可导入 1 至 100 条记录');
      const result = await api<{ inserted: number; duplicates: number }>('/api/me/ai/events', 'POST', { sourceId, events });
      await Promise.all([client.invalidateQueries({ queryKey: ['ai-usage', userId] }), client.invalidateQueries({ queryKey: ['ai-leaderboard'] })]);
      setPayload(''); setNotice('已导入 ' + result.inserted + ' 条，重复 ' + result.duplicates + ' 条');
    });
  }
  const active = query.data?.items.filter(item => !item.revokedAt) ?? [];
  return <section className="surface ai-panel ai-source-panel" id="usage-sources"><h2>用量来源与导入</h2>
    {!options ? <Pending error={optionsError} retry={retryOptions}/> : <form className="ai-source-create" onSubmit={event => void create(event)}>
      <label>来源名称<input name="label" required maxLength={120} placeholder="例如：工作电脑" disabled={busy}/></label>
      <label>工具<AppSelect label="来源工具" value={toolId || undefined} placeholder="选择工具" disabled={busy} options={options.tools.map(tool => ({ value: tool.id, label: tool.name }))} onChange={setToolId}/></label>
      <button className="subtle" disabled={busy || !toolId || !options.tools.length}>创建来源</button>
      {!options.tools.length && <p className="ai-caption">管理员添加工具后即可创建来源。</p>}
    </form>}
    {!query.data ? <Pending error={query.error} retry={() => void query.refetch()}/> : query.data.items.length ? <ul className="ai-source-list">
      {query.data.items.map(source => <li key={source.id}><span><strong>{source.label}</strong> · {source.tool.name}</span>
        {source.revokedAt ? <span className="ai-caption">已停用</span> : <button className="subtle" disabled={busy} onClick={() => void mutate(async () => {
          await api('/api/me/ai/sources/' + source.id, 'DELETE');
          if (sourceId === source.id) setSourceId('');
          await client.invalidateQueries({ queryKey: ['ai-sources', userId] });
          setNotice('用量来源已停用');
        })}>停用来源</button>}
      </li>)}
    </ul> : <p className="ai-caption">还没有用量来源。</p>}
    {!!active.length && <form className="ai-import" onSubmit={event => void importEvents(event)}>
      <label>导入来源<AppSelect label="导入来源" disabled={busy} value={sourceId || undefined} placeholder="选择来源" options={active.map(source => ({ value: source.id, label: source.label }))} onChange={setSourceId}/></label>
      <label htmlFor="ai-events">用量记录 JSON</label>
      <textarea id="ai-events" rows={8} value={payload} maxLength={180000} required disabled={busy} spellCheck={false} onChange={event => setPayload(event.target.value)} placeholder="粘贴用量记录数组"/>
      <details><summary>查看导入字段</summary><p className="ai-caption">每次导入 1 至 100 条。每条记录需要来源内唯一的 sourceEventKey、模型 ID、含时区的 occurredAt，以及下列十进制字符串计数。普通输入、未拆分输入和缓存输入分别计数。</p>
        <pre>{JSON.stringify([{ sourceEventKey: 'event-001', modelId: '模型 ID', occurredAt: new Date().toISOString(), inputTokens: '1000', unclassifiedInputTokens: '0', outputTokens: '200', cacheReadTokens: '0', cacheWriteTokens: '0' }], null, 2)}</pre>
        {options && <ul className="ai-model-ids">{options.models.map(model => <li key={model.id}>{model.name} <code>{model.id}</code></li>)}</ul>}
      </details>
      <button className="primary" disabled={busy || !sourceId || !payload.trim()}>导入用量</button>
    </form>}
    {notice && <p role="status">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}
  </section>;
}

function UsageLeaderboard() {
  const [params, setParams] = useSearchParams();
  const { user } = useSession();
  const period = rankingPeriods.find(item => item.value === params.get('period')) ?? rankingPeriods[0];
  const sort = params.get('sort') === 'cost' ? 'cost' : 'tokens';
  const queryString = new URLSearchParams({ period: period.value, sort });
  for (const name of ['toolId', 'modelId', 'hideSelf']) if (params.get(name)) queryString.set(name, params.get(name)!);
  const query = useQuery({ queryKey: ['ai-leaderboard', queryString.toString(), user?.id], queryFn: ({ signal }) => api<{ items: Rank[] }>('/api/ai/leaderboard?' + queryString, 'GET', undefined, signal) });
  const options = useQuery({ queryKey: ['ai-options'], queryFn: ({ signal }) => api<Options>('/api/ai/options', 'GET', undefined, signal) });
  function change(name: string, value: string) { const next = new URLSearchParams(params); if (value) next.set(name, value); else next.delete(name); setParams(next); }
  return <>
    <div className="ai-periods" role="group" aria-label="排行周期">{rankingPeriods.map(item => <button key={item.value} aria-pressed={item.value === period.value} onClick={() => change('period', item.value)}>{item.label}</button>)}</div>
    <section className="surface ai-panel"><div className="ai-ranking-heading"><h2>用户排行榜</h2><div className="ai-periods" role="group" aria-label="排行方式"><button aria-pressed={sort === 'tokens'} onClick={() => change('sort', 'tokens')}>按 Token</button><button aria-pressed={sort === 'cost'} onClick={() => change('sort', 'cost')}>按费用</button></div></div>
      <div className="ai-ranking-filters">
        <AppSelect label="排行工具" value={params.get('toolId') || ''} options={[{ value: '', label: '全部工具' }, ...(options.data?.tools ?? []).map(item => ({ value: item.id, label: item.name }))]} onChange={value => change('toolId', value)}/>
        <AppSelect label="排行模型" value={params.get('modelId') || ''} options={[{ value: '', label: '全部模型' }, ...(options.data?.models ?? []).map(item => ({ value: item.id, label: item.name }))]} onChange={value => change('modelId', value)}/>
        {user && <label className="ai-checkbox"><input type="checkbox" checked={params.get('hideSelf') === 'true'} onChange={event => change('hideSelf', event.target.checked ? 'true' : '')}/>隐藏自己</label>}
      </div>
      {options.error && <p className="error" role="alert">筛选项加载失败 <button className="subtle" onClick={() => void options.refetch()}>重试</button></p>}
      {!query.data ? <Pending error={query.error} retry={() => void query.refetch()}/> : !query.data.items.length ? <p className="ai-empty">当前范围暂无公开排行记录</p> : <div className="ai-table-scroll"><table className="ai-table" aria-label="公开用量排行"><thead><tr><th scope="col">排名</th><th scope="col">用户</th><th scope="col">总 Token</th><th scope="col">预估费用</th></tr></thead><tbody>
        {query.data.items.map((item, index) => <tr key={item.userId}><td><span className="ai-rank" data-top={index < 3}>{index + 1}</span></td><td><span className="ai-ranked-user">{item.avatarUrl && <img src={item.avatarUrl} alt=""/>}<strong>{item.displayName}</strong></span></td><td>{count(item.totalTokens)}</td><td>{money(item.estimatedCostUsd)}</td></tr>)}
      </tbody></table></div>}
      <p className="ai-caption">仅包含主动公开排行的有效账号。费用排行仅计入费用覆盖完整的记录汇总。</p>
    </section>
  </>;
}

function ModelPrices() {
  const [params, setParams] = useSearchParams();
  const appliedKeyword = params.get('q') || '';
  const [keyword, setKeyword] = useState(appliedKeyword);
  useEffect(() => setKeyword(appliedKeyword), [appliedKeyword]);
  const provider = params.get('provider') || '';
  const queryString = new URLSearchParams();
  if (params.get('q')) queryString.set('q', params.get('q')!);
  if (provider) queryString.set('provider', provider);
  const query = useQuery({ queryKey: ['ai-prices', queryString.toString()], queryFn: ({ signal }) => api<{ items: Price[] }>('/api/ai/prices?' + queryString, 'GET', undefined, signal) });
  const options = useQuery({ queryKey: ['ai-options'], queryFn: ({ signal }) => api<Options>('/api/ai/options', 'GET', undefined, signal) });
  return <section className="surface ai-panel"><h2>模型价格</h2>
    <form className="ai-price-search" onSubmit={event => { event.preventDefault(); const next = new URLSearchParams(params); if (keyword.trim()) next.set('q', keyword.trim()); else next.delete('q'); setParams(next); }}>
      <label className="ai-price-keyword">搜索模型<input aria-label="搜索模型" value={keyword} maxLength={100} placeholder="模型名称或标识" onChange={event => setKeyword(event.target.value)}/></label>
      <AppSelect label="模型供应商" value={provider} options={[{ value: '', label: '全部供应商' }, ...(options.data?.providers ?? []).map(item => ({ value: item.id, label: item.name }))]} onChange={value => { const next = new URLSearchParams(params); if (value) next.set('provider', value); else next.delete('provider'); setParams(next); }}/>
      <button className="subtle">查询</button>
    </form>
    {options.error && <p className="error" role="alert">供应商加载失败 <button className="subtle" onClick={() => void options.refetch()}>重试</button></p>}
    <p className="ai-caption">每百万 Token 单价。以来源与价格生效时间为准。</p>
    {!query.data ? <Pending error={query.error} retry={() => void query.refetch()}/> : !query.data.items.length ? <p className="ai-empty">暂无符合条件的有效价格</p> : <div className="ai-table-scroll"><table className="ai-table ai-price-table" aria-label="模型价格列表"><thead><tr><th scope="col">模型</th><th scope="col">输入 / 输出</th><th scope="col">缓存</th><th scope="col">生效时间与来源</th></tr></thead><tbody>
      {query.data.items.map(price => <tr key={price.model.id + price.currency}><td><strong>{price.model.name}</strong><small>{price.provider.name} · {price.model.modelKey}</small></td><td>输入 {price.inputPrice} {price.currency}<small>输出 {price.outputPrice} {price.currency}</small></td><td>缓存读 {price.cacheReadPrice ?? '未提供'}<small>缓存写 {price.cacheWritePrice ?? '未提供'}</small></td><td><time dateTime={price.effectiveFrom}>{new Date(price.effectiveFrom).toLocaleDateString('zh-CN')}</time><small><a href={price.sourceUrl} target="_blank" rel="noopener noreferrer">查看价格来源</a></small></td></tr>)}
    </tbody></table></div>}
  </section>;
}
