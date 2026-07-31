/**
 * 音乐播放器类型定义
 */

// 音质类型
export type QualityType = '128k' | '320k' | 'flac' | 'flac24bit'

// 音源类型
export type SourceType = 'kw' | 'kg' | 'tx' | 'wy' | 'mg'

// 音质信息
export interface QualityInfo {
  type: QualityType
  size: string
  hash?: string
}

// 音乐信息
export interface MusicInfo {
  name: string
  singer: string
  source: SourceType
  songmid: string
  albumId?: string
  albumName?: string
  interval: string
  img?: string | null
  types: QualityInfo[]
  _types: Record<QualityType, Partial<QualityInfo>>
  typeUrl: Record<string, string>
  // 特定音源的额外字段
  hash?: string // kg
  copyrightId?: string // mg
  songId?: string | number // tx, wy
  strMediaMid?: string // tx
  albumMid?: string // tx
  lrc?: string | null // wy
  lrcUrl?: string // mg
  mrcUrl?: string // mg
  trcUrl?: string // mg
}

// 带对外唯一 id 的歌曲（前端通用类型）
// uid = `${source}-${存储songmid}`，用于封面/歌词/收藏/历史等所有按歌曲索引的场景
// 注意：MusicInfo 自带的 songId 字段是 tx/wy 的原始音源 id，不可作为对外 id，故新增 uid
export interface Song extends MusicInfo {
  uid: string
}

// 搜索结果
export interface SearchResult {
  list: MusicInfo[]
  total: number
  page: number
  allPage: number
  limit: number
  source: SourceType
}

// 音源配置
export interface SourceConfig {
  path: string
  enabled: boolean
  priority: number
  timeout?: number
  name?: string
  description?: string
  pt?: string[] // 该音源支持的平台列表，用于驱动搜索平台
}

// 音源配置文件
export interface MusicSourcesConfig {
  sources: SourceConfig[]
}

// 缓存条目
export interface CacheEntry<T = unknown> {
  data: T
  expireAt: number
}

// 健康状态
export interface HealthStatus {
  source: string
  name: string
  enabled: boolean
  initialized: boolean
  initTime?: number
  supportedSources: string[]
  supportedActions: Record<string, string[]>
  supportedQualities: Record<string, string[]>
  error?: string
}

// API 响应
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: ApiError
}

// API 错误
export interface ApiError {
  code: string
  message: string
  details?: unknown
}

// 音源信息（来自自定义源脚本）
export interface SourceInfo {
  sources: Record<string, {
    type: string
    actions: string[]
    qualitys: string[]
  }>
}

// LX Environment Simulator 实例配置
export interface LXSimulatorConfig {
  scriptPath: string
  priority: number
  timeout?: number
  name?: string
  description?: string
}
