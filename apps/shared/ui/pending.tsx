export function Pending({error,retry}: {error:Error|null;retry:()=>void}) {
  return error ? <p className="error work-message" role="alert">{error.message} <button className="subtle" onClick={retry}>重试</button></p> : <p className="work-message meta" role="status">加载中…</p>;
}
