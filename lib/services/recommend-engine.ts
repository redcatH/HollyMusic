/**
 * 推荐任务执行引擎（从 scripts/auto-recommend.mjs 抽取）
 *
 * 与脚本的区别：在服务端进程内运行，直接调 lib 函数（musicSearch.search + upsertMusicInfo
 * + setRecommendedBatch），不需要 login/cookie/HTTP——脚本要登录是因为它是外部进程。
 *
 * 提示词参数化：config.promptSystem / config.promptUser 支持自定义，用 {{artist}} {{candidates}}
 * 占位符，engine 每歌手替换。默认值见 DEFAULT_PROMPT_*。
 *
 * 容错原则：单个歌手失败（含缺 API key、AI 返回异常）只标记该歌手失败，不中断整个任务。
 */
import { setTimeout as sleep } from 'node:timers/promises'
import {
  upsertMusicInfo,
  getStorageSongmidForMusicInfo,
  setRecommendedBatch,
  listRecommendedMusicInfo,
} from '@/lib/db'
import { logger } from '@/lib/logger'
import type { MusicInfo } from '@/lib/types/music'
import type { ArtistResult } from '@/lib/types/recommend-task'

// music-search.js 是 ESM 导出的 JS 模块（search 用 this[source] 分发），照搬 search route 的 require 用法
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const musicSearch = require('@/lib/music-core/music-search')

// ============ 类型 ============
export interface EngineConfig {
  sources: string[]
  perSource: number
  maxCandidates: number
  concurrency: number
  openaiBaseUrl: string
  openaiModel: string
  apiKey: string // 内存传入，不持久化（worker 注入）
  extraBody: Record<string, unknown>
  promptSystem: string
  promptUser: string // 含 {{artist}} {{candidates}} 占位符
}

export interface RunProgress {
  done: number
  currentArtist: string | null
  result: ArtistResult
}

type SongWithUid = MusicInfo & { uid: string }

// ============ AI 调用（重试 + 思考模型处理，照搬脚本）============
async function callAI(config: EngineConfig, messages: { role: string; content: string }[]): Promise<string> {
  if (!config.apiKey) throw new Error('缺少 API key（创建任务时未填写，且服务端未配置 OPENAI_API_KEY）')
  // 开了思考就不强制 temperature:0（多数思考模型禁止设温度）；extraBody 在最后展开，可覆盖任意默认字段
  const wantsThinking = 'reasoning_effort' in config.extraBody || 'thinking' in config.extraBody
  for (let i = 0; i < 15; i++) {
    let res: Response
    try {
      res = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.openaiModel,
          messages,
          ...(wantsThinking ? {} : { temperature: 0 }),
          response_format: { type: 'json_object' },
          ...config.extraBody,
        }),
      })
    } catch (e) {
      // 网络错误 → 重试
      if (i < 2) {
        await sleep(1000 * (i + 1))
        continue
      }
      throw e
    }
    const text = await res.text()
    if (res.ok) {
      let d: { choices?: { message?: { content?: string }; finish_reason?: string }[] }
      try {
        d = JSON.parse(text)
      } catch {
        throw new Error('AI 返回非 JSON: ' + text.slice(0, 200))
      }
      const content = d.choices?.[0]?.message?.content || ''
      if (content) return content
      // content 为空：多半是思考模型把 token 全花在 reasoning 上、被 length 截断
      const fr = d.choices?.[0]?.finish_reason
      const hint = fr === 'length' ? 'AI 输出被 max_tokens 截断' : 'AI 返回了空 content'
      throw new Error(`${hint}; 若开了 thinking 请清空 extraBody 或加大 max_tokens。原始: ` + text.slice(0, 200))
    }
    if (res.status === 429 || res.status >= 500) {
      if (i < 2) {
        await sleep(1000 * (i + 1))
        continue // 限流/服务端错误 → 重试
      }
    }
    throw new Error(`AI ${res.status}: ${text.slice(0, 200)}`) // 4xx 直接抛
  }
  // 理论上不会走到（循环内必 return 或 throw）
  throw new Error('AI 调用重试耗尽')
}

// 跨源归一化指纹：去掉同一首歌在不同源的重复（去括号/空白/分隔符，歌名+歌手）
function songKey(s: SongWithUid): string {
  const norm = (t: unknown) =>
    String(t || '')
      .replace(/[（(].*?[)）]/g, '')
      .replace(/[\s·\-_&/、,]/g, '')
      .toLowerCase()
  return norm(s.name) + '|' + norm(s.singer)
}

// 搜索 + 入库 + 拼 uid（照搬 app/api/search/route.ts 的 list 处理）
async function searchAndEnrich(source: string, keyword: string, limit: number): Promise<SongWithUid[]> {
  const result: { list: MusicInfo[] } = await musicSearch.search(source, keyword, 1, limit)
  return Promise.all(
    result.list.map(async (mi) => {
      await upsertMusicInfo(mi).catch((e) => logger.warn('[recommend-engine] search upsert failed', e))
      return { ...mi, uid: `${mi.source}-${getStorageSongmidForMusicInfo(mi)}` }
    }),
  )
}

// 按 sources 优先级逐源搜索，合并并跨源去重（先入为主 = 保留高优先级源），截断到 maxCandidates
async function searchArtistMulti(config: EngineConfig, artist: string): Promise<SongWithUid[]> {
  const byKey = new Map<string, SongWithUid>()
  for (const src of config.sources) {
    let list: SongWithUid[] = []
    try {
      list = await searchAndEnrich(src, artist, config.perSource)
    } catch (e) {
      logger.warn(`[recommend-engine] [${artist}] 源 ${src} 跳过: ${(e as Error).message}`)
      continue
    }
    for (const s of list) {
      const k = songKey(s)
      if (!byKey.has(k)) byKey.set(k, s) // 先入为主 = 高优先级源保留
    }
  }
  return Array.from(byKey.values()).slice(0, config.maxCandidates)
}

