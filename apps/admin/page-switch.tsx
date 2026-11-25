import { Button, Space } from 'antd';

export function AdminPageSwitch({ page, more, update }: { page: number; more: boolean; update: (page: number) => void }) {
  return <nav className="editor-actions" aria-label="列表分页">
    <Space wrap>
      <Button disabled={page === 1} onClick={() => update(page - 1)}>上一页</Button>
      <span aria-current="page">第 {page} 页</span>
      <Button disabled={!more} onClick={() => update(page + 1)}>下一页</Button>
    </Space>
  </nav>;
}
