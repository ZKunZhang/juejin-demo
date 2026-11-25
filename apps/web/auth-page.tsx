import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, HttpError, type User } from './api';
import { useSession } from './session';

type Values = { username: string; displayName: string; password: string };
function safeReturn(value: string | null) {
  return value && /^\/(?![\/\\])/.test(value) && !/[\\\s]/.test(value) ? value : '/';
}

export { safeReturn };

export function AuthPage({ signup = false, admin = false, dismiss }: {
  signup?: boolean;
  admin?: boolean;
  dismiss?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    element.querySelector<HTMLInputElement>('#username')?.focus();
    return () => element.close();
  }, []);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<Values>();
  const [formError, setFormError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { update } = useSession();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const location = useLocation();
  const target = safeReturn(search.get('next'));
  async function submit(values: Values) {
    setFormError('');
    const { username, password, displayName } = values;
    try {
      const user = await api<User>('/api/auth/' + (signup ? 'register' : 'login'), 'POST', signup ? { username, password, displayName } : { username, password });
      update(user);
      if (admin && user.role !== 'ADMIN') return setFormError('此账号没有后台访问权限');
      if (dismiss) dismiss();
      else navigate(target, { replace: true });
    } catch (error) {
      if (error instanceof HttpError && error.code === 'USERNAME_TAKEN') {
        setError('username', { message: error.message }, { shouldFocus: true });
      } else setFormError(error instanceof HttpError ? error.message : '连接失败，请重试');
    }
  }
  const form = <>
      <h2 id="auth-title">{signup ? '创建账号' : '登录'}</h2>
      <form onSubmit={handleSubmit(submit)} noValidate>
        <label htmlFor="username">用户名</label>
        <input id="username" autoComplete="username" placeholder="字母、数字或下划线" aria-invalid={!!errors.username} aria-describedby={errors.username ? 'username-error' : undefined} {...register('username', { required: '请输入用户名', pattern: { value: /^[a-zA-Z0-9_]{3,32}$/, message: '使用 3–32 位字母、数字或下划线' } })}/>
        {errors.username && <small className="error" id="username-error">{errors.username.message}</small>}
        {signup && <><label htmlFor="displayName">昵称</label>
        <input id="displayName" autoComplete="nickname" maxLength={80} aria-invalid={!!errors.displayName} {...register('displayName', { validate: value => !!value.trim() || '请输入昵称' })}/>
        {errors.displayName && <small className="error" role="alert">{errors.displayName.message}</small>}</>}
        <label htmlFor="password">密码</label><div className="password-field">
        <input id="password" type={showPassword ? 'text' : 'password'} autoComplete={signup ? 'new-password' : 'current-password'} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'password-error' : undefined} {...register('password', { required: '请输入密码', minLength: { value: 8, message: '密码至少 8 个字符' }, maxLength: { value: 128, message: '密码最多 128 个字符' } })}/>
        <button className="subtle" type="button" onClick={() => setShowPassword(!showPassword)} aria-pressed={showPassword}>{showPassword ? '隐藏' : '显示'}</button></div>
        {errors.password && <small className="error" id="password-error">{errors.password.message}</small>}
        {formError && <p className="error" role="alert">{formError}</p>}
        <button className="primary submit" type="submit" disabled={isSubmitting}>{isSubmitting ? '提交中…' : signup ? '注册' : '登录'}</button>
      </form>
      {!admin && !isSubmitting && <p className="auth-switch">{signup ? '已有账号？' : '还没有账号？'} <Link replace state={location.state} to={(signup ? '/login' : '/register') + (target === '/' ? '' : '?next=' + encodeURIComponent(target))}>{signup ? '去登录' : '去注册'}</Link></p>}
  </>;
  if (dismiss) return <dialog
    ref={dialog}
    className="auth-panel auth-dialog"
    aria-labelledby="auth-title"
    onCancel={event => {
      event.preventDefault();
      if (!isSubmitting) dismiss();
    }}
  >
    <button type="button" className="subtle auth-close" aria-label="关闭" disabled={isSubmitting} onClick={dismiss}>×</button>
    {form}
  </dialog>;
  return <main className="auth-layout">
    <aside className="auth-brand"><span className="brand-mark" aria-hidden="true">◇</span><h1>{admin ? '码栈管理后台' : '码栈开发者社区'}</h1><p>{admin ? '使用管理员账号登录。' : '阅读技术文章，记录实践，与开发者交流。'}</p></aside>
    <section className="auth-panel">{form}</section>
  </main>;
}
