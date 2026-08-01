'use client'

/**
 * 缓存管理面板（admin Tab 子组件）。
 *
 * 两类缓存分区展示：
 * - 内存缓存：进程内存存储，重启后清空，TTL 210 分钟自动过期
 * - 磁盘缓存：持久化文件，多用户共享，LRU 自动淘汰
 */

import { useState, useCallback, useEffect } from 'react'
import {
  getCacheStats,
  clearCache,
  type CacheStats,
} from '@/lib/api/admin-cache'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import {
  Database,
  HardDrive,
  Trash2,
  Loader2,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react'

export function CachePanel() {
  const [stats, setStats] = useState<CacheStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [clearing, setClearing] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getCacheStats()
      setStats(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const handleClear = async (type: 'search' | 'url' | 'audio' | 'all') => {
    const labels: Record<string, string> = {
      search: '搜索缓存',
      url: 'URL 缓存',
      audio: '音频磁盘缓存',
      all: '全部缓存',
    }
    if (!confirm(`确定清理${labels[type]}？${type === 'all' || type === 'audio' ? '磁盘文件删除后不可恢复，所有用户需重新下载。' : '清理后下次请求将重新获取。'}`)) return

    setClearing(type)
    setMsg(null)
    try {
      const result = await clearCache(type)
      // 刷新统计
      await reload()
      const audioInfo = result.audio
      let text = `${labels[type]}已清理`
      if (type === 'audio' && audioInfo) {
        text = `已清理音频缓存：${audioInfo.count} 个文件，释放 ${formatBytes(audioInfo.bytes)}`
      } else if (type === 'all' && audioInfo) {
        text = `已清理全部缓存${audioInfo.count > 0 ? `（含音频 ${audioInfo.count} 个文件 / ${formatBytes(audioInfo.bytes)}）` : ''}`
      }
      setMsg({ kind: 'success', text })
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : '清理失败' })
    } finally {
      setClearing(null)
    }
  }

  if (loading) {
    return (
      <div>
        <h2 className="mb-6 flex items-center gap-2 text-xl font-bold">
          <Database className="h-5 w-5 text-primary" />
          缓存管理
        </h2>
        <LoadingSkeleton count={4} />
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <h2 className="mb-6 flex items-center gap-2 text-xl font-bold">
          <Database className="h-5 w-5 text-primary" />
          缓存管理
        </h2>
        <EmptyState icon={Database} title="加载失败" description={error} />
      </div>
    )
  }

  const diskEnabled = stats?.disk.enabled ?? false
  const diskUsagePercent = stats && stats.disk.quotaBytes > 0
    ? Math.min(100, (stats.disk.totalBytes / stats.disk.quotaBytes) * 100)
    : 0

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <Database className="h-5 w-5 text-primary" />
            缓存管理
          </h2>
          <p className="text-sm text-muted-foreground">管理系统缓存</p>
        </div>
        <button
          onClick={reload}
          className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" /> 刷新
        </button>
      </div>

      {msg && (
        <div
          className={`mb-4 flex items-center gap-2 rounded-md px-4 py-2 text-sm ${
            msg.kind === 'success'
              ? 'bg-green-500/10 text-green-600'
              : 'bg-destructive/10 text-destructive'
          }`}
        >
          {msg.kind === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span className="flex-1">{msg.text}</span>
        </div>
      )}

      {/* ── 内存缓存 ── */}
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">内存缓存</h3>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          进程内存存储，重启后自动清空，TTL 210 分钟自动过期
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* 搜索缓存 */}
          <div className="rounded-lg border border-border p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">搜索结果缓存</span>
              <button
                onClick={() => handleClear('search')}
                disabled={clearing !== null || (stats?.memory.search.size ?? 0) === 0}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-30"
              >
                {clearing === 'search' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                清理
              </button>
            </div>
            <div className="text-2xl font-bold">{stats?.memory.search.size ?? 0}<span className="ml-1 text-xs font-normal text-muted-foreground">条</span></div>
            <div className="mt-1 text-xs text-muted-foreground">命中率 {stats?.memory.search.hitRate ?? '0%'}</div>
          </div>

          {/* URL 缓存 */}
          <div className="rounded-lg border border-border p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">播放地址缓存</span>
              <button
                onClick={() => handleClear('url')}
                disabled={clearing !== null || (stats?.memory.url.size ?? 0) === 0}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-30"
              >
                {clearing === 'url' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                清理
              </button>
            </div>
            <div className="text-2xl font-bold">{stats?.memory.url.size ?? 0}<span className="ml-1 text-xs font-normal text-muted-foreground">条</span></div>
            <div className="mt-1 text-xs text-muted-foreground">命中率 {stats?.memory.url.hitRate ?? '0%'}</div>
          </div>
        </div>
      </section>

      {/* ── 磁盘缓存 ── */}
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">磁盘缓存</h3>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          持久化文件存储，多用户共享，LRU 水位线自动淘汰
        </p>

        {!diskEnabled ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2 text-sm text-amber-600">
              <AlertCircle className="h-4 w-4" />
              音频磁盘缓存未启用（ENABLE_FILE_CACHE=false）
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium">音频文件缓存</span>
              <button
                onClick={() => handleClear('audio')}
                disabled={clearing !== null || (stats?.disk.total ?? 0) === 0}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-30"
              >
                {clearing === 'audio' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                清理
              </button>
            </div>

            {/* 占用与配额 */}
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold">{formatBytes(stats?.disk.totalBytes ?? 0)}</span>
              <span className="text-xs text-muted-foreground">
                / {formatBytes(stats?.disk.quotaBytes ?? 0)} ({diskUsagePercent.toFixed(1)}%)
              </span>
            </div>

            {/* 配额进度条 */}
            <div className="mb-3 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${
                  diskUsagePercent > 80 ? 'bg-destructive' : diskUsagePercent > 60 ? 'bg-amber-500' : 'bg-primary'
                }`}
                style={{ width: `${diskUsagePercent}%` }}
              />
            </div>

            {/* 文件状态明细 */}
            <div className="flex flex-wrap gap-4 text-xs">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                完整 <span className="font-medium">{stats?.disk.complete ?? 0}</span>
              </span>
              <span className="flex items-center gap-1">
                <AlertCircle className="h-3 w-3 text-amber-500" />
                不完整 <span className="font-medium">{stats?.disk.partial ?? 0}</span>
              </span>
              <span className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 text-blue-500" />
                下载中 <span className="font-medium">{stats?.disk.downloading ?? 0}</span>
              </span>
              <span className="text-muted-foreground">
                共 <span className="font-medium text-foreground">{stats?.disk.total ?? 0}</span> 个文件
              </span>
            </div>
          </div>
        )}
      </section>

      {/* ── 一键清理 ── */}
      <div className="border-t border-border pt-4">
        <button
          onClick={() => handleClear('all')}
          disabled={clearing !== null}
          className="flex items-center gap-2 rounded-full bg-destructive px-6 py-2.5 text-sm font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
        >
          {clearing === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          一键清理全部缓存
        </button>
        <p className="mt-2 text-xs text-muted-foreground">
          清理内存缓存和磁盘缓存，磁盘文件删除后不可恢复
        </p>
      </div>
    </div>
  )
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)}MB`
  if (n >= 1024) return `${(n / 1024).toFixed(2)}KB`
  return `${n}B`
}
