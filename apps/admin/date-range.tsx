import { useId, useState } from 'react';

export type AdminRange = { from: string; to: string };
export const emptyRange: AdminRange = { from: '', to: '' };

export function appendAdminRange(params: URLSearchParams, range: AdminRange) {
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);
  return params;
}

export function AdminDateRange({ applied, onApply }: { applied: AdminRange; onApply: (range: AdminRange) => void }) {
  const id = useId();
  const [range, setRange] = useState(applied);
  const invalid = !!range.from && !!range.to && range.from > range.to;
  const changed = range.from !== applied.from || range.to !== applied.to;
  return <form className="admin-date-range" aria-label="创建日期筛选" onSubmit={event => {
    event.preventDefault();
    if (!invalid) onApply(range);
  }}>
    <span className="meta">创建日期（北京时间）</span>
    <label htmlFor={id+'-from'}>开始日期<input id={id+'-from'} type="date" value={range.from}
      onChange={event=>setRange({...range,from:event.target.value})}/></label>
    <label htmlFor={id+'-to'}>结束日期<input id={id+'-to'} type="date" value={range.to}
      onChange={event=>setRange({...range,to:event.target.value})}/></label>
    <button className="subtle" type="submit" disabled={invalid||!changed}>按日期筛选</button>
    {(range.from||range.to||applied.from||applied.to)&&<button className="subtle" type="button" onClick={()=>{
      setRange(emptyRange);onApply(emptyRange);
    }}>清除日期</button>}
    {invalid&&<p className="error" role="alert">结束日期不能早于开始日期</p>}
  </form>;
}

const formatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' });
export const adminTime = (value: string) => formatter.format(new Date(value));
