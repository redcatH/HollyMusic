
/**
 * 用户管理面板（admin Tab 子组件）。
 * 从 app/admin/users/page.tsx 抽取，逻辑不变，去掉页面壳与鉴权重定向。
 */

import { useState, useCallback, useEffect } from 'react'
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  type AdminUser,
} from '@/lib/api/admin-users'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Plus, Pencil, Trash2, Shield, X, Loader2, KeyRound } from 'lucide-react'
import { useAuthStore } from '@/hooks/useAuth'

type DialogMode =
  | { kind: 'create' }
  | { kind: 'edit'; user: AdminUser }
  | { kind: 'password'; user: AdminUser }
  | null

export function UsersPanel() {
  const currentUsername = useAuthStore(s => s.username)

  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogMode>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { list } = await listUsers()
      setUsers(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const handleCreated = async (username: string, password: string) => {
    await createUser(username, password)
    setDialog(null)
    await reload()
  }

  const handleUpdated = async (id: number, username: string) => {
    await updateUser(id, { username })
    setDialog(null)
    await reload()
  }

  const handlePasswordChanged = async (id: number, password: string) => {
    await updateUser(id, { password })
    setDialog(null)
  }

  const handleDelete = async (u: AdminUser) => {
    if (!confirm(`确定删除用户「${u.username}」？其歌单/收藏/历史将一并删除。`)) return
    try {
      await deleteUser(u.id)
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : '删除失败')
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <Shield className="h-5 w-5 text-primary" />
            用户管理
          </h2>
          <p className="text-sm text-muted-foreground">管理系统用户账号</p>
        </div>
        <button
          onClick={() => setDialog({ kind: 'create' })}
          className="flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> 新建用户
        </button>
      </div>

      {loading ? (
        <LoadingSkeleton count={5} />
      ) : error ? (
        <EmptyState icon={Shield} title="加载失败" description={error} />
      ) : users.length === 0 ? (
        <EmptyState icon={Shield} title="暂无用户" description="" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-accent/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">用户名</th>
                <th className="px-4 py-3 font-medium">角色</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">密码</th>
                <th className="px-4 py-3 font-medium">最近登录</th>
                <th className="px-4 py-3 font-medium">创建时间</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const isSelf = u.username === currentUsername
                return (
                  <tr key={u.id} className="border-t border-border hover:bg-accent/20">
                    <td className="px-4 py-3 font-medium">
                      {u.username}
                      {isSelf && (
                        <span className="ml-2 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">
                          你
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {u.isAdmin ? (
                        <span className="flex w-fit items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          <Shield className="h-3 w-3" /> 管理员
                        </span>
                      ) : (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          用户
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="flex w-fit items-center gap-1 text-xs text-muted-foreground"
                        title={`最近活跃：${u.lastSeen ? new Date(u.lastSeen).toLocaleString('zh-CN') : '—'}\nIP：${u.lastSeenIp || '—'}\nUA：${u.lastSeenUa || '—'}`}
                      >
                        <span className={`h-2 w-2 rounded-full ${u.isOnline ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
                        {u.isOnline ? '在线' : '离线'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {u.hasPassword ? '已设置' : '未设置'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {u.lastLogin ? new Date(u.lastLogin).toLocaleString('zh-CN') : '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setDialog({ kind: 'password', user: u })}
                          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                          title="重置密码"
                        >
                          <KeyRound className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDialog({ kind: 'edit', user: u })}
                          disabled={u.isAdmin}
                          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                          title={u.isAdmin ? '管理员不可改名' : '编辑'}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(u)}
                          disabled={u.isAdmin || isSelf}
                          className="rounded p-1.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
                          title={
                            u.isAdmin
                              ? '管理员不可删除'
                              : isSelf
                                ? '不能删除自己'
                                : '删除'
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <UserDialog
          mode={dialog}
          onClose={() => setDialog(null)}
          onCreated={handleCreated}
          onUpdated={handleUpdated}
          onPasswordChanged={handlePasswordChanged}
        />
      )}
    </div>
  )
}

interface DialogProps {
  mode: Exclude<DialogMode, null>
  onClose: () => void
  onCreated: (username: string, password: string) => Promise<void>
  onUpdated: (id: number, username: string) => Promise<void>
  onPasswordChanged: (id: number, password: string) => Promise<void>
}

function UserDialog({ mode, onClose, onCreated, onUpdated, onPasswordChanged }: DialogProps) {
  const [username, setUsername] = useState(mode.kind === 'edit' ? mode.user.username : '')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const title =
    mode.kind === 'create'
      ? '新建用户'
      : mode.kind === 'edit'
        ? '编辑用户'
        : '重置密码'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    setSubmitting(true)
    try {
      if (mode.kind === 'create') {
        if (!username.trim() || !password) throw new Error('用户名和密码不能为空')
        await onCreated(username.trim(), password)
      } else if (mode.kind === 'edit') {
        if (!username.trim()) throw new Error('用户名不能为空')
        await onUpdated(mode.user.id, username.trim())
      } else {
        if (!password) throw new Error('密码不能为空')
        await onPasswordChanged(mode.user.id, password)
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg bg-card p-6 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit}>
          {mode.kind !== 'password' && (
            <label className="mb-3 block">
              <span className="mb-1 block text-xs text-muted-foreground">用户名</span>
              <input
                autoFocus
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="用户名"
                disabled={mode.kind === 'edit' && mode.user.isAdmin}
                className="w-full rounded-md bg-background px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary disabled:opacity-50"
              />
            </label>
          )}
          <label className="mb-4 block">
            <span className="mb-1 block text-xs text-muted-foreground">
              {mode.kind === 'edit' ? '新密码（留空不改）' : '密码'}
            </span>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode.kind === 'edit' ? '留空表示不修改密码' : '密码'}
              autoFocus={mode.kind === 'password'}
              className="w-full rounded-md bg-background px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary"
            />
          </label>
          {err && <p className="mb-3 text-xs text-destructive">{err}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              确定
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
