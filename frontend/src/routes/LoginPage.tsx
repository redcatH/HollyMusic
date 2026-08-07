import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/hooks/useAuth'
import { Music2, LogIn } from 'lucide-react'

export function LoginPage() {
  const navigate = useNavigate()
  const login = useAuthStore(s => s.login)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

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
      // 改密守卫会在 App.tsx 中根据 mustChangePassword 自动跳转
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-2xl bg-card p-8 shadow-xl ring-1 ring-border">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Music2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-bold">Holly Music</h1>
          <p className="text-sm text-muted-foreground">登录以收藏、创建歌单与查看历史</p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">用户名</label>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              className="w-full rounded-lg bg-background px-3 py-2.5 text-sm outline-none ring-1 ring-border focus:ring-primary"
              placeholder="用户名"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full rounded-lg bg-background px-3 py-2.5 text-sm outline-none ring-1 ring-border focus:ring-primary"
              placeholder="密码"
            />
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LogIn className="h-4 w-4" />
            {submitting ? '登录中...' : '登录'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          匿名用户仍可搜索与播放
        </p>
      </div>
    </div>
  )
}
