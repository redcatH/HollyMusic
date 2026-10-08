import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/hooks/useAuth'
import { Music2, ArrowRight, Eye, EyeOff, Heart, ListMusic, Headphones, Loader2 } from 'lucide-react'
import { AppearanceButton } from '../components/AppearanceSettings'

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
    <div className="app-atmosphere login-page safe-form-page flex min-h-dvh flex-col px-5 py-5 sm:px-10 sm:py-7">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between">
        <div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Music2 className="h-5 w-5" /></span><span className="text-base font-bold tracking-tight">Holly Music</span></div>
        <AppearanceButton compact />
      </header>
      <main className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-10 py-9 md:grid-cols-[1.1fr_1fr] md:gap-14 md:py-12">
        <section className="hidden min-w-0 md:block">
          <div className="login-record-scene" aria-hidden="true">
            <div className="login-record"><span className="login-record-label"><Music2 className="h-9 w-9" /></span></div>
            <div className="login-sleeve"><Music2 className="h-7 w-7 opacity-70" /><span className="text-xs font-medium tracking-[0.25em]">HOLLY<br />COLLECTION</span><div className="login-wave">{[18, 32, 52, 36, 68, 45, 60, 28, 42, 20].map((height, i) => <span key={i} style={{ height }} />)}</div></div>
          </div>
          <p className="mb-4 text-xs font-medium tracking-[0.22em] text-primary">属于你的音乐时光</p>
          <h2 className="text-4xl font-semibold leading-[1.4] tracking-tight lg:text-5xl">让喜欢的音乐，<br />一直在身边。</h2>
          <p className="mt-5 max-w-sm text-sm leading-7 text-muted-foreground">发现新的旋律，收藏熟悉的声音。<br />从这里，回到自己的音乐世界。</p>
          <div className="mt-7 flex flex-wrap gap-5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Headphones className="h-4 w-4 text-primary" /> 多源聆听</span>
            <span className="flex items-center gap-1.5"><Heart className="h-4 w-4 text-primary" /> 随心收藏</span>
            <span className="flex items-center gap-1.5"><ListMusic className="h-4 w-4 text-primary" /> 专属歌单</span>
          </div>
        </section>
        <section className="login-form-card mx-auto w-full max-w-md rounded-3xl border border-border/60 bg-card/90 p-6 sm:p-9">
          <span className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Headphones className="h-6 w-6" /></span>
          <h1 className="text-2xl font-semibold tracking-tight">欢迎回来</h1>
          <p className="mb-8 mt-2 text-sm leading-relaxed text-muted-foreground">登录 Holly Music，继续你的音乐旅程。</p>
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
          <p className="mt-7 border-t border-border/50 pt-5 text-center text-xs leading-relaxed text-muted-foreground">账号由管理员提供，登录后即可使用音乐库。</p>
        </section>
      </main>
      <p className="text-center text-xs tracking-wide text-muted-foreground/80">Holly Music · 把时间交给音乐</p>
    </div>
  )
}
