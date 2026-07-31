'use client'

/**
 * Howler 音频引擎封装（html5 模式，流式播放）。
 * 状态由外部 store 管理，本 hook 通过回调上报：时间/时长/播放状态/结束。
 * 动态 import howler 以兼容 SSR。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseAudioPlayerOptions {
  onTimeUpdate?: (t: number) => void
  onDuration?: (d: number) => void
  onPlayState?: (playing: boolean) => void
  onEnd?: () => void
  /** 音频下载进度回调：0-100 表示下载中，null 表示结束/未在下载 */
  onLoading?: (percent: number | null) => void
  /** 音频拉取/播放失败回调（如 HTTP 500、解码失败），由上层决定是否跳下一首 */
  onError?: (msg: string) => void
}

export function useAudioPlayer(opts: UseAudioPlayerOptions) {
  const optsRef = useRef(opts)
  optsRef.current = opts

  const howlerRef = useRef<{ Howl: any; Howler: any } | null>(null)
  const soundRef = useRef<any>(null)
  const rafRef = useRef<number | undefined>(undefined)
  const blobUrlRef = useRef<string | null>(null)
  const loadGenRef = useRef(0)
  const [isReady, setIsReady] = useState(false)

  // 初始化 Howler
  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false
    ;(async () => {
      try {
        const mod = await import('howler')
        if (cancelled) return
        howlerRef.current = { Howl: mod.Howl, Howler: mod.Howler }
        mod.Howler.autoUnlock = true
      } catch (e) {
        console.error('[useAudioPlayer] howler load failed', e)
      }
    })()
    return () => {
      cancelled = true
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
      if (soundRef.current) {
        soundRef.current.unload()
        soundRef.current = null
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
  }, [])

  const stopProgress = useCallback(() => {
    if (rafRef.current !== undefined) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = undefined
    }
  }, [])

  const startProgress = useCallback(() => {
    if (rafRef.current !== undefined) return
    const loop = () => {
      if (!soundRef.current) return
      const cur = soundRef.current.seek()
      const dur = soundRef.current.duration()
      if (typeof cur === 'number') optsRef.current.onTimeUpdate?.(cur)
      if (typeof dur === 'number' && dur > 0 && Number.isFinite(dur)) optsRef.current.onDuration?.(dur)
      if (soundRef.current.playing()) {
        rafRef.current = requestAnimationFrame(loop)
      } else {
        rafRef.current = undefined
      }
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [])

  const load = useCallback(
    async (url: string, autoplay = false) => {
      console.log('[diag] audio load', url, 'autoplay=', autoplay)
      if (!howlerRef.current) return

      // generation 计数：快速切歌时放弃过期的 fetch 结果，防竞态
      const gen = ++loadGenRef.current

      // 清理旧 sound 与旧 blobUrl
      if (soundRef.current) {
        soundRef.current.unload()
        soundRef.current = null
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
      stopProgress()
      setIsReady(false)
      optsRef.current.onLoading?.(0)

      // 先把整段音频拉到内存成 Blob，再用 blob: URL 喂给 Howl。
      // 这样 <audio> 的 seek/暂停/恢复都在本地内存跳转，不再向代理
      // 发 Range 请求，彻底规避代理不支持 Range 导致的「从头播放」问题。
      let src = url
      try {
        const resp = await fetch(url)
        if (!resp.ok) throw new Error(`fetch audio failed: ${resp.status}`)

        const total = Number(resp.headers.get('content-length')) || 0
        const reader = resp.body?.getReader()
        if (reader && total > 0) {
          // 流式读取并上报下载进度
          const chunks: BlobPart[] = []
          let received = 0
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (gen !== loadGenRef.current) {
              await reader.cancel().catch(() => {})
              return
            }
            if (value) {
              // reader 读出的 Uint8Array 运行时基于 ArrayBuffer，是合法 BlobPart；
              // TS 5.7+ 将 Uint8Array 泛型化为 ArrayBufferLike，与 BlobPart 类型不兼容，此处窄化断言
              chunks.push(value as BlobPart)
              received += value.length
              optsRef.current.onLoading?.(Math.min(100, Math.round((received / total) * 100)))
            }
          }
          if (gen !== loadGenRef.current) return
          const blob = new Blob(chunks, {
            type: resp.headers.get('content-type') || 'audio/mpeg',
          })
          const blobUrl = URL.createObjectURL(blob)
          blobUrlRef.current = blobUrl
          src = blobUrl
        } else {
          // 无 content-length 或无 reader，退化为整段 blob
          const blob = await resp.blob()
          if (gen !== loadGenRef.current) return
          const blobUrl = URL.createObjectURL(blob)
          blobUrlRef.current = blobUrl
          src = blobUrl
        }
      } catch (e) {
        console.warn('[useAudioPlayer] audio fetch failed', e)
        optsRef.current.onLoading?.(null)
        // 过期请求不再上报（被新切歌取代）
        if (gen !== loadGenRef.current) return
        const msg = e instanceof Error ? e.message : '音频拉取失败'
        // 不再回退直连：同一个代理 URL 还会失败（如 500），交给上层跳下一首
        optsRef.current.onError?.(msg)
        return
      }

      // 最终竞态检查
      if (gen !== loadGenRef.current) return

      const { Howl } = howlerRef.current
      soundRef.current = new Howl({
        src: [src],
        html5: true,
        format: ['mp3', 'flac', 'm4a', 'ogg', 'wav', 'aac'],
        autoplay,
        onload: () => {
          setIsReady(true)
          optsRef.current.onLoading?.(null)
          const dur = soundRef.current.duration()
          if (typeof dur === 'number') optsRef.current.onDuration?.(dur)
          if (autoplay) startProgress()
        },
        onplay: () => {
          optsRef.current.onPlayState?.(true)
          startProgress()
        },
        onpause: () => {
          optsRef.current.onPlayState?.(false)
          stopProgress()
        },
        onstop: () => {
          optsRef.current.onPlayState?.(false)
          stopProgress()
        },
        onend: () => {
          // 先标记停止（isPlaying→false），再交给 store 决定下一步
          optsRef.current.onPlayState?.(false)
          stopProgress()
          optsRef.current.onEnd?.()
        },
        onerror: (e: unknown) => {
          console.error('[useAudioPlayer] audio error', e)
          optsRef.current.onLoading?.(null)
          optsRef.current.onPlayState?.(false)
          stopProgress()
          optsRef.current.onError?.('音频播放失败')
        },
      })
    },
    [startProgress, stopProgress]
  )

  const play = useCallback(() => {
    console.log('[diag] audio play, hasSound=', !!soundRef.current)
    soundRef.current?.play()
  }, [])

  const pause = useCallback(() => {
    console.log('[diag] audio pause, hasSound=', !!soundRef.current)
    soundRef.current?.pause()
  }, [])

  const seek = useCallback((t: number) => {
    if (!soundRef.current) return
    soundRef.current.seek(t)
    optsRef.current.onTimeUpdate?.(t)
  }, [])

  const setVolume = useCallback((v: number) => {
    soundRef.current?.volume(Math.max(0, Math.min(1, v)))
  }, [])

  const setMuted = useCallback((m: boolean) => {
    soundRef.current?.mute(m)
  }, [])

  return { isReady, load, play, pause, seek, setVolume, setMuted }
}
