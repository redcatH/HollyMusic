/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

interface UseAudioOptions {
  volume?: number
  autoplay?: boolean
  loop?: boolean
  mute?: boolean
  rate?: number
  onEnd?: () => void  // ✨ 新增：歌曲结束回调
}

interface AudioState {
  isLoading: boolean
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  rate: number
  error: string | null
}

/**
 * Howler.js 音频播放 hook 封装
 * 处理音频的加载、播放、暂停、进度控制、音量调节
 */
export function useAudio(url?: string, options: UseAudioOptions = {}) {
  const {
    volume = 1,
    autoplay = false,
    loop = false,
    mute = false,
    rate = 1,
    onEnd,  // ✨ 新增
  } = options

  // 使用 dynamic import 避免 SSR 问题
  const HowlerRef = useRef<any>(null)
  const SoundRef = useRef<any>(null)
  const animationFrameRef = useRef<number | undefined>(undefined)

  const [state, setState] = useState<AudioState>({
    isLoading: false,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: volume,
    isMuted: mute,
    rate: rate,
    error: null,
  })

  // 初始化 Howler（延迟加载以支持 SSR）
  useEffect(() => {
    const initHowler = async () => {
      if (typeof window !== 'undefined' && !HowlerRef.current) {
        try {
          const { Howl, Howler } = await import('howler')
          HowlerRef.current = { Howl, Howler }
        } catch (err) {
          console.error('Failed to load Howler:', err)
          setState((prev) => ({
            ...prev,
            error: 'Failed to load audio library',
          }))
        }
      }
    }

    initHowler()
  }, [])

  /**
   * 加载音频文件
   */
  const load = useCallback(
    (audioUrl: string, autoplayOnLoad = autoplay, onEndCallback?: () => void): Promise<void> => {
      console.log('useAudio.load: 开始加载', { audioUrl, autoplayOnLoad })
      
      return new Promise((resolve, reject) => {
        if (!HowlerRef.current) {
          console.error('useAudio.load: Howler 未初始化')
          setState((prev) => ({
            ...prev,
            error: 'Audio library not initialized',
          }))
          reject(new Error('Audio library not initialized'))
          return
        }

        setState((prev) => ({ ...prev, isLoading: true, error: null }))

        try {
          // 停止之前的音频
          if (SoundRef.current) {
            console.log('useAudio.load: 卸载之前的音频')
            SoundRef.current.unload()
            SoundRef.current = null
          }

          const { Howl } = HowlerRef.current

          SoundRef.current = new Howl({
            src: [audioUrl],
            html5: true,
            format: ['mp3', 'aac', 'flac', 'opus', 'ogg', 'wav', 'm4a'],
            mute: state.isMuted,
            volume: state.volume,
            rate: state.rate,
            autoplay: autoplayOnLoad,
            loop: loop,
            onload: () => {
              console.log('useAudio.load: onload 触发，音频已加载')
              setState((prev) => ({
                ...prev,
                isLoading: false,
                duration: SoundRef.current.duration(),
                error: null,
              }))
              resolve()
            },
            onplay: () => {
              console.log('useAudio.load: onplay 触发，音频开始播放')
              setState((prev) => ({ ...prev, isPlaying: true }))
            },
            onpause: () => {
              console.log('useAudio.load: onpause 触发')
              setState((prev) => ({ ...prev, isPlaying: false }))
            },
            onstop: () => {
              console.log('useAudio.load: onstop 触发')
              setState((prev) => ({ ...prev, isPlaying: false, currentTime: 0 }))
            },
            onend: () => {
              console.log('useAudio.load: onend 触发，音频播放完毕')
              setState((prev) => ({ ...prev, isPlaying: false, currentTime: 0 }))
              // ✨ 优先调用通过 load 参数传递的回调，其次调用 options 中的回调
              if (onEndCallback) {
                console.log('useAudio.load: 调用 onEndCallback')
                onEndCallback()
              } else if (onEnd) {
                console.log('useAudio.load: 调用 onEnd 回调')
                onEnd()
              }
            },
            onerror: (error: unknown) => {
              console.error('useAudio.load: onerror 触发，音频加载失败:', error)
              setState((prev) => ({
                ...prev,
                error: `Audio error: ${error}`,
                isLoading: false,
              }))
              reject(new Error(`Audio error: ${error}`))
            },
          })
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Failed to load audio'
          console.error('useAudio.load: 异常错误:', errorMsg)
          setState((prev) => ({
            ...prev,
            error: errorMsg,
            isLoading: false,
          }))
          reject(err)
        }
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loop, autoplay, onEnd]
  )

  /**
   * 进度更新循环（内部使用）
   */
  const startProgressLoop = useCallback(() => {
    if (animationFrameRef.current !== undefined) return

    const updateLoop = () => {
      if (!SoundRef.current) return

      const current = SoundRef.current.seek()
      const duration = SoundRef.current.duration()

      setState((prev) => ({
        ...prev,
        currentTime: typeof current === 'number' ? current : 0,
        duration: typeof duration === 'number' ? duration : 0,
      }))

      if (SoundRef.current.playing()) {
        animationFrameRef.current = requestAnimationFrame(updateLoop)
      } else {
        animationFrameRef.current = undefined
      }
    }

    animationFrameRef.current = requestAnimationFrame(updateLoop)
  }, [])

  /**
   * 播放
   */
  const play = useCallback(() => {
    if (!SoundRef.current) return
    SoundRef.current.play()
    startProgressLoop()
  }, [startProgressLoop])

  /**
   * 暂停
   */
  const pause = useCallback(() => {
    if (!SoundRef.current) return
    SoundRef.current.pause()
    // 清除进度更新循环
    if (animationFrameRef.current !== undefined) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = undefined
    }
  }, [])

  /**
   * 停止
   */
  const stop = useCallback(() => {
    if (!SoundRef.current) return
    SoundRef.current.stop()
  }, [])

  /**
   * 设置播放进度
   */
  const seek = useCallback((time: number) => {
    if (!SoundRef.current) return
    SoundRef.current.seek(time)
    setState((prev) => ({ ...prev, currentTime: time }))
  }, [])

  /**
   * 设置音量
   */
  const setVolume = useCallback((vol: number) => {
    const clampedVol = Math.max(0, Math.min(1, vol))
    if (SoundRef.current) {
      SoundRef.current.volume(clampedVol)
    }
    setState((prev) => ({ ...prev, volume: clampedVol }))
  }, [])

  /**
   * 切换静音
   */
  const toggleMute = useCallback(() => {
    if (!SoundRef.current) return
    const newMuted = !state.isMuted
    SoundRef.current.mute(newMuted)
    setState((prev) => ({ ...prev, isMuted: newMuted }))
  }, [state.isMuted])

  /**
   * 设置播放速度
   */
  const setRate = useCallback((newRate: number) => {
    const clampedRate = Math.max(0.5, Math.min(2, newRate))
    if (SoundRef.current) {
      SoundRef.current.rate(clampedRate)
    }
    setState((prev) => ({ ...prev, rate: clampedRate }))
  }, [])

  /**
   * 清理资源
   */
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      if (SoundRef.current) {
        SoundRef.current.unload()
        SoundRef.current = null
      }
    }
  }, [])

  return {
    ...state,
    load,
    play,
    pause,
    stop,
    seek,
    setVolume,
    toggleMute,
    setRate,
  }
}
