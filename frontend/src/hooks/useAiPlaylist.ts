/**
 * AI 协助建歌单 - 状态机 + 编排 hook
 *
 * 3 步向导：0 输入需求 / 1 候选勾选 / 2 歌曲确认+创建
 * processing 是 1→2 之间的异步过渡态（搜索+过滤），不占 step 编号
 * 搜索并发池 + 跨源去重抄 lib/services/recommend-engine.ts 的 pool/songKey 模式。
 * 只搜启用音源（进入时 getSearchSources 拿到）。
 * mode: 'new' 新建歌单 / 'add' 给已有歌单加歌（playlistId）
 */

import { useCallback, useEffect, useState } from 'react'
import { search } from '@/lib/api/search'
import {
  getSearchSources,
  aiPlaylistGenerate,
  aiPlaylistFilter,
  type AiPlaylistGenerateResult,
} from '@/lib/api/playlist-assist'
import { createPlaylist, addSongsToPlaylist } from '@/lib/api/playlists'
import type { Song, SourceType } from '@/lib/types/music'

export type AssistStep = 0 | 1 | 2

export interface ProcessingState {
  phase: 'searching' | 'filtering' | 'done' | 'error'
  doneKeywords: number
  totalKeywords: number
  hitKeywords: number
  foundSongs: number
  message: string
}

export interface ConfirmSong {
  song: Song
  action: 'keep' | 'remove'
  reason: string
}

export interface UseAiPlaylistOpts {
  mode?: 'new' | 'add'
  playlistId?: number
}

// ============ 模块级纯函数 ============

function songKey(s: Song): string {
  const norm = (str: string) =>
    str
      .toLowerCase()
      .replace(/[\s()（）\[\]【】\-_·.,，。!！?？'"`]/g, '')
  return `${norm(s.name || '')}|${norm(s.singer || '')}`
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx])
    }
  })
  await Promise.all(workers)
}

/**
 * 并发搜索多个关键词，控制候选总量。
 * 多源聚合：每个词遍历所有勾选音源全部搜索，跨源去重（歌名+歌手归一化），
 * 同一首歌保留高优先级（优质）音源的版本（sources 按 priority 升序，先入为主）。
 * 进度按「词」计：一个词搜完算完成一个。
 */
async function searchKeywords(
  keywords: string[],
  sources: string[],
  limit: number,
  onProgress: (doneKeywords: number, hitKeywords: number) => void,
): Promise<{ songs: Song[]; hitCount: number }> {
  const seen = new Set<string>()
  const merged: Song[] = []
  let doneKeywords = 0
  let hitKeywords = 0

  await pool(keywords, 3, async (kw) => {
    let kwHit = false
    // 多源聚合：遍历所有勾选音源，跨源去重保留高优先级（优质）源版本
    for (const src of sources) {
      try {
        const r = await search(src as SourceType, kw, 1, limit)
        if (r.list.length === 0) continue
        for (const s of r.list) {
          const key = songKey(s)
          if (seen.has(key)) continue // 跨源去重，先入为主 = 保留优质源版本
          seen.add(key)
          merged.push(s)
          kwHit = true
        }
      } catch {
        // 该源失败/超时，继续下一源
      }
    }
    doneKeywords++
    if (kwHit) hitKeywords++
    onProgress(doneKeywords, hitKeywords)
  })

  return { songs: merged, hitCount: hitKeywords }
}

// ============ hook ============

