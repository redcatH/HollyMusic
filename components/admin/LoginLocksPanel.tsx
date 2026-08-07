/**
 * 登录锁定管理面板（admin Tab 子组件）。
 * 展示因登录失败次数过多被锁定的 IP，支持单个解锁 / 全部解锁。
 * 锁定状态存进程内存，重启即清空。
 */

import { useState, useCallback, useEffect } from 'react'
import {
  listLoginLocks,
  unlockLoginLock,
  clearAllLoginLocks,
  type LoginLock,
} from '@/lib/api/admin-login-locks'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { ShieldOff, Unlock, Trash2, RefreshCw, Loader2 } from 'lucide-react'

export function LoginLocksPanel() {
  const [locks, setLocks] = useState<LoginLock[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyIp, setBusyIp] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { locks: list } = await listLoginLocks()
      setLocks(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const handleUnlock = async (ip: string) => {
    setBusyIp(ip)
    try {
      await unlockLoginLock(ip)
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : '解锁失败')
    } finally {
      setBusyIp(null)
    }
  }

  const handleClearAll = async () => {
    if (!confirm('确定清空所有登录锁定记录？')) return
    setClearing(true)
    try {
      await clearAllLoginLocks()
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : '操作失败')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <ShieldOff className="h-5 w-5 text-primary" />
            登录锁定
          </h2>
          <p className="text-sm text-muted-foreground">
            因登录失败次数过多（5 分钟内失败 10 次）被锁定的 IP，锁定 15 分钟
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={reload}
            className="flex items-center gap-1 rounded-full px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <RefreshCw className="h-4 w-4" /> 刷新
          </button>
          <button
            onClick={handleClearAll}
            disabled={clearing || locks.length === 0}
            className="flex items-center gap-1 rounded-full bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            全部解锁
          </button>
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton count={3} />
      ) : error ? (
        <EmptyState icon={ShieldOff} title="加载失败" description={error} />
      ) : locks.length === 0 ? (
        <EmptyState icon={ShieldOff} title="暂无锁定记录" description="当前没有 IP 被锁定" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-accent/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">IP 地址</th>
                <th className="px-4 py-3 font-medium">剩余锁定时间</th>
                <th className="px-4 py-3 font-medium">窗口内失败次数</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {locks.map(l => (
                <tr key={l.ip} className="border-t border-border hover:bg-accent/20">
                  <td className="px-4 py-3 font-mono font-medium">{l.ip}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {Math.floor(l.retryAfterSec / 60)} 分 {l.retryAfterSec % 60} 秒
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{l.failures}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleUnlock(l.ip)}
                        disabled={busyIp === l.ip}
                        className="flex items-center gap-1 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        title="解锁该 IP"
                      >
                        {busyIp === l.ip ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Unlock className="h-4 w-4" />
                        )}
                        解锁
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
