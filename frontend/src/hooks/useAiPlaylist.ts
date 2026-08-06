/**
 * AI 协助创建歌单 - 状态机 + 编排 hook
 *
 * 4 步向导：输入需求 → 候选勾选 → 处理中(搜索+过滤) → 歌曲确认+创建
 * 搜索并发池 + 跨源去重抄 lib/services/recommend-engine.ts 的 pool/songKey 模式。
 * 只搜启用音源（进入时 getSearchSources 拿到）。
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

export type AssistStep = 0 | 1 | 2 | 3

export interface ProcessingState {
  phase: 'searching' | 'filtering' | 'done' | 'error'
  doneKeywords: number
  totalKeywords: number
  hitKeywords: number // 搜到至少一首的词数
  foundSongs: number
  message: string
}

export interface ConfirmSong {
  song: Song
  action: 'keep' | 'remove'
  reason: string
}

// ============ 模块级纯函数 ============

/** 跨源去重键：归一化 name|singer（去括号/空白/分隔符） */
function songKey(s: Song): string {
  const norm = (str: string) =>
    str
      .toLowerCase()
      .replace(/[\s()（）\[\]【】\-_·.,，。!！?？'"`]/g, '')
  return `${norm(s.name || '')}|${norm(s.singer || '')}`
}

/** 简单并发池：items 按 concurrency 并发执行 fn */
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
 * 并发搜索多个关键词（每个词并发所有启用源），跨源去重。
 * 进度按「词」计：一个词的所有源搜完算完成一个。
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

  // 截断防爆 token（喂给 AI 过滤）
  return { songs: merged.slice(0, 150), hitCount: hitKeywords }
}

// ============ hook ============

export function useAiPlaylist() {
  const [step, setStep] = useState<AssistStep>(0)
  const [direction, setDirection] = useState(1) // 1 前进 / -1 后退，驱动动画
  const [sources, setSources] = useState<string[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(true)

  const [prompt, setPrompt] = useState('')
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

  // 进入时拿启用音源
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

  const goBack = useCallback((to: AssistStep) => {
    setDirection(-1)
    setStep(to)
  }, [])

  // Step0 → 1：AI 生成候选
  const runGenerate = useCallback(async () => {
    const p = prompt.trim()
    if (!p) return
    setGenerating(true)
    setGenerateError('')
    try {
      const result = await aiPlaylistGenerate(p)
      setGenerateResult(result)
      setPlaylistName(result.playlistName)
      setSelectedItems(new Set(result.items)) // 默认全选
      setDirection(1)
      setStep(1)
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : 'AI 生成失败')
    } finally {
      setGenerating(false)
    }
  }, [prompt])

  const toggleItem = useCallback((item: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev)
      if (next.has(item)) next.delete(item)
      else next.add(item)
      return next
    })
  }, [])

  // Step1 → 2 → 3：并发搜索 + AI 过滤
  const runProcess = useCallback(async () => {
    if (!generateResult) return
    const keywords = generateResult.items.filter((it) => selectedItems.has(it))
    if (keywords.length === 0 || sources.length === 0) return

    setDirection(1)
    setStep(2)
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
      // keep 排前
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
      setStep(3)
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

  // Step3：创建歌单 + 灌歌
  const createPlaylistAndSongs = useCallback(async () => {
    if (selectedUids.size === 0) return
    setCreating(true)
    setCreateError('')
    try {
      const name = playlistName.trim() || generateResult?.playlistName || 'AI 歌单'
      const pl = await createPlaylist(name)
      await addSongsToPlaylist(pl.id, Array.from(selectedUids))
      setCreatedId(pl.id)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }, [selectedUids, playlistName, generateResult])

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
    step,
    direction,
    sources,
    sourcesLoading,
    prompt,
    setPrompt,
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
