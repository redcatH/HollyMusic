/**
 * 推荐任务的单 worker 调度 + 数据访问（进程内）。
 *
 * 单 worker 保证：`running` 单例 + 串行 runLoop，同一时刻只跑一个任务，其余 status=queued 排队，
 * 由 runLoop 下一轮 findFirst 拾取。新任务 enqueue 时若已有循环在跑就不启新循环。
 *
 * API key 不落 DB：runtimeKeys Map 只在内存持有（taskId -> key），跑完即弃。
 *
 * 启动恢复：进程内状态在服务重启时丢失，resetZombiesIfIdle 把残留的 running 任务标记 interrupted
 * （在 listTasks/getTask 入口调，worker 空闲时才清，避免误伤在跑任务）。
 */
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import type { TaskStatus, TaskConfig, TaskProgress, RecommendTaskView } from '@/lib/types/recommend-task'
import { DEFAULT_PROMPT_SYSTEM, DEFAULT_PROMPT_USER } from '@/lib/recommend-defaults'
import { runRecommendTask } from './recommend-engine'

// ============ 类型 ============
export interface CreateTaskInput {
  name: string
  artists: string[]
  config: Partial<TaskConfig>
  apiKey: string
  createdBy?: string
}

// ============ 进程内状态 ============
let running: Promise<void> | null = null
let currentTaskId: string | null = null
const runtimeKeys = new Map<string, string>() // taskId -> apiKey（内存，不落盘）
const cancelFlags = new Set<string>()

