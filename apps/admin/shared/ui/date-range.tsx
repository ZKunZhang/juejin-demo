import { DatePicker } from 'antd';
import dayjs from 'dayjs';
import { useId } from 'react';

export type AdminRange = { from: string; to: string };
export const emptyRange: AdminRange = { from: '', to: '' };

export function appendAdminRange(params: URLSearchParams, range: AdminRange) {
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);
  return params;
}

export function AdminDateRange({ applied, onApply, label = '创建日期（北京时间）' }: {
  applied: AdminRange;
  onApply: (range: AdminRange) => void;
  label?: string;
}) {
  const id = useId();
  return <div className="admin-date-range" role="group" aria-label="创建日期筛选">
    <span className="meta">{label}</span>
    <label className="admin-date-label" htmlFor={id+'-from'}>开始日期</label>
    <label className="admin-date-label" htmlFor={id+'-to'}>结束日期</label>
    <DatePicker.RangePicker
      id={{ start: id+'-from', end: id+'-to' }}
      placeholder={['开始日期', '结束日期']}
      format="YYYY-MM-DD"
      allowEmpty={[true, true]}
      allowClear={{ label: "清除日期" }}
      value={[applied.from ? dayjs(applied.from) : null, applied.to ? dayjs(applied.to) : null]}
      onChange={(_, dates) => onApply(dates ? { from: dates[0] ?? '', to: dates[1] ?? '' } : emptyRange)}
    />
  </div>;
}

const formatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' });
export const adminTime = (value: string) => formatter.format(new Date(value));