// 把一个主体(歌手/歌曲)的全部候选打包一次给 AI，返回选中版本
async function aiFilter(config: EngineConfig, subject: string, songs: SongWithUid[]): Promise<{ selected: SongWithUid[] }> {
  const lines = songs
    .map((s, i) => `${i + 1}. ${s.name} | ${s.singer} | ${s.albumName || '-'}`)
    .join('\n')
  const user = config.promptUser
    .replace(/\{\{artist\}\}/g, subject)
    .replace(/\{\{song\}\}/g, subject)
    .replace(/\{\{subject\}\}/g, subject)
    .replace(/\{\{candidates\}\}/g, lines)
  const raw = await callAI(config, [
    { role: 'system', content: config.promptSystem },
    { role: 'user', content: user },
  ])
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('AI 未返回 JSON: ' + raw.slice(0, 200))
  let obj: { selected?: unknown }
  try {
    obj = JSON.parse(m[0])
  } catch {
    throw new Error('AI 返回 JSON 解析失败: ' + raw.slice(0, 200))
  }
  const idx = (Array.isArray(obj.selected) ? obj.selected : [])
    .map((n) => Number(n) - 1)
    .filter((i) => Number.isInteger(i) && i >= 0 && i < songs.length)
  return { selected: idx.map((i) => songs[i]) }
}

// 拉取当前完整推荐白名单的 uid 集合（分页），用于在喂 AI 前剔除已推荐歌曲
async function fetchRecommendedUids(): Promise<Set<string>> {
  const set = new Set<string>()
  let page = 1
  while (true) {
    const { list } = await listRecommendedMusicInfo(page, 200)
    list.forEach((s) => set.add(s.uid))
    if (list.length < 200) break
    page++
  }
  return set
}

// 并发池（歌手级并发）；shouldStop 返回 true 时不再提交新任务，已提交的会跑完
async function pool<T>(
  items: T[],
  n: number,
  fn: (item: T) => Promise<ArtistResult>,
  shouldStop?: () => boolean,
): Promise<ArtistResult[]> {
  const ret: Promise<ArtistResult>[] = []
  const exec = new Set<Promise<ArtistResult>>()
  for (const it of items) {
    if (shouldStop?.()) break // 取消：不再提交新歌手
    const p = Promise.resolve()
      .then(() => fn(it))
      .finally(() => exec.delete(p))
    exec.add(p)
    ret.push(p)
    if (exec.size >= n) await Promise.race(exec)
  }
  await Promise.allSettled(ret)
  return Promise.all(ret.map((p) => p.catch(() => ({ artist: '?', ok: false, reason: 'unknown' }) as ArtistResult)))
}

// ============ 主入口：跑一个任务的全部歌手 ============
export async function runRecommendTask(
  task: { artists: string[]; config: EngineConfig },
  onProgress: (p: RunProgress) => void | Promise<void>,
  shouldCancel: () => boolean,
): Promise<{ results: ArtistResult[]; interrupted: boolean }> {
  const { artists, config } = task
  let done = 0
  let interrupted = false

  // 缺 key：所有歌手直接标记失败，不搜索不中断（满足"临时用、不要报错"）
  if (!config.apiKey) {
    const results: ArtistResult[] = []
    for (const artist of artists) {
      if (shouldCancel()) {
        interrupted = true
        break
      }
      const r: ArtistResult = {
        artist,
        ok: false,
        reason: '缺少 API key（创建任务时未填写，且服务端未配置 OPENAI_API_KEY）',
      }
      results.push(r)
      done++
      await onProgress({ done, currentArtist: artist, result: r })
    }
    return { results, interrupted }
  }

  const existingUids = await fetchRecommendedUids()
  logger.info(`[recommend-engine] 开始任务: 歌手 ${artists.length} 已有推荐 ${existingUids.size}`)

  const results = await pool(
    artists,
    config.concurrency,
    async (artist): Promise<ArtistResult> => {
      if (shouldCancel()) {
        interrupted = true
        return { artist, ok: false, reason: '已取消' }
      }
      try {
        const songs = await searchArtistMulti(config, artist)
        if (!songs.length) {
          done++
          const r: ArtistResult = { artist, ok: true, selected: 0, added: 0, skipped: 0, reason: '无搜索结果' }
          await onProgress({ done, currentArtist: artist, result: r })
          return r
        }
        const fresh = songs.filter((s) => !existingUids.has(s.uid))
        const skipped = songs.length - fresh.length
        if (!fresh.length) {
          done++
          const r: ArtistResult = { artist, ok: true, selected: 0, added: 0, skipped, reason: '候选已全部在白名单' }
          await onProgress({ done, currentArtist: artist, result: r })
          return r
        }
        const { selected } = await aiFilter(config, artist, fresh)
        const uids = selected.map((s) => s.uid)
        const { updated } = await setRecommendedBatch(uids, true)
        uids.forEach((u) => existingUids.add(u)) // 标记新加入，避免同任务并发重复加
        done++
        const r: ArtistResult = { artist, ok: true, selected: selected.length, added: updated, skipped }
        await onProgress({ done, currentArtist: artist, result: r })
        return r
      } catch (e) {
        done++
        const reason = e instanceof Error ? e.message : String(e)
        const r: ArtistResult = { artist, ok: false, reason }
        await onProgress({ done, currentArtist: artist, result: r })
        return r
      }
    },
    shouldCancel,
  )

  return { results, interrupted }
}
