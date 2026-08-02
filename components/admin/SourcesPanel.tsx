
/**
 * 音源管理面板（admin Tab 子组件）。
 * 从 app/admin/sources/page.tsx 抽取，逻辑不变，去掉页面壳与鉴权重定向。
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  listSources,
  createSource,
  updateSource,
  deleteSource,
  uploadScript,
  type AdminSource,
} from '@/lib/api/admin-sources'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Plus, Pencil, Trash2, Music, X, Loader2, Upload, AlertCircle, CheckCircle2, FileWarning } from 'lucide-react'

const PLATFORMS = ['tx', 'wy', 'kw', 'kg', 'mg'] as const
const PLATFORM_LABELS: Record<string, string> = {
  tx: '腾讯',
  wy: '网易',
  kw: '酷我',
  kg: '酷狗',
  mg: '咪咕',
}

type DialogMode =
  | { kind: 'create' }
  | { kind: 'edit'; source: AdminSource }
  | null

export function SourcesPanel() {
  const [sources, setSources] = useState<AdminSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogMode>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { list } = await listSources()
      setSources(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const handleUpload = async (file: File) => {
    setUploading(true)
    setUploadMsg(null)
    try {
      await uploadScript(file)
      setUploadMsg({ kind: 'success', text: `脚本「${file.name}」上传成功，已自动注册` })
      await reload()
    } catch (e) {
      setUploadMsg({ kind: 'error', text: e instanceof Error ? e.message : '上传失败' })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleCreated = async (opts: {
    path: string
    name?: string
    description?: string
    priority?: number
    timeout?: number
    enabled?: boolean
    pt?: string[]
  }) => {
    await createSource(opts)
    setDialog(null)
    await reload()
  }

  const handleUpdated = async (
    sourcePath: string,
    opts: Parameters<typeof updateSource>[1]
  ) => {
    await updateSource(sourcePath, opts)
    setDialog(null)
    await reload()
  }

  const handleDelete = async (s: AdminSource) => {
    if (!confirm(`确定删除音源「${s.name || s.path}」？关联的脚本文件也会被删除。`)) return
    try {
      await deleteSource(s.path)
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : '删除失败')
    }
  }

  const toggleEnabled = async (s: AdminSource) => {
    try {
      await updateSource(s.path, { enabled: !s.enabled })
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : '操作失败')
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <Music className="h-5 w-5 text-primary" />
            音源管理
          </h2>
          <p className="text-sm text-muted-foreground">管理自定义音源脚本与配置</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".js"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) handleUpload(f)
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? '上传中…' : '上传脚本'}
          </button>
          <button
            onClick={() => setDialog({ kind: 'create' })}
            className="flex items-center gap-1 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            <Plus className="h-4 w-4" /> 手动添加
          </button>
        </div>
      </div>

      {uploadMsg && (
        <div
          className={`mb-4 flex items-center gap-2 rounded-md px-4 py-2 text-sm ${
            uploadMsg.kind === 'success'
              ? 'bg-green-500/10 text-green-600'
              : 'bg-destructive/10 text-destructive'
          }`}
        >
          {uploadMsg.kind === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span className="flex-1 break-all">{uploadMsg.text}</span>
          <button onClick={() => setUploadMsg(null)} className="text-current/70 hover:text-current">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {loading ? (
        <LoadingSkeleton count={5} />
      ) : error ? (
        <EmptyState icon={Music} title="加载失败" description={error} />
      ) : sources.length === 0 ? (
        <EmptyState icon={Music} title="暂无音源" description="上传脚本或手动添加音源配置" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-accent/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">名称</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">优先级</th>
                <th className="px-4 py-3 font-medium">平台</th>
                <th className="px-4 py-3 font-medium">脚本路径</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {sources.map(s => (
                <tr key={s.path} className="border-t border-border hover:bg-accent/20">
                  <td className="px-4 py-3 font-medium">
                    {s.name || s.path}
                    {s.description && (
                      <span className="ml-2 text-xs text-muted-foreground">{s.description}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleEnabled(s)}
                      className={`rounded px-2 py-0.5 text-[10px] font-medium transition ${
                        s.enabled
                          ? 'bg-green-500/20 text-green-600'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {s.enabled ? '启用' : '停用'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{s.priority}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(s.pt || []).map(p => (
                        <span
                          key={p}
                          className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary"
                        >
                          {PLATFORM_LABELS[p] || p}
                        </span>
                      ))}
                      {(!s.pt || s.pt.length === 0) && (
                        <span className="text-xs text-muted-foreground">全部</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      {s.scriptExists ? (
                        <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />
                      ) : (
                        <FileWarning className="h-3 w-3 shrink-0 text-amber-500" />
                      )}
                      <span className="max-w-[200px] truncate" title={s.path}>{s.path}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setDialog({ kind: 'edit', source: s })}
                        className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        title="编辑"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(s)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                        title="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <SourceDialog
          mode={dialog}
          onClose={() => setDialog(null)}
          onCreated={handleCreated}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  )
}

interface DialogProps {
  mode: Exclude<DialogMode, null>
  onClose: () => void
  onCreated: (opts: {
    path: string
    name?: string
    description?: string
    priority?: number
    timeout?: number
    enabled?: boolean
    pt?: string[]
  }) => Promise<void>
  onUpdated: (
    sourcePath: string,
    opts: {
      name?: string
      description?: string
      priority?: number
      timeout?: number
      enabled?: boolean
      pt?: string[]
    }
  ) => Promise<void>
}

function SourceDialog({ mode, onClose, onCreated, onUpdated }: DialogProps) {
  const isEdit = mode.kind === 'edit'
  const existing = isEdit ? mode.source : null

  const [path, setPath] = useState(existing?.path || '')
  const [name, setName] = useState(existing?.name || '')
  const [description, setDescription] = useState(existing?.description || '')
  const [priority, setPriority] = useState(String(existing?.priority ?? 1))
  const [timeout, setTimeout] = useState(String(existing?.timeout ?? ''))
  const [enabled, setEnabled] = useState(existing?.enabled ?? true)
  const [pt, setPt] = useState<string[]>(existing?.pt || [])

  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    setSubmitting(true)
    try {
      const priorityNum = parseInt(priority, 10)
      const timeoutNum = timeout.trim() ? parseInt(timeout, 10) : undefined

      const opts = {
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        priority: Number.isFinite(priorityNum) ? priorityNum : undefined,
        timeout: timeoutNum && Number.isFinite(timeoutNum) ? timeoutNum : undefined,
        enabled,
        pt,
      }

      if (isEdit && existing) {
        await onUpdated(existing.path, opts)
      } else {
        if (!path.trim()) throw new Error('脚本路径不能为空')
        await onCreated({ ...opts, path: path.trim() })
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  const togglePlatform = (p: string) => {
    setPt(prev => (prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-card p-6 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{isEdit ? '编辑音源' : '添加音源'}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {!isEdit && (
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">脚本路径 *</span>
              <input
                autoFocus
                value={path}
                onChange={e => setPath(e.target.value)}
                placeholder="custom-sources/xxx.js"
                className="w-full rounded-md bg-background px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary"
              />
              <span className="mt-1 block text-[10px] text-muted-foreground">
                相对项目根目录的路径，推荐放 custom-sources/ 下
              </span>
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">名称</span>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="音源显示名称"
              className="w-full rounded-md bg-background px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">描述</span>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="可选"
              className="w-full rounded-md bg-background px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary"
            />
          </label>

          <div className="flex gap-3">
            <label className="flex-1">
              <span className="mb-1 block text-xs text-muted-foreground">优先级</span>
              <input
                type="number"
                value={priority}
                onChange={e => setPriority(e.target.value)}
                className="w-full rounded-md bg-background px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary"
              />
            </label>
            <label className="flex-1">
              <span className="mb-1 block text-xs text-muted-foreground">超时(ms)</span>
              <input
                type="number"
                value={timeout}
                onChange={e => setTimeout(e.target.value)}
                placeholder="默认"
                className="w-full rounded-md bg-background px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary"
              />
            </label>
          </div>

          <div>
            <span className="mb-1 block text-xs text-muted-foreground">支持平台</span>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={`rounded px-3 py-1 text-xs font-medium transition ${
                    pt.includes(p)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {PLATFORM_LABELS[p]}
                </button>
              ))}
            </div>
            <span className="mt-1 block text-[10px] text-muted-foreground">
              不选则跟随脚本声明，限定后仅对勾选平台生效
            </span>
          </div>

          <label className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded accent-primary"
            />
            <span className="text-sm">启用此音源</span>
          </label>

          {err && <p className="text-xs text-destructive">{err}</p>}

          <div className="flex justify-end gap-2 pt-2">
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
