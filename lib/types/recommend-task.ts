/**
 * 推荐任务的共享类型（前后端都用，纯类型无副作用，前端 import 不会拉入 prisma）。
 */

export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'interrupted' | 'cancelled'

// 任务类型：artists=按歌手筛本人正规版；songs=按歌曲在多版本里挑大众认可的好版本
export type TaskType = 'artists' | 'songs'

export interface ArtistResult {
  artist: string // 复用为"主体标签"：artist 模式=歌手名，song 模式=歌曲名
  ok: boolean
  selected?: number // AI 选中数
  added?: number // 实际加入白名单数
  skipped?: number // 跳过（已在白名单）数
  reason?: string // 失败/跳过原因
  // 本主体实际写入推荐白名单的 uid 列表（source-songmid）。
  // 仅在成功加入时填充，回滚时据此精确撤销；旧任务无此字段则不可回滚。
  addedUids?: string[]
}

export interface TaskConfig {
  sources: string[]
  perSource: number
  maxCandidates: number
  concurrency: number
  openaiBaseUrl: string
  openaiModel: string
  extraBody: Record<string, unknown>
  promptSystem: string
  promptUser: string // 含 {{artist}} {{candidates}} 占位符
}

export interface TaskProgress {
  total: number
  done: number
  currentArtist: string | null
  results: ArtistResult[]
  selectedTotal: number
  addedTotal: number
  failedTotal: number
  // 回滚时间戳（ISO）。非空表示该任务推荐的歌曲已被撤销回滚。
  // rerun 会重置 progress，此字段随之清空。
  rolledBackAt?: string | null
}

export interface RecommendTaskView {
  id: string
  name: string
  taskType: TaskType
  artists: string[]
  config: TaskConfig
  status: TaskStatus
  progress: TaskProgress
  error: string | null
  createdBy: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}
