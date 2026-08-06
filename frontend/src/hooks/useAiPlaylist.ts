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
    const perSource = await Promise.allSettled(
      sources.map((src) => search(src as SourceType, kw, 1, limit)),
    )
    let kwHit = false
    for (const r of perSource) {
      if (r.status !== 'fulfilled') continue
      for (const s of r.value.list) {
        const key = songKey(s)
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(s)
        kwHit = true
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
      const { songs, hitCount } = await searchKeywords(keywords, sources, 15, (done, hit) => {
        setProcessing((prev) =>
          prev
            ? { ...prev, doneKeywords: done, hitKeywords: hit, message: `搜索中 ${done}/${keywords.length}` }
            : prev,
        )
      })

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
      confirm.sort((a, b) => (a.action === b.action ? 0 : a.action === 'keep' ? -1 : 1))

      setConfirmSongs(confirm)
      setSelectedUids(new Set(confirm.filter((c) => c.action === 'keep').map((c) => c.song.uid)))
      setProcessing({
        phase: 'done',
        doneKeywords: keywords.length,
        totalKeywords: keywords.length,
        hitKeywords: hitCount,
        foundSongs: songs.length,
        message: `命中 ${hitCount}/${keywords.length} 个，找到 ${songs.length} 首`,
      })
      setDirection(1)
      setStep(2)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '处理失败'
      setProcessing((prev) => (prev ? { ...prev, phase: 'error', message: msg } : prev))
    }
  }, [generateResult, selectedItems, sources, prompt])

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
