import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/hooks/useAuth'
import { AuthLayout } from '../components/AuthLayout'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const login = useAuthStore(s => s.login)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!username.trim() || !password) {
      setError('请输入用户名和密码')
      return
    }
    setSubmitting(true)
    try {
      await login(username.trim(), password)
      // 改密守卫会在 App.tsx 中根据 mustChangePassword 自动跳转。
      // 登录成功后回到来源页（全局守卫拦截时携带 redirect）；仅接受站内路径，防 open redirect。
      const raw = new URLSearchParams(location.search).get('redirect')
      const target = raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/login')
        ? raw
        : '/'
      navigate(target, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout title="欢迎回来" description="登录 Holly Music，继续你的音乐旅程。" footer="账号由管理员提供，登录后即可使用音乐库。">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div>
          <label htmlFor="login-username" className="mb-2 block text-sm font-medium">用户名</label>
          <input id="login-username" name="username" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={submitting} aria-describedby={error ? 'login-error' : undefined} className="h-12 w-full rounded-xl border border-border bg-background/45 px-3.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60" placeholder="输入用户名" />
        </div>
        <div>
          <label htmlFor="login-password" className="mb-2 block text-sm font-medium">密码</label>
          <div className="relative">
            <input id="login-password" name="password" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" disabled={submitting} aria-describedby={error ? 'login-error' : undefined} className="h-12 w-full rounded-xl border border-border bg-background/45 pl-3.5 pr-12 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60" placeholder="输入密码" />
            <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground" aria-label={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
          </div>
        </div>
        {error && <p id="login-error" role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={submitting} className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{submitting ? '登录中...' : '登录'}{!submitting && <ArrowRight className="h-4 w-4" />}</button>
      </form>
    </AuthLayout>
  )
}
