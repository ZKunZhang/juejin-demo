import { useEffect, useId, useRef, type ReactNode } from 'react';

export function AdminDialog({ title, children, close, busy = false }: {
  title: string; children: ReactNode; close: () => void; busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog className="admin admin-dialog" ref={dialog} aria-labelledby={titleId} onCancel={event => {
    event.preventDefault();
    if (!busy) close();
  }}>
    <div className="admin-dialog-heading">
      <h2 id={titleId}>{title}</h2>
      <button className="subtle" type="button" disabled={busy} onClick={close} autoFocus>关闭</button>
    </div>
    {children}
  </dialog>;
}
