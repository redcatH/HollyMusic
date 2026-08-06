/**
 * 推荐任务管理面板（admin Tab 子组件）。
 *
 * 把 scripts/auto-recommend.mjs 的能力可视化：创建任务（每行一个歌手）→ 多任务排队 →
 * 单 worker 串行执行（同时只跑一个）→ 实时进度 → 重跑/取消/删除。
 *
 * 重跑时可修改任意参数（提示词/URL/模型/音源/并发等），artists 不变。
 * API key 不落 DB，只在服务端内存里跑完即弃；浏览器用 sessionStorage 暂存方便预填。
 * 提示词可自定义（默认值预填，支持 {{artist}} {{candidates}} 占位符）。
 */

import { useState, useCallback, useEffect } from 'react'
import {
  listRecommendTasks,
  createRecommendTask,
  rerunRecommendTask,
  cancelRecommendTask,
  deleteRecommendTask,
  type RecommendTaskView,
  type TaskStatus,
  type TaskConfig,
} from '@/lib/api/admin-recommend-tasks'
import { DEFAULT_PROMPT_SYSTEM, DEFAULT_PROMPT_USER } from '@/lib/recommend-defaults'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import {
  ListTodo,
  Loader2,
  CheckCircle2,
  XCircle,
  Plus,
  Trash2,
  RefreshCw,
  Play,
  Ban,
  ChevronDown,
  ChevronRight,
  Settings2,
  X,
  KeyRound,
} from 'lucide-react'

const PLATFORMS = ['kw', 'kg', 'tx', 'wy', 'mg'] as const
const SOURCE_SHORT: Record<string, string> = { tx: 'QQ', wy: '网易', kw: '酷我', kg: '酷狗', mg: '咪咕' }
const SOURCE_COLORS: Record<string, string> = {
  tx: 'bg-green-500/20 text-green-400',
  wy: 'bg-red-500/20 text-red-400',
  kw: 'bg-yellow-500/20 text-yellow-400',
  kg: 'bg-blue-500/20 text-blue-400',
  mg: 'bg-purple-500/20 text-purple-400',
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: '排队中',
  running: '执行中',
  done: '已完成',
  failed: '失败',
  interrupted: '已中断',
  cancelled: '已取消',
}
const STATUS_STYLE: Record<TaskStatus, string> = {
  queued: 'bg-yellow-500/15 text-yellow-600',
  running: 'bg-blue-500/15 text-blue-600',
  done: 'bg-green-500/15 text-green-600',
  failed: 'bg-destructive/15 text-destructive',
  interrupted: 'bg-orange-500/15 text-orange-600',
  cancelled: 'bg-muted text-muted-foreground',
}

// sessionStorage 暂存 key/baseUrl/model（不进 localStorage，符合"临时使用"）
const STORE_KEY = 'recommend-task-creds'
type Creds = { apiKey: string; baseUrl: string; model: string }
function loadCreds(): Creds {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    if (raw) return { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
}
function saveCreds(c: Creds) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(c))
  } catch {
    /* ignore */
  }
}