// ============ 工具 ============
function clamp(v: unknown, min: number, max: number, dft: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return dft
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const VALID_SOURCES = ['kw', 'kg', 'tx', 'wy', 'mg']

/** 填默认值 + 校验范围（容错：字段缺失/类型错用默认值，不抛错） */
export function normalizeConfig(c: Partial<TaskConfig> | undefined): TaskConfig {
  const sources = Array.isArray(c?.sources)
    ? c!.sources.filter((s) => VALID_SOURCES.includes(s))
    : []
  if (!sources.length) sources.push('tx') // 默认 tx
  return {
    sources,
    perSource: clamp(c?.perSource, 1, 100, 30),
    maxCandidates: clamp(c?.maxCandidates, 1, 200, 60),
    concurrency: clamp(c?.concurrency, 1, 8, 1),
    openaiBaseUrl: c?.openaiBaseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    openaiModel: c?.openaiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    extraBody: isPlainObject(c?.extraBody) ? c!.extraBody : {},
    promptSystem: typeof c?.promptSystem === 'string' && c!.promptSystem.trim() ? c!.promptSystem : DEFAULT_PROMPT_SYSTEM,
    promptUser: typeof c?.promptUser === 'string' && c!.promptUser.trim() ? c!.promptUser : DEFAULT_PROMPT_USER,
  }
}

function emptyProgress(total: number): TaskProgress {
  return { total, done: 0, currentArtist: null, results: [], selectedTotal: 0, addedTotal: 0, failedTotal: 0 }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToView(row: any): RecommendTaskView {
  let config: TaskConfig
  let progress: TaskProgress
  let artists: string[]
  try {
    config = JSON.parse(row.configJson)
  } catch {
    config = normalizeConfig({})
  }
  try {
    progress = JSON.parse(row.progressJson)
  } catch {
    progress = emptyProgress(0)
  }
  try {
    artists = JSON.parse(row.artistsJson)
  } catch {
    artists = []
  }
  return {
    id: row.id,
    name: row.name,
    artists,
    config,
    status: row.status as TaskStatus,
    progress,
    error: row.error,
    createdBy: row.createdBy,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    startedAt: row.startedAt ? (row.startedAt instanceof Date ? row.startedAt.toISOString() : String(row.startedAt)) : null,
    finishedAt: row.finishedAt ? (row.finishedAt instanceof Date ? row.finishedAt.toISOString() : String(row.finishedAt)) : null,
  }
}

// ============ 对外数据操作 ============
export async function listTasks(page = 1, limit = 50, status?: string): Promise<{ list: RecommendTaskView[]; total: number }> {
  await resetZombiesIfIdle()
  const take = Math.max(1, Math.min(limit, 200))
  const skip = Math.max(0, page - 1) * take
  const where = status && status !== 'all' ? { status } : {}
  const [rows, total] = await Promise.all([
    prisma.recommendTask.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.recommendTask.count({ where }),
  ])
  return { list: rows.map(rowToView), total }
}

export async function getTask(id: string): Promise<RecommendTaskView | null> {
  await resetZombiesIfIdle()
  const row = await prisma.recommendTask.findUnique({ where: { id } })
  return row ? rowToView(row) : null
}

export async function createTask(input: CreateTaskInput): Promise<RecommendTaskView> {
  const artists = Array.from(new Set((input.artists || []).map((s) => String(s).trim()).filter(Boolean)))
  if (!artists.length) throw new Error('歌手列表为空')
  const config = normalizeConfig(input.config)
  const name = (input.name || '').trim() || `推荐任务 ${artists.length} 位歌手`
  const row = await prisma.recommendTask.create({
    data: {
      name,
      artistsJson: JSON.stringify(artists),
      configJson: JSON.stringify(config),
      status: 'queued',
      progressJson: JSON.stringify(emptyProgress(artists.length)),
      createdBy: input.createdBy || null,
    },
  })
  if (input.apiKey) runtimeKeys.set(row.id, input.apiKey)
  enqueue()
  return rowToView(row)
}

/**
 * 重跑：重置为 queued。artists 不变（重跑同一批歌手），config 可选覆盖（改提示词/URL/模型等）。
 * configOverride 提供则与原 config 合并后重新归一化校验；不提供则完全复用原 config。
 */
export async function rerunTask(
  id: string,
  apiKey: string,
  configOverride?: Partial<TaskConfig>,
): Promise<RecommendTaskView | null> {
  const row = await prisma.recommendTask.findUnique({ where: { id } })
  if (!row) return null
  // 正在跑的任务不允许重跑（先取消或等完成）
  if (row.status === 'running') throw new Error('任务正在执行，无法重跑')

  let prevConfig: TaskConfig
  try {
    prevConfig = JSON.parse(row.configJson)
  } catch {
    prevConfig = normalizeConfig({})
  }
  const config = configOverride ? normalizeConfig({ ...prevConfig, ...configOverride }) : prevConfig

  let total = 0
  try {
    total = JSON.parse(row.artistsJson).length
  } catch {
    total = 0
  }
  if (apiKey) runtimeKeys.set(id, apiKey)
  await prisma.recommendTask.update({
    where: { id },
    data: {
      status: 'queued',
      configJson: JSON.stringify(config),
      progressJson: JSON.stringify(emptyProgress(total)),
      error: null,
      startedAt: null,
      finishedAt: null,
    },
  })
  enqueue()
  const refreshed = await prisma.recommendTask.findUnique({ where: { id } })
  return refreshed ? rowToView(refreshed) : null
}

/** 取消：queued 直接 cancelled；running 设 cancelFlag，worker 当前歌手跑完后停 */
export async function cancelTask(id: string): Promise<RecommendTaskView | null> {
  cancelFlags.add(id)
  const row = await prisma.recommendTask.findUnique({ where: { id }, select: { status: true } })
  if (!row) return null
  if (row.status === 'queued') {
    await prisma.recommendTask
      .update({ where: { id }, data: { status: 'cancelled', finishedAt: new Date() } })
      .catch(() => {})
    runtimeKeys.delete(id)
  }
  // running 的：cancelFlag 已设，worker 会在 markDone 时写 cancelled
  const refreshed = await prisma.recommendTask.findUnique({ where: { id } })
  return refreshed ? rowToView(refreshed) : null
}

export async function deleteTask(id: string): Promise<void> {
  cancelFlags.add(id) // 若在跑，尽快停止提交新歌手
  runtimeKeys.delete(id)
  await prisma.recommendTask.delete({ where: { id } }).catch(() => {})
}

/** worker 空闲时，把残留的 running（上次中断）标记 interrupted */
export async function resetZombiesIfIdle(): Promise<void> {
  if (running !== null) return // worker 在跑，running 是真任务，不碰
  await prisma.recommendTask
    .updateMany({
      where: { status: 'running' },
      data: { status: 'interrupted', finishedAt: new Date(), error: '服务重启或异常中断（进程内状态丢失），请重跑' },
    })
    .catch((e) => logger.warn('[recommend-worker] resetZombies failed', e))
}

// ============ 调度 ============
function enqueue() {
  if (running) return // 已有循环在跑，新任务由下一轮 findFirst 拾取
  running = runLoop()
    .catch((e) => logger.error('[recommend-worker] runLoop crashed', e))
    .finally(() => {
      running = null
    })
}

async function runLoop() {
  while (true) {
    const task = await prisma.recommendTask.findFirst({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' },
    })
    if (!task) break
    await runOne(task)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runOne(task: any) {
  currentTaskId = task.id
  const apiKey = runtimeKeys.get(task.id) || process.env.OPENAI_API_KEY || ''

  let config: TaskConfig
  let artists: string[]
  try {
    config = JSON.parse(task.configJson)
    artists = JSON.parse(task.artistsJson)
  } catch {
    await markFailed(task.id, '任务配置解析失败')
    return
  }

  const progress = emptyProgress(artists.length)
  await prisma.recommendTask
    .update({
      where: { id: task.id },
      data: { status: 'running', startedAt: new Date(), progressJson: JSON.stringify(progress), error: null },
    })
    .catch(() => {})

  logger.info(`[recommend-worker] 开始任务 ${task.id} (${task.name}): ${artists.length} 位歌手`)

  try {
    const { interrupted } = await runRecommendTask(
      { artists, config: { ...config, apiKey } },
      async (p) => {
        // 内存 progress 是唯一真相源（单 worker 串行回调），覆盖写 DB 无竞态
        progress.results.push(p.result)
        progress.done = p.done
        progress.currentArtist = p.currentArtist
        progress.selectedTotal += p.result.selected || 0
        progress.addedTotal += p.result.added || 0
        if (!p.result.ok) progress.failedTotal += 1
        await prisma.recommendTask
          .update({ where: { id: task.id }, data: { progressJson: JSON.stringify(progress) } })
          .catch((e) => logger.warn('[recommend-worker] progress flush failed', e))
      },
      () => cancelFlags.has(task.id),
    )
    progress.currentArtist = null
    const cancelled = cancelFlags.has(task.id)
    await prisma.recommendTask
      .update({
        where: { id: task.id },
        data: {
          status: cancelled ? 'cancelled' : interrupted ? 'interrupted' : 'done',
          progressJson: JSON.stringify(progress),
          finishedAt: new Date(),
        },
      })
      .catch(() => {})
    logger.info(`[recommend-worker] 任务 ${task.id} 结束: ${cancelled ? 'cancelled' : interrupted ? 'interrupted' : 'done'}`)
  } catch (e) {
    await markFailed(task.id, e instanceof Error ? e.message : String(e))
  } finally {
    runtimeKeys.delete(task.id)
    cancelFlags.delete(task.id)
    currentTaskId = null
  }
}

async function markFailed(id: string, msg: string) {
  await prisma.recommendTask
    .update({ where: { id }, data: { status: 'failed', error: msg, finishedAt: new Date() } })
    .catch(() => {})
}

/** 当前是否有任务在跑（前端据此决定是否轮询） */
export function isWorkerBusy(): boolean {
  return currentTaskId !== null
}
