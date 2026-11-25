import { Link, NavLink, useSearchParams } from 'react-router-dom';
import './expansion-pages.css';

const periods = [
  { value: 'today', label: '今天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: '90d', label: '近 90 天' },
] as const;

export function AiUsage({ view = 'usage' }: { view?: 'usage' | 'leaderboard' | 'prices' }) {
  const [params, setParams] = useSearchParams();
  const period = periods.find(option => option.value === params.get('period')) ?? periods[0];
  return <main className="expansion-page ai-workspace">
    <header className="expansion-heading">
      <h1>AI 用量</h1>
      <nav aria-label="AI 用量导航" className="expansion-tabs">
        <NavLink to="/ai-usage" end>用量</NavLink>
        <NavLink to="/ai-usage/leaderboard">排行榜</NavLink>
        <NavLink to="/ai-usage/prices">模型价格</NavLink>
      </nav>
    </header>
    {view === 'usage' ? <>
      <div className="expansion-periods" role="group" aria-label="统计周期">
        {periods.map(option => <button key={option.value} aria-pressed={option.value === period.value}
          onClick={() => setParams(option.value === 'today' ? {} : { period: option.value })}>{option.label}</button>)}
      </div>
      <p className="expansion-notice" role="status">查看范围：{period.label}。用量数据源待接入，当前无法统计。</p>
      <dl className="usage-metrics">
        {['预估费用', '总 Token', '输入 Token', '输出 Token'].map(label => <div className="surface" key={label}>
          <dt>{label}</dt><dd aria-label="暂无数据">—</dd>
        </div>)}
      </dl>
      <div className="usage-panels">
        <section className="surface"><h2>用量趋势</h2><p>接入用量记录后按时间展示。</p></section>
        <section className="surface"><h2>工具与模型分布</h2><p>接入用量记录后按工具和模型汇总。</p></section>
      </div>
    </> : view === 'leaderboard' ? <section className="surface expansion-state">
      <h2>用户排行榜</h2><p>接入用量记录后，仅展示主动选择公开排名的用户。</p>
    </section> : <section className="surface expansion-state">
      <h2>模型价格</h2><p>价格数据源待接入。接入后将按供应商展示每百万 Token 的价格及生效时间。</p>
    </section>}
  </main>;
}

export function ProjectShowcase() {
  return <main className="expansion-page">
    <header className="project-intro">
      <h1>作品广场</h1>
      <p>发现开发者做出来的项目，看看他们解决了什么问题。</p>
    </header>
    <section className="surface expansion-state">
      <h2>社区作品</h2><p>作品发布与审核功能待接入。</p>
      <Link to="/pulses">浏览社区沸点</Link>
    </section>
  </main>;
}

export function ExpertAnnotation() {
  return <main className="expansion-page">
    <header className="expansion-heading"><h1>专家标注</h1></header>
    <section className="surface expansion-state">
      <p>专家标注入口已预留，任务发布和标注流程待确定。</p>
      <Link to="/">返回社区首页</Link>
    </section>
  </main>;
}
