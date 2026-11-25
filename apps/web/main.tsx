import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate, createPath, matchPath, parsePath, type Location } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthPage, safeReturn } from './auth-page';
import { SessionProvider, useSession } from './session';
import { api } from './api';
import { CoursePage, Courses } from './courses';
import { CourseReadingEntry } from './course-reading-entry';
import { PulseDetail, PulseLeaderboard, Pulses } from './pulses';
import { Profile } from './profile';
import { NotificationBell, Notifications } from './notifications';
import { CreatorDashboard, CreatorMenu } from './creator';
import { ArticlePage, Creator, Editor, Home } from './articles';
import './styles.css';
import './community.css';

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: false } } });
function Header({ location }: { location: Location }) {
  const { user, loading, error, retry, update } = useSession();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const navigate=useNavigate();
  useEffect(() => {
    setHidden(false);
    let last = Math.max(0, window.scrollY);
    function onScroll() {
      const current = Math.max(0, window.scrollY);
      if (current <= 80) {
        setHidden(false);
      } else {
        if (Math.abs(current - last) < 12) return;
        setHidden(current > last);
      }
      last = current;
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [location.pathname]);
  async function logout() {
    setBusy(true); setStatus('');
    try { await api('/api/auth/logout', 'POST'); update(null); }
    catch { setStatus('退出失败，请重试'); }
    finally { setBusy(false); }
  }
  const authQuery = createPath(location) === '/' ? '' : '?next=' + encodeURIComponent(createPath(location));
  const authState = { background: location };
  return <header className={hidden ? 'site-header site-header-hidden' : 'site-header'}><div className="header-inner">
    <Link className="wordmark" to="/"><span className="brand-mark" aria-hidden="true">◇</span>码栈</Link>
    <nav aria-label="主导航"><Link to="/" aria-current={location.pathname === '/' ? 'page' : undefined}>文章</Link><Link to="/pulses" aria-current={location.pathname==='/pulses'?'page':undefined}>沸点</Link><Link to="/courses" aria-current={location.pathname.startsWith('/courses')?'page':undefined}>课程</Link></nav><form className="search" role="search" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);const word=String(form.get('q')||'').trim();navigate(word?'/?q='+encodeURIComponent(word):'/');}}><input key={location.search} aria-label="搜索文章" name="q" type="search" maxLength={100} placeholder="搜索文章" defaultValue={new URLSearchParams(location.search).get('q')||''}/><button className="subtle" type="submit">搜索</button></form>
    <CreatorMenu/>
    <div className="account">
      {loading ? <span role="status">加载中…</span> : error ? <button className="subtle" onClick={retry}>重试会话</button> : user ? <>
        <NotificationBell userId={user.id}/>
        <Link className="profile-link" to="/me" aria-current={location.pathname === '/me' ? 'page' : undefined}>
          <span className="avatar" aria-hidden="true">{Array.from(user.displayName)[0]}</span>
          <span className="nickname">{user.displayName}</span>
        </Link>
        <button className="subtle" onClick={logout} disabled={busy}>退出</button>
      </> : <><Link to={'/login' + authQuery} state={authState}>登录</Link><Link className="primary" to={'/register' + authQuery} state={authState}>注册</Link></>}
      {status && <span className="error" role="alert">{status}</span>}
    </div>
  </div></header>;
}
function WebRoutes() {
  const location = useLocation();
  const navigate = useNavigate();
  const signup = !!matchPath('/register', location.pathname);
  const auth = signup || !!matchPath('/login', location.pathname);
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (auth) {
      if (!opener.current && document.activeElement instanceof HTMLElement) {
        opener.current = document.activeElement;
      }
    } else {
      opener.current?.focus({ preventScroll: true });
      opener.current = null;
    }
  }, [auth]);
  const next = safeReturn(new URLSearchParams(location.search).get('next'));
  const parsed = parsePath(next);
  const targetPath = parsed.pathname || '/';
  const target = matchPath('/login', targetPath) || matchPath('/register', targetPath) ? '/' : next;
  const background: Location | undefined = auth ? location.state?.background : undefined;
  const content = auth ? background ?? { pathname: '/', search: '', hash: '', state: null, key: 'auth-background', ...parsePath(target) } : location;

  const editor = matchPath('/creator/articles/new', content.pathname) || matchPath('/creator/articles/:id/edit', content.pathname);
  return <>{!editor && <Header location={content}/>}<Routes location={content}>
    <Route path="/" element={<Home/>}/>
    <Route path="/courses" element={content.pathname === '/courses/' ? <CourseReadingEntry/> : <Courses/>}/>
    <Route path="/courses/:id" element={<CoursePage/>}/>
    <Route path="/courses/:id/lessons/:lessonId" element={<CoursePage/>}/>
    <Route path="/pulses" element={<Pulses/>}/>
    <Route path="/pulses/:id" element={<PulseDetail/>}/>
    <Route path="/pulses/leaderboard" element={<PulseLeaderboard/>}/>
    <Route path="/user/center/signrank" element={<PulseLeaderboard/>}/>
    <Route path="/articles/:id" element={<ArticlePage/>}/>
    <Route path="/notifications" element={<Notifications/>}/>
    <Route path="/creator" element={<CreatorDashboard/>}/>
    <Route path="/creator/articles" element={<Creator/>}/>
    <Route path="/creator/articles/new" element={<Editor/>}/>
    <Route path="/creator/articles/:id/edit" element={<Editor/>}/>
    <Route path="/me" element={<Profile/>}/>
    <Route path="/me/bookmarks" element={<Profile/>}/>
    <Route path="/me/following" element={<Profile/>}/>
    <Route path="*" element={<main className="surface missing"><h1>页面不存在</h1><Link to="/">返回文章首页</Link></main>}/>
  </Routes>
    {auth && <AuthPage key={location.pathname} signup={signup} dismiss={() => {
      if (background) navigate(-1);
      else navigate(target, { replace: true });
    }}/>}
  </>;
}
export function App() {
  return <QueryClientProvider client={client}><SessionProvider><BrowserRouter><WebRoutes/></BrowserRouter></SessionProvider></QueryClientProvider>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
