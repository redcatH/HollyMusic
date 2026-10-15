import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/hooks/useAuth'
import { AuthLayout } from '../components/AuthLayout'

const INPUT_CLASS = 'h-12 w-full rounded-xl border border-border bg-background/45 px-3.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60'

export function SetupPage() {
  const navigate = useNavigate()
  const setup = useAuthStore(s => s.setup)
  const tokenRequired = useAuthStore(s => s.setupTokenRequired)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [token, setToken] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (password.length < 8 || password.length > 128 || !password.trim()) {
      setError('请设置 8–128 位密码')
      return
    }
    if (password !== confirmation) {
      setError('两次输入的密码不一致')
      return
    }
    if (tokenRequired && !token) {
      setError('请输入初始化码')
      return
    }
    setSubmitting(true)
    try {
      await setup(password, confirmation, token)
      navigate('/', { replace: true })
    } catch (error) {
      setError(error instanceof Error ? error.message : '设置失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout title="欢迎使用 Holly Music" description="设置管理员密码，开启你的音乐时光。" footer="管理员可管理账号与音源。完成设置后即可开始使用。">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div>
          <label htmlFor="setup-username" className="mb-2 block text-sm font-medium">管理员账号</label>
          <input id="setup-username" name="username" value="admin" readOnly autoComplete="username" className={`${INPUT_CLASS} text-muted-foreground`} />
        </div>
        {tokenRequired && <div>
          <label htmlFor="setup-token" className="mb-2 block text-sm font-medium">初始化码</label>
          <input id="setup-token" name="setupToken" type="password" value={token} onChange={event => setToken(event.target.value)} autoComplete="off" disabled={submitting} className={INPUT_CLASS} placeholder="输入部署时配置的初始化码" />
        </div>}
        {([
          { id: 'setup-password', label: '管理员密码', value: password, change: setPassword, show: showPassword, toggle: () => setShowPassword(value => !value), placeholder: '设置至少 8 位密码' },
          { id: 'setup-confirmation', label: '确认密码', value: confirmation, change: setConfirmation, show: showConfirmation, toggle: () => setShowConfirmation(value => !value), placeholder: '再次输入密码' },
        ]).map(field => <div key={field.id}>
          <label htmlFor={field.id} className="mb-2 block text-sm font-medium">{field.label}</label>
          <div className="relative">
            <input id={field.id} name={field.id} type={field.show ? 'text' : 'password'} value={field.value} onChange={event => field.change(event.target.value)} autoComplete="new-password" maxLength={128} disabled={submitting} aria-describedby={error ? 'setup-error' : undefined} className={`${INPUT_CLASS} pr-12`} placeholder={field.placeholder} />
            <button type="button" onClick={field.toggle} className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground" aria-label={`${field.show ? '隐藏' : '显示'}${field.label}`}>{field.show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
          </div>
        </div>)}
        {error && <p id="setup-error" role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={submitting} className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{submitting ? '正在完成设置...' : '完成设置'}{!submitting && <ArrowRight className="h-4 w-4" />}</button>
      </form>
    </AuthLayout>
  )
}
