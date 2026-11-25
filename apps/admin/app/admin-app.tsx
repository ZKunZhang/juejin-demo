import { useState } from 'react';
import { Button, ConfigProvider, Input, Menu } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../../shared/api/api';
import { AuthPage } from '../../shared/auth/auth-page';
import { SessionProvider, useSession } from '../../shared/auth/session';
import { Pending } from '../../shared/ui/pending';
import { ActivityEditor, ActivityQueue } from '../features/activities/activities';
import { LeaderboardAdmin, PulseReview } from '../features/pulses/pulse-review';
import { ReviewArticle, ReviewQueue } from '../features/articles/article-review';
import { Comments } from '../features/comments/comment-review';
import { errors } from '../shared/errors';
import '../../shared/styles/styles.css';
import './styles/admin.css';
import './styles/admin-controls.css';

const client=new QueryClient({defaultOptions:{queries:{retry:false}}});

import { AdminAi } from '../features/ai/ai';
import { AdminProjects } from '../features/projects/projects';

const adminSections = [
  ['/articles', '文章管理'],
  ['/comments', '评论管理'],
  ['/pulses', '沸点管理'],
  ['/pulses/featured', '精选沸点'],
  ['/activities', '活动管理'],
  ['/projects', '作品审核'],
  ['/ai', 'AI 目录与价格'],
  ['/leaderboard', '社区排行榜'],
] as const;

function AdminNavigation() {
  const { pathname } = useLocation();
  const active = [...adminSections].reverse().find(([path]) => pathname === path || pathname.startsWith(path + '/'));
  return <nav className="surface admin-nav admin-library-nav" aria-label="管理导航">
    <Menu selectedKeys={active ? [active[0]] : []} items={[
      ...adminSections.map(([path, title]) => ({
        key: path,
        label: <Link to={path} aria-current={active?.[0] === path ? 'page' : undefined}>{title}</Link>,
      })),
      { type: 'divider' },
      { key: 'front', label: <a href="/">访问前台</a> },
    ]}/>
  </nav>;
}

function AdminShell() {
  const {user,loading,error,retry,update}=useSession();
  const [failure,setFailure]=useState('');
  async function logout() {setFailure('');try{await api('/api/auth/logout','POST');update(null);}catch(error){setFailure(errors(error));}}
  if(loading||error)return <main className="surface work"><Pending error={error} retry={retry}/></main>;
  if(!user)return <Routes><Route path="/login" element={<AuthPage admin adminInput={Input}/>}/><Route path="*" element={<Navigate to="/login" replace/>}/></Routes>;
  if(user.role!=='ADMIN')return <main className="surface work"><h1>没有后台访问权限</h1><button className="subtle" onClick={logout}>退出并换账号</button>{failure&&<p className="error" role="alert">{failure}</p>}</main>;
  return <div className="admin-shell"><header className="site-header admin-header"><div className="header-inner"><Link className="wordmark" to="/"><span className="brand-mark">◇</span>码栈管理后台</Link><div className="account"><span className="nickname">{user.displayName}</span><Button ghost type="primary" onClick={logout}>退出</Button></div></div></header>
    <main className="admin admin-grid"><AdminNavigation/><div className="surface admin-panel">
      {failure&&<p className="error" role="alert">{failure}</p>}
      <Routes><Route path="/" element={<Navigate to="/articles" replace/>}/><Route path="/login" element={<Navigate to="/articles" replace/>}/><Route path="/articles" element={<ReviewQueue/>}/><Route path="/articles/:id" element={<ReviewArticle/>}/><Route path="/comments" element={<Comments key="articles"/>}/><Route path="/comments/pulses" element={<Comments key="pulses" pulse/>}/><Route path="/pulses" element={<PulseReview key="review"/>}/><Route path="/pulses/featured" element={<PulseReview key="featured" featured/>}/><Route path="/leaderboard" element={<LeaderboardAdmin/>}/><Route path="/activities" element={<ActivityQueue/>}/><Route path="/projects" element={<AdminProjects/>}/><Route path="/ai" element={<AdminAi/>}/><Route path="/activities/new" element={<ActivityEditor/>}/><Route path="/activities/:id" element={<ActivityEditor/>}/><Route path="*" element={<Navigate to="/articles" replace/>}/></Routes>
    </div></main></div>;
}

export function AdminApp() {
  return <QueryClientProvider client={client}><ConfigProvider locale={zhCN} theme={{token:{colorPrimary:"#3154c5",borderRadius:8}}}><SessionProvider><BrowserRouter basename="/admin"><AdminShell/></BrowserRouter></SessionProvider></ConfigProvider></QueryClientProvider>;
}