function parseExtraBody(text: string): Record<string, unknown> {
  const t = text.trim()
  if (!t) return {}
  try {
    const v = JSON.parse(t)
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

// ============ 共享：config 字段（创建表单 + 重跑弹窗复用）============
interface ConfigFieldsProps {
  sources: string[]
  onSources: (v: string[]) => void
  concurrency: number
  onConcurrency: (v: number) => void
  baseUrl: string
  onBaseUrl: (v: string) => void
  model: string
  onModel: (v: string) => void
  apiKey: string
  onApiKey: (v: string) => void
  extraBody: string
  onExtraBody: (v: string) => void
  promptSystem: string
  onPromptSystem: (v: string) => void
  promptUser: string
  onPromptUser: (v: string) => void
  showAdvanced: boolean
  onShowAdvanced: (v: boolean) => void
}

function ConfigFields(p: ConfigFieldsProps) {
  const toggleSource = (src: string) =>
    p.onSources(p.sources.includes(src) ? p.sources.filter((s) => s !== src) : [...p.sources, src])
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">并发歌手数</label>
          <input
            type="number"
            min={1}
            max={8}
            value={p.concurrency}
            onChange={(e) => p.onConcurrency(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
            className="w-full rounded-md bg-background px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">搜索音源（按优先级，跨源去重时排在前面的优先保留）</label>
          <div className="flex flex-wrap gap-2 pt-1.5">
            {PLATFORMS.map((src) => {
              const active = p.sources.includes(src)
              return (
                <button
                  key={src}
                  onClick={() => toggleSource(src)}
                  className={`rounded px-3 py-1 text-xs font-medium ring-1 transition ${
                    active ? `${SOURCE_COLORS[src]} ring-current` : 'bg-muted text-muted-foreground ring-transparent hover:opacity-80'
                  }`}
                >
                  {SOURCE_SHORT[src]}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs text-muted-foreground">API Base URL</label>
          <input
            value={p.baseUrl}
            onChange={(e) => p.onBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            className="w-full rounded-md bg-background px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">模型</label>
          <input
            value={p.model}
            onChange={(e) => p.onModel(e.target.value)}
            placeholder="gpt-4o-mini"
            className="w-full rounded-md bg-background px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          <KeyRound className="h-3 w-3" /> API Key（临时使用，不落库；留空则用服务端 OPENAI_API_KEY）
        </label>
        <input
          type="password"
          value={p.apiKey}
          onChange={(e) => p.onApiKey(e.target.value)}
          placeholder="sk-..."
          autoComplete="off"
          className="w-full rounded-md bg-background px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary"
        />
      </div>

      <div>
        <button
          onClick={() => p.onShowAdvanced(!p.showAdvanced)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Settings2 className="h-3.5 w-3.5" />
          {p.showAdvanced ? '收起高级选项' : '展开高级选项（提示词 / extraBody）'}
        </button>
        {p.showAdvanced && (
          <div className="mt-3 space-y-3 rounded-md bg-accent/20 p-3">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs text-muted-foreground">System 提示词</label>
                <button onClick={() => p.onPromptSystem(DEFAULT_PROMPT_SYSTEM)} className="text-[10px] text-primary hover:underline">
                  恢复默认
                </button>
              </div>
              <textarea
                value={p.promptSystem}
                onChange={(e) => p.onPromptSystem(e.target.value)}
                rows={2}
                className="w-full rounded-md bg-background px-3 py-2 text-xs outline-none ring-1 ring-border focus:ring-primary"
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs text-muted-foreground">
                  User 提示词（支持 <code className="rounded bg-muted px-1">{'{{artist}}'}</code>{' '}
                  <code className="rounded bg-muted px-1">{'{{candidates}}'}</code> 占位符）
                </label>
                <button onClick={() => p.onPromptUser(DEFAULT_PROMPT_USER)} className="text-[10px] text-primary hover:underline">
                  恢复默认
                </button>
              </div>
              <textarea
                value={p.promptUser}
                onChange={(e) => p.onPromptUser(e.target.value)}
                rows={10}
                className="w-full rounded-md bg-background px-3 py-2 text-xs outline-none ring-1 ring-border focus:ring-primary"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                返回格式必须保持 <code className="rounded bg-muted px-1">{`{"selected":[...],"dropped":{...}}`}</code>，否则对应歌手判失败。
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                额外请求体 extraBody（JSON，逃生舱：reasoning_effort / thinking 等）
              </label>
              <textarea
                value={p.extraBody}
                onChange={(e) => p.onExtraBody(e.target.value)}
                placeholder='{}'
                rows={2}
                className="w-full rounded-md bg-background px-3 py-2 font-mono text-xs outline-none ring-1 ring-border focus:ring-primary"
              />
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ============ 重跑弹窗的可编辑表单状态 ============
interface RerunForm {
  target: RecommendTaskView
  key: string
  sources: string[]
  concurrency: number
  baseUrl: string
  model: string
  extraBody: string
  promptSystem: string
  promptUser: string
  showAdvanced: boolean
}

export function RecommendTaskPanel() {
  // ── 任务列表 ──
  const [tasks, setTasks] = useState<RecommendTaskView[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // ── 创建表单 ──
  const initialCreds = loadCreds()
  const [name, setName] = useState('')
  const [artistsText, setArtistsText] = useState('')
  const [sources, setSources] = useState<string[]>(['tx'])
  const [concurrency, setConcurrency] = useState(1)
  const [apiKey, setApiKey] = useState(initialCreds.apiKey)
  const [baseUrl, setBaseUrl] = useState(initialCreds.baseUrl)
  const [model, setModel] = useState(initialCreds.model)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [extraBodyText, setExtraBodyText] = useState('')
  const [promptSystem, setPromptSystem] = useState(DEFAULT_PROMPT_SYSTEM)
  const [promptUser, setPromptUser] = useState(DEFAULT_PROMPT_USER)

  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  // ── 重跑弹窗（可编辑全部参数后重跑）──
  const [rerun, setRerun] = useState<RerunForm | null>(null)
  const updateRerun = (patch: Partial<RerunForm>) => setRerun((r) => (r ? { ...r, ...patch } : r))

  const reload = useCallback(async () => {
    setListError(null)
    try {
      const res = await listRecommendTasks(1, 100)
      setTasks(res.list)
    } catch (e) {
      setListError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // 有活跃任务时自动轮询（辅助）；手动刷新是主入口
  const hasActive = tasks.some((t) => t.status === 'running' || t.status === 'queued')
  useEffect(() => {
    if (!hasActive) return
    const t = setInterval(reload, 2500)
    return () => clearInterval(t)
  }, [hasActive, reload])

  const handleCreate = async () => {
    const artists = artistsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (artists.length === 0) {
      setMsg({ kind: 'error', text: '歌手列表不能为空（每行一个歌手）' })
      return
    }
    if (sources.length === 0) {
      setMsg({ kind: 'error', text: '至少选择一个音源' })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const config: Partial<TaskConfig> = {
        sources,
        concurrency,
        openaiBaseUrl: baseUrl.trim() || 'https://api.openai.com/v1',
        openaiModel: model.trim() || 'gpt-4o-mini',
        extraBody: parseExtraBody(extraBodyText),
        promptSystem,
        promptUser,
      }
      await createRecommendTask({ name: name.trim(), artists, config, apiKey: apiKey.trim() })
      saveCreds({ apiKey: apiKey.trim(), baseUrl, model })
      setMsg({ kind: 'success', text: `任务已创建，${artists.length} 位歌手已入队` })
      setName('')
      setArtistsText('')
      await reload()
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : '创建任务失败' })
    } finally {
      setBusy(false)
    }
  }

  const handleCancel = async (id: string) => {
    if (!confirm('确定取消该任务？正在跑的歌手会在当前完成后停止。')) return
    try {
      await cancelRecommendTask(id)
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : '取消失败')
    }
  }

  const handleDelete = async (t: RecommendTaskView) => {
    if (!confirm(`确定删除任务「${t.name}」？此操作不可恢复（不影响已加入推荐的歌曲）。`)) return
    try {
      await deleteRecommendTask(t.id)
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : '删除失败')
    }
  }

  const openRerun = (t: RecommendTaskView) => {
    setRerun({
      target: t,
      key: apiKey || loadCreds().apiKey,
      sources: t.config.sources,
      concurrency: t.config.concurrency,
      baseUrl: t.config.openaiBaseUrl,
      model: t.config.openaiModel,
      extraBody:
        t.config.extraBody && Object.keys(t.config.extraBody).length ? JSON.stringify(t.config.extraBody, null, 2) : '',
      promptSystem: t.config.promptSystem,
      promptUser: t.config.promptUser,
      showAdvanced: false,
    })
  }

  const handleRerun = async () => {
    if (!rerun) return
    if (rerun.sources.length === 0) {
      alert('至少选择一个音源')
      return
    }
    setBusy(true)
    try {
      const config: Partial<TaskConfig> = {
        sources: rerun.sources,
        concurrency: rerun.concurrency,
        openaiBaseUrl: rerun.baseUrl.trim() || 'https://api.openai.com/v1',
        openaiModel: rerun.model.trim() || 'gpt-4o-mini',
        extraBody: parseExtraBody(rerun.extraBody),
        promptSystem: rerun.promptSystem,
        promptUser: rerun.promptUser,
      }
      await rerunRecommendTask(rerun.target.id, { apiKey: rerun.key.trim(), config })
      saveCreds({ apiKey: rerun.key.trim(), baseUrl: rerun.baseUrl, model: rerun.model })
      setRerun(null)
      setMsg({ kind: 'success', text: '任务已按新参数重新入队' })
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : '重跑失败')
    } finally {
      setBusy(false)
    }
  }

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <ListTodo className="h-5 w-5 text-primary" />
          推荐任务
        </h2>
        <p className="text-sm text-muted-foreground">
          按歌手批量跑 AI 筛选并加入推荐白名单。多任务排队，同一时刻只执行一个。
        </p>
      </div>

      {msg && (
        <div
          className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm ${
            msg.kind === 'success' ? 'bg-green-500/10 text-green-600' : 'bg-destructive/10 text-destructive'
          }`}
        >
          {msg.kind === 'success' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <X className="h-4 w-4 shrink-0" />}
          <span className="flex-1 break-all">{msg.text}</span>
          <button onClick={() => setMsg(null)} className="text-current/70 hover:text-current">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 创建表单 */}
      <div className="rounded-lg border border-border p-4 space-y-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">任务名（可选）</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：华语流行补充"
            className="w-full rounded-md bg-background px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">歌手名单（每行一个）</label>
          <textarea
            value={artistsText}
            onChange={(e) => setArtistsText(e.target.value)}
            placeholder={'周杰伦\n林俊杰\n陈奕迅'}
            rows={4}
            className="w-full rounded-md bg-background px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary"
          />
        </div>

        <ConfigFields
          sources={sources}
          onSources={setSources}
          concurrency={concurrency}
          onConcurrency={setConcurrency}
          baseUrl={baseUrl}
          onBaseUrl={setBaseUrl}
          model={model}
          onModel={setModel}
          apiKey={apiKey}
          onApiKey={setApiKey}
          extraBody={extraBodyText}
          onExtraBody={setExtraBodyText}
          promptSystem={promptSystem}
          onPromptSystem={setPromptSystem}
          promptUser={promptUser}
          onPromptUser={setPromptUser}
          showAdvanced={showAdvanced}
          onShowAdvanced={setShowAdvanced}
        />

        <div className="flex justify-end">
          <button
            onClick={handleCreate}
            disabled={busy}
            className="flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            创建任务
          </button>
        </div>
      </div>

      {/* 工具栏：刷新 */}
      <div className="flex items-center justify-between border-b border-border pb-2">
        <span className="text-sm text-muted-foreground">任务列表{tasks.length > 0 ? ` (${tasks.length})` : ''}</span>
        <button
          onClick={reload}
          disabled={loading}
          className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          刷新
        </button>
      </div>

      {/* 任务列表 */}
      {loading ? (
        <LoadingSkeleton count={3} />
      ) : listError ? (
        <EmptyState icon={ListTodo} title="加载失败" description={listError} />
      ) : tasks.length === 0 ? (
        <EmptyState icon={ListTodo} title="暂无任务" description="在上方创建第一个推荐任务" />
      ) : (
        <div className="space-y-3">
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              expanded={expanded.has(t.id)}
              onToggleExpand={() => toggleExpand(t.id)}
              onCancel={() => handleCancel(t.id)}
              onDelete={() => handleDelete(t)}
              onRerun={() => openRerun(t)}
            />
          ))}
        </div>
      )}

      {/* 重跑弹窗：可编辑全部参数 */}
      {rerun && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !busy && setRerun(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-background p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold">重跑任务「{rerun.target.name}」</h3>
              <button onClick={() => setRerun(null)} disabled={busy} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              可修改任意参数后重跑（{rerun.target.artists.length} 位歌手不变，已推荐的歌曲会自动跳过）。提示词/URL/模型/音源都可在此调整。
            </p>
            <div className="space-y-3">
              <ConfigFields
                sources={rerun.sources}
                onSources={(v) => updateRerun({ sources: v })}
                concurrency={rerun.concurrency}
                onConcurrency={(v) => updateRerun({ concurrency: v })}
                baseUrl={rerun.baseUrl}
                onBaseUrl={(v) => updateRerun({ baseUrl: v })}
                model={rerun.model}
                onModel={(v) => updateRerun({ model: v })}
                apiKey={rerun.key}
                onApiKey={(v) => updateRerun({ key: v })}
                extraBody={rerun.extraBody}
                onExtraBody={(v) => updateRerun({ extraBody: v })}
                promptSystem={rerun.promptSystem}
                onPromptSystem={(v) => updateRerun({ promptSystem: v })}
                promptUser={rerun.promptUser}
                onPromptUser={(v) => updateRerun({ promptUser: v })}
                showAdvanced={rerun.showAdvanced}
                onShowAdvanced={(v) => updateRerun({ showAdvanced: v })}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setRerun(null)}
                disabled={busy}
                className="rounded-full border border-border px-4 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleRerun}
                disabled={busy}
                className="flex items-center gap-1 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                按新参数重跑
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============ 任务卡片 ============
function TaskCard({
  task,
  expanded,
  onToggleExpand,
  onCancel,
  onDelete,
  onRerun,
}: {
  task: RecommendTaskView
  expanded: boolean
  onToggleExpand: () => void
  onCancel: () => void
  onDelete: () => void
  onRerun: () => void
}) {
  const p = task.progress
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0
  const isActive = task.status === 'running' || task.status === 'queued'
  const finished = task.status === 'done' || task.status === 'failed' || task.status === 'interrupted' || task.status === 'cancelled'

  return (
    <div className="rounded-lg border border-border p-4">
      {/* 头部：名称 + 状态 + 操作 */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[task.status]}`}>
              {task.status === 'running' && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
              {STATUS_LABEL[task.status]}
            </span>
            <span className="truncate text-sm font-medium">{task.name}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>{task.artists.length} 位歌手</span>
            <span>音源 {task.config.sources.join('/')}</span>
            <span>模型 {task.config.openaiModel}</span>
            {task.createdAt && <span>{new Date(task.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isActive && (
            <button onClick={onCancel} title="取消" className="rounded p-1.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive">
              <Ban className="h-4 w-4" />
            </button>
          )}
          {finished && (
            <button onClick={onRerun} title="重跑（可改参数）" className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
              <Play className="h-4 w-4" />
            </button>
          )}
          <button onClick={onDelete} title="删除" className="rounded p-1.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 进度条 */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {p.done}/{p.total} 歌手
            {task.status === 'running' && p.currentArtist ? ` · 正在处理：${p.currentArtist}` : ''}
          </span>
          <span>{pct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* 汇总统计 */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
        <span className="text-green-600">选中 {p.selectedTotal}</span>
        <span className="text-blue-600">加入推荐 {p.addedTotal}</span>
        {p.failedTotal > 0 && <span className="text-destructive">失败 {p.failedTotal}</span>}
        {task.error && <span className="break-all text-destructive">错误：{task.error}</span>}
      </div>

      {/* 展开明细 */}
      {p.results.length > 0 && (
        <div className="mt-2">
          <button onClick={onToggleExpand} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            歌手明细（{p.results.length}）
          </button>
          {expanded && (
            <div className="mt-1 divide-y divide-border rounded-md border border-border px-2">
              {p.results.map((r, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5 text-xs">
                  {r.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />}
                  <span className="min-w-0 flex-1 truncate">{r.artist}</span>
                  {r.ok && (r.selected || 0) > 0 && <span className="shrink-0 text-muted-foreground">选中 {r.selected} · 加入 {r.added}</span>}
                  {r.ok && (r.selected || 0) === 0 && r.reason && <span className="shrink-0 text-muted-foreground">{r.reason}</span>}
                  {(r.skipped || 0) > 0 && <span className="shrink-0 text-muted-foreground">跳过 {r.skipped}</span>}
                  {!r.ok && r.reason && <span className="max-w-[50%] shrink-0 truncate text-destructive" title={r.reason}>{r.reason}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
