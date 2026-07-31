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
}

export function useAudioPlayer(opts: UseAudioPlayerOptions) {
  const optsRef = useRef(opts)
  optsRef.current = opts

  const howlerRef = useRef<{ Howl: any; Howler: any } | null>(null)
  const soundRef = useRef<any>(null)
  const rafRef = useRef<number | undefined>(undefined)
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
    (url: string, autoplay = false) => {
      console.log('[diag] audio load', url, 'autoplay=', autoplay)
      if (!howlerRef.current) return
      if (soundRef.current) {
        soundRef.current.unload()
        soundRef.current = null
      }
      stopProgress()
      setIsReady(false)
      const { Howl } = howlerRef.current
      soundRef.current = new Howl({
        src: [url],
        html5: true,
        format: ['mp3', 'flac', 'm4a', 'ogg', 'wav', 'aac'],
        autoplay,
        onload: () => {
          setIsReady(true)
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
          optsRef.current.onPlayState?.(false)
          stopProgress()
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
