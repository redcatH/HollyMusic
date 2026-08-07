/**
 * 强制改密页
 * - 首次登录（随机初始密码）或管理员重置密码后，mustChangePassword=true 时展示
 * - 改密成功后回到首页
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/hooks/useAuth'
import { KeyRound, Loader2 } from 'lucide-react'

export function ChangePasswordPage() {
  const navigate = useNavigate()
  const changePassword = useAuthStore(s => s.changePassword)
  const username = useAuthStore(s => s.username)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('请填写所有字段')
      return
    }
    if (newPassword.length < 6) {
      setError('新密码长度至少 6 位')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }
    if (newPassword === currentPassword) {
      setError('新密码不能与当前密码相同')
      return
    }
    setSubmitting(true)
    try {
      await changePassword(currentPassword, newPassword)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改密码失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-2xl bg-card p-8 shadow-xl ring-1 ring-border">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-bold">修改密码</h1>
          <p className="text-center text-sm text-muted-foreground">
            {username ? `账户「${username}」` : '当前账户'}需要修改初始密码后才能继续使用
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">当前密码</label>
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              className="w-full rounded-lg bg-background px-3 py-2.5 text-sm outline-none ring-1 ring-border focus:ring-primary"
              placeholder="当前密码"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">新密码</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-lg bg-background px-3 py-2.5 text-sm outline-none ring-1 ring-border focus:ring-primary"
              placeholder="至少 6 位"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">确认新密码</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-lg bg-background px-3 py-2.5 text-sm outline-none ring-1 ring-border focus:ring-primary"
              placeholder="再次输入新密码"
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
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? '提交中...' : '修改密码'}
          </button>
        </form>
      </div>
    </div>
  )
}
