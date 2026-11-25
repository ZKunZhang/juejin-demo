import { useEffect } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import './download.css';

const sections = [
  { title: '阅读技术文章', detail: '按标签浏览，也可以搜索感兴趣的问题。', to: '/' },
  { title: '参与社区讨论', detail: '在沸点分享开发进展，和其他开发者交流。', to: '/pulses' },
  { title: '继续学习课程', detail: '查看小册介绍、课程目录和开放章节。', to: '/courses' },
] as const;

export function DownloadPage() {
  const [params, setParams] = useSearchParams();
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === '#feature') document.getElementById('feature')?.scrollIntoView({ block:'start' });
  }, [hash]);
  const app = params.get('tab') === 'app';
  return <main className="download-page">
    <div className="download-heading">
      <h1>码栈客户端</h1>
      <nav aria-label="客户端帮助"><a href="#capabilities">功能介绍</a><a href="#questions">常见问题</a></nav>
    </div>
    <section className="download-hero" id="feature" aria-labelledby="download-title">
      <div>
        <div className="download-tabs" role="group" aria-label="客户端类型">
          <button type="button" aria-pressed={app} onClick={()=>setParams({tab:'app'},{preventScrollReset:true})}>APP</button>
          <button type="button" aria-pressed={!app} onClick={()=>setParams({},{preventScrollReset:true})}>浏览器插件</button>
        </div>
        <h2 id="download-title">{app ? '随时打开码栈' : '在浏览器里开始探索'}</h2>
        <p>{app ? '在手机上阅读文章、逛沸点、继续学习小册。' : '从码栈出发，找技术文章、社区讨论和实用课程。'}</p>
        <div className="download-actions">
          <Link className="primary" to="/">打开码栈网页版</Link>
          <a href="#questions">查看使用说明</a>
        </div>
        <p className="download-availability">{app ? '移动端安装包暂未发布。' : '浏览器插件安装包暂未发布。'}</p>
      </div>
      <aside className="download-preview" aria-label="网页版快捷入口">
        <div className="download-preview-title"><span className="brand-mark" aria-hidden="true">◇</span><strong>码栈网页版</strong></div>
        {sections.map(({title,detail,to})=><Link key={title} to={to}>
          <span><strong>{title}</strong><small>{detail}</small></span><span aria-hidden="true">↗</span>
        </Link>)}
      </aside>
    </section>
    <section className="download-info" id="capabilities">
      <h2>网页版功能</h2>
      <ul>{sections.map(feature=><li key={feature.title}><strong>{feature.title}</strong><p>{feature.detail}</p></li>)}</ul>
    </section>
    <section className="download-info" id="questions">
      <h2>常见问题</h2>
      <details><summary>现在如何使用码栈？</summary><p>在手机或电脑的浏览器里打开码栈网页版即可使用。</p></details>
      <details><summary>需要注册账号吗？</summary><p>公开文章、沸点和课程可以直接浏览。发布与互动需要登录。</p></details>
    </section>
  </main>;
}