export function useAiPlaylist(opts: UseAiPlaylistOpts = {}) {
  const mode = opts.mode ?? 'new'
  const playlistId = opts.playlistId

  const [step, setStep] = useState<AssistStep>(0)
  const [direction, setDirection] = useState(1)
  const [sources, setSources] = useState<string[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(true)

  const [prompt, setPrompt] = useState('')
  const [targetCount, setTargetCount] = useState(15)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState('')
  const [generateResult, setGenerateResult] = useState<AiPlaylistGenerateResult | null>(null)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [playlistName, setPlaylistName] = useState('')

  const [processing, setProcessing] = useState<ProcessingState | null>(null)
  const [confirmSongs, setConfirmSongs] = useState<ConfirmSong[]>([])
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set())

  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createdId, setCreatedId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setSourcesLoading(true)
    getSearchSources()
      .then(({ sources: s }) => {
        if (!cancelled) setSources(s)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSourcesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 无参 goBack：hook 内部决定目标，自动跳过过渡态
  const goBack = useCallback(() => {
    setDirection(-1)
    setStep((s) => (s === 2 ? 1 : s === 1 ? 0 : s))
  }, [])

  // 是否处于过渡态（搜索+过滤中，或出错停留）
  const isProcessing = processing !== null && processing.phase !== 'done'

  // Step0 → 1：AI 生成候选
  const runGenerate = useCallback(async () => {
    const p = prompt.trim()
    if (!p) return
    setGenerating(true)
    setGenerateError('')
    try {
      const result = await aiPlaylistGenerate(p, targetCount)
      setGenerateResult(result)
      setPlaylistName(result.playlistName)
      setSelectedItems(new Set(result.items))
      setDirection(1)
      setStep(1)
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : 'AI 生成失败')
    } finally {
      setGenerating(false)
    }
  }, [prompt, targetCount])

  const toggleItem = useCallback((item: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev)
      if (next.has(item)) next.delete(item)
      else next.add(item)
      return next
    })
  }, [])

  // Step1 → 过渡态 → Step2：并发搜索 + AI 过滤
  const runProcess = useCallback(async () => {
    if (!generateResult) return
    const keywords = generateResult.items.filter((it) => selectedItems.has(it))
    if (keywords.length === 0 || sources.length === 0) return

    setDirection(1)
    setProcessing({
      phase: 'searching',
      doneKeywords: 0,
      totalKeywords: keywords.length,
      hitKeywords: 0,
      foundSongs: 0,
      message: `搜索中 0/${keywords.length}`,
    })

    try {
      // limit 小（一个词不需要太多版本）；截断到 targetCount*5 防 AI token 爆炸
      const perWordLimit = 10
      const cap = targetCount * 5
      const { songs: rawSongs, hitCount } = await searchKeywords(
        keywords,
        sources,
        perWordLimit,
        (done, hit) => {
          setProcessing((prev) =>
            prev
              ? { ...prev, doneKeywords: done, hitKeywords: hit, message: `搜索中 ${done}/${keywords.length}` }
              : prev,
          )
        },
      )
      const songs = rawSongs.slice(0, cap)

      if (songs.length === 0) {
        setProcessing({
          phase: 'error',
          doneKeywords: keywords.length,
          totalKeywords: keywords.length,
          hitKeywords: 0,
          foundSongs: 0,
          message: '没有搜到任何歌曲，换个需求或检查音源是否启用',
        })
        return
      }

      setProcessing((prev) =>
        prev ? { ...prev, phase: 'filtering', foundSongs: songs.length, message: 'AI 筛选好版本中...' } : prev,
      )

      const { suggestions } = await aiPlaylistFilter(
        songs.map((s) => ({
          uid: s.uid,
          name: s.name,
          singer: s.singer,
          source: s.source,
          albumName: s.albumName,
        })),
        prompt,
        targetCount,
      )

      const sugMap = new Map(suggestions.map((s) => [s.uid, s]))
      const confirm: ConfirmSong[] = songs.map((s) => {
        const sug = sugMap.get(s.uid)
        return {
          song: s,
          action: sug?.action === 'remove' ? 'remove' : 'keep',
          reason: sug?.reason || '',
        }
      })
      // 不在前端做去重/截断：重复判定与数量控制完全交给 AI（提示词约束）。
      // 搜索阶段已按「歌名+歌手」跨源去重，这里仅按 AI 的 keep/remove 排序展示。
      const finalConfirm = confirm.slice()
      finalConfirm.sort((a, b) => (a.action === b.action ? 0 : a.action === 'keep' ? -1 : 1))

      setConfirmSongs(finalConfirm)
      setSelectedUids(new Set(finalConfirm.filter((c) => c.action === 'keep').map((c) => c.song.uid)))
      setProcessing({
        phase: 'done',
        doneKeywords: keywords.length,
        totalKeywords: keywords.length,
        hitKeywords: hitCount,
        foundSongs: songs.length,
        message: `命中 ${hitCount}/${keywords.length} 个，找到 ${finalConfirm.length} 首（AI 保留 ${finalConfirm.filter((c) => c.action === 'keep').length} 首）`,
      })
      setDirection(1)
      setStep(2)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '处理失败'
      setProcessing((prev) => (prev ? { ...prev, phase: 'error', message: msg } : prev))
    }
  }, [generateResult, selectedItems, sources, prompt, targetCount])

  const toggleUid = useCallback((uid: string) => {
    setSelectedUids((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }, [])

  // Step2：创建歌单 + 灌歌（new）或仅灌歌（add）
  const createPlaylistAndSongs = useCallback(async () => {
    if (selectedUids.size === 0) return
    setCreating(true)
    setCreateError('')
    try {
      let targetId = playlistId
      if (mode === 'new') {
        const name = playlistName.trim() || generateResult?.playlistName || 'AI 歌单'
        const pl = await createPlaylist(name)
        targetId = pl.id
      }
      if (targetId == null) throw new Error('缺少目标歌单 id')
      await addSongsToPlaylist(targetId, Array.from(selectedUids))
      setCreatedId(targetId)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }, [selectedUids, playlistName, generateResult, mode, playlistId])

  const reset = useCallback(() => {
    setStep(0)
    setDirection(1)
    setPrompt('')
    setGenerateResult(null)
    setSelectedItems(new Set())
    setPlaylistName('')
    setProcessing(null)
    setConfirmSongs([])
    setSelectedUids(new Set())
    setCreateError('')
    setCreatedId(null)
  }, [])

  return {
    mode,
    step,
    direction,
    sources,
    sourcesLoading,
    prompt,
    setPrompt,
    targetCount,
    setTargetCount,
    generating,
    generateError,
    generateResult,
    selectedItems,
    toggleItem,
    playlistName,
    setPlaylistName,
    runGenerate,
    runProcess,
    processing,
    isProcessing,
    confirmSongs,
    selectedUids,
    toggleUid,
    creating,
    createError,
    createdId,
    createPlaylistAndSongs,
    goBack,
    reset,
  }
}

export type AiPlaylistController = ReturnType<typeof useAiPlaylist>
