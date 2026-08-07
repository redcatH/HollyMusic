/**
 * 修改密码页
 * - 强制场景（mustChangePassword=true）：首次登录/管理员重置后，拦截到此页
 * - 主动场景：用户从菜单「修改密码」进入，改完返回上一页
 *
 * 交互：
 * - 每个密码框可切换显示/隐藏（手机端输随机密码友好）
 * - 新密码实时强度指示（弱/中/强）
 * - 确认密码实时一致性校验
 * - 成功后 toast 反馈
 */

import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/hooks/useAuth'
import { toast } from '@/lib/toast'
import { KeyRound, Loader2, Eye, EyeOff, ArrowLeft, Check } from 'lucide-react'

/** 密码强度评估：返回 0~3 分及标签 */
function getStrength(pwd: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (!pwd) return { score: 0, label: '' }
  let types = 0
  if (/[a-z]/.test(pwd)) types++
  if (/[A-Z]/.test(pwd)) types++
  if (/[0-9]/.test(pwd)) types++
  if (/[^a-zA-Z0-9]/.test(pwd)) types++
  if (pwd.length < 6 || types < 2) return { score: 1, label: '弱' }
  if (pwd.length < 10 || types < 3) return { score: 2, label: '中' }
  return { score: 3, label: '强' }
}

const STRENGTH_COLORS = {
  1: 'bg-red-500',
  2: 'bg-amber-500',
  3: 'bg-green-500',
}
const STRENGTH_TEXT = {
  1: 'text-red-500',
  2: 'text-amber-500',
  3: 'text-green-500',
}

export function ChangePasswordPage() {
  const navigate = useNavigate()
  const changePassword = useAuthStore(s => s.changePassword)
  const username = useAuthStore(s => s.username)
  const forced = useAuthStore(s => s.mustChangePassword)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 三个密码框独立的显隐切换
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const strength = useMemo(() => getStrength(newPassword), [newPassword])
  const confirmMismatch = confirmPassword.length > 0 && confirmPassword !== newPassword

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
    if (confirmMismatch) {
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
      toast.success('密码修改成功')
      // 强制场景回首页；主动场景返回上一页
      if (forced) {
        navigate('/', { replace: true })
      } else {
        navigate(-1)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改密码失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl ring-1 ring-border sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-2">
          {!forced && (
            <button
              onClick={() => navigate(-1)}
              className="absolute left-4 top-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> 返回
            </button>
          )}
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-bold">修改密码</h1>
          <p className="text-center text-sm text-muted-foreground">
            {forced
              ? `${username ? `账户「${username}」` : '当前账户'}需要修改初始密码后才能继续使用`
              : '为账户设置一个新密码'}
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <PasswordField
            label="当前密码"
            value={currentPassword}
            onChange={setCurrentPassword}
            show={showCurrent}
            onToggle={() => setShowCurrent(v => !v)}
            autoComplete="current-password"
            placeholder="当前密码"
            autoFocus
          />

          <div>
            <PasswordField
              label="新密码"
              value={newPassword}
              onChange={setNewPassword}
              show={showNew}
              onToggle={() => setShowNew(v => !v)}
              autoComplete="new-password"
              placeholder="至少 6 位"
            />
            {/* 强度指示器 */}
            {newPassword.length > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex flex-1 gap-1">
                  {[1, 2, 3].map(i => (
                    <div
                      key={i}
                      className={`h-1.5 flex-1 rounded-full transition-colors ${
                        i <= strength.score ? STRENGTH_COLORS[strength.score as 1 | 2 | 3] : 'bg-muted'
                      }`}
                    />
                  ))}
                </div>
                <span className={`w-6 text-xs font-medium ${STRENGTH_TEXT[strength.score as 1 | 2 | 3]}`}>
                  {strength.label}
                </span>
              </div>
            )}
          </div>

          <div>
            <PasswordField
              label="确认新密码"
              value={confirmPassword}
              onChange={setConfirmPassword}
              show={showConfirm}
              onToggle={() => setShowConfirm(v => !v)}
              autoComplete="new-password"
              placeholder="再次输入新密码"
              error={confirmMismatch}
            />
            {/* 一致性实时提示 */}
            {confirmMismatch ? (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-destructive">
                两次输入的新密码不一致
              </p>
            ) : confirmPassword.length > 0 && confirmPassword === newPassword ? (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-green-500">
                <Check className="h-3 w-3" /> 密码一致
              </p>
            ) : null}
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

/** 可切换显隐的密码输入框 */
function PasswordField({
  label,
  value,
  onChange,
  show,
  onToggle,
  autoComplete,
  placeholder,
  autoFocus,
  error,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  show: boolean
  onToggle: () => void
  autoComplete: string
  placeholder: string
  autoFocus?: boolean
  error?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          className={`w-full rounded-lg bg-background px-3 py-2.5 pr-10 text-sm outline-none ring-1 transition focus:ring-primary ${
            error ? 'ring-destructive' : 'ring-border'
          }`}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={onToggle}
          tabIndex={-1}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label={show ? '隐藏密码' : '显示密码'}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </label>
  )
}
