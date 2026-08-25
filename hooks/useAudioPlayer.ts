
/**
 * 原生 HTML5 Audio 引擎封装（替代 Howler）。
 *
 * 设计要点（解决旧 Howler 实现的 seek 后进度条不动 bug）：
 * 1. 进度更新基于原生 `timeupdate` + rAF 双驱动，不依赖 `play` 事件启动
 *    —— Howler 的 seek 内部走 internal play 不触发 onplay，导致 rAF 循环永不启动
 * 2. 原生 `seeked` 事件保证 seek 到未缓冲区→缓冲→恢复后进度条自然更新
 * 3. 缓冲态用原生 `waiting`/`canplay` 事件，比 Howler 更准确
 * 4. 单个 Audio 元素复用（load 时改 src + load），避免反复创建/销毁
 * 5. generation 计数防快速切歌竞态
 *
 * 音频 URL 指向 /api/audio，服务端磁盘缓存 + Range 代理；
 * 浏览器原生 GET + Range，seek/暂停/恢复全程服务端响应。
 *
 * 状态由外部 store 管理，本 hook 通过回调上报：时间/时长/播放状态/结束。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseAudioPlayerOptions {
  /** 音频元素创建/销毁通知，供频谱等附属能力接入同一播放实例。 */
  onAudioElement?: (audio: HTMLAudioElement | null) => void
  onTimeUpdate?: (t: number) => void
  onDuration?: (d: number) => void
  onPlayState?: (playing: boolean) => void
  onEnd?: () => void
  /** 缓冲态变化：true=进入缓冲（waiting），false=可播放（canplay）；null=无缓冲态 */
  onLoading?: (percent: number | null) => void
  /** 音频拉取/播放失败回调（如 HTTP 500、解码失败），由上层决定是否跳下一首。
   *  errCode 为浏览器 MediaError.code（3=DECODE 4=SRC_NOT_SUPPORTED 2=NETWORK），
   *  上层据此判断是否降级音质重试。 */
  onError?: (msg: string, errCode?: number) => void
}

export function useAudioPlayer(opts: UseAudioPlayerOptions) {
  const optsRef = useRef(opts)
  optsRef.current = opts

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rafRef = useRef<number | undefined>(undefined)
  /** load generation 计数：每次 load 自增，用于判断事件是否属于当前 load */
  const loadGenRef = useRef(0)
  /** 当前生效的 generation（load 时设置），事件 handler 比较它与 loadGenRef 判断是否过期 */
  const activeGenRef = useRef(0)
  /** 自管理的 seek 标志（比 audio.seeking 更可靠，区分"seek 引起的 spurious pause"与"用户主动暂停"） */
  const seekingRef = useRef(false)
  /** 用户设定的目标音量；淡入淡出只改变 audio.volume，不覆盖该偏好。 */
  const targetVolumeRef = useRef(1)
  /** 当前音量渐变。取消时也要结束旧 Promise，避免暂停流程卡在 await。 */
  const volumeFadeRef = useRef<{ frame: number | null; target: number; resolve: () => void } | null>(null)
  /** 用户最后一次明确的播放意图优先于缓冲恢复带来的原生 playing 事件。 */
  const playbackIntentRef = useRef<'playing' | 'paused'>('paused')
  const [isReady, setIsReady] = useState(false)

  const cancelVolumeFade = useCallback(() => {
    const activeFade = volumeFadeRef.current
    if (!activeFade) return
    if (activeFade.frame !== null) cancelAnimationFrame(activeFade.frame)
    volumeFadeRef.current = null
    activeFade.resolve()
  }, [])

  /** 参考 lxserver 的渐进音量：使用 rAF，快速重复操作会取消上一段过渡。 */
  const fadeVolume = useCallback((target: number, duration: number): Promise<void> => {
    const audio = audioRef.current
    if (!audio) return Promise.resolve()

    cancelVolumeFade()
    const from = Math.max(0, Math.min(1, audio.volume))
    const to = Math.max(0, Math.min(1, target))
    // rAF 在后台标签页会冻结：隐藏时走瞬时路径，保证 load()/pause() 的 await 不悬挂、音量不滞留 0。
    if (duration <= 0 || document.hidden || Math.abs(from - to) < 0.001) {
      audio.volume = to
      return Promise.resolve()
    }

    return new Promise(resolve => {
      const activeFade = { frame: null as number | null, target: to, resolve }
      volumeFadeRef.current = activeFade
      const start = performance.now()
      const tick = (now: number) => {
        if (volumeFadeRef.current !== activeFade) return
        // 个别浏览器的 rAF 时间戳可能短暂早于 performance.now()；必须双向截断。
        // 否则负进度代入缓动公式会算出大于 1 的音量并抛出 DOMException，
        // 从而中断暂停流程。
        const progress = Math.max(0, Math.min(1, (now - start) / duration))
        // easeInOutQuad：起止柔和，中段自然加速，避免线性音量变化的突兀感。
        const eased = progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2
        audio.volume = Math.max(0, Math.min(1, from + (to - from) * eased))

        if (progress < 1) {
          activeFade.frame = requestAnimationFrame(tick)
          return
        }
        audio.volume = to
        volumeFadeRef.current = null
        resolve()
      }
      activeFade.frame = requestAnimationFrame(tick)
    })
  }, [cancelVolumeFade])

  // ------------------------------------------------------------------
  // 初始化：创建单个 Audio 元素 + 绑定原生事件（仅一次）
  // ------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === 'undefined') return

    const audio = new Audio()
    // 频谱通过 MediaElementAudioSourceNode 读取该元素；必须在设置 src 前声明 CORS 模式。
    // 正常 /api/audio 同源请求不受影响，部分 Android 内核会据此决定是否向 Web Audio 暴露样本数据。
    audio.crossOrigin = 'anonymous'
    audio.preload = 'auto'
    audioRef.current = audio
    optsRef.current.onAudioElement?.(audio)

    // iOS autoplay 解锁：首次用户交互时触发一次 load，解除 play() 限制
    const unlock = () => {
      audio.load()
      window.removeEventListener('touchstart', unlock)
      window.removeEventListener('click', unlock)
    }
    window.addEventListener('touchstart', unlock, { once: true })
    window.addEventListener('click', unlock, { once: true })

    // fadeVolume 只在调用时检查 document.hidden；淡入进行中退后台时 rAF 冻结，
    // 音量会停在 0 附近，后台续播变成无声。隐藏瞬间直接落位到本次淡变的目标值。
    const onVisibilityChange = () => {
      if (!document.hidden) return
      const activeFade = volumeFadeRef.current
      if (!activeFade) return
      cancelVolumeFade()
      audio.volume = activeFade.target
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    // ---- 原生事件绑定 ----
    // generation guard：比较 loadGenRef（每次 load 自增）与 activeGenRef（load 时设置）
    // 若不匹配说明事件来自旧 load，丢弃
    const isCurrent = () => loadGenRef.current === activeGenRef.current && loadGenRef.current > 0

    const onLoadedMetadata = () => {
      if (!isCurrent()) return
      const dur = audio.duration
      if (Number.isFinite(dur) && dur > 0) {
        optsRef.current.onDuration?.(dur)
      }
    }
    const onCanPlay = () => {
      if (!isCurrent()) return
      setIsReady(true)
      optsRef.current.onLoading?.(null)
    }
    const onPlay = () => {
      if (playbackIntentRef.current !== 'playing') return
      optsRef.current.onPlayState?.(true)
      startProgress()
    }
    const onPlaying = () => {
      // playing 事件：播放恢复后触发（缓冲结束 / seek 完成后）
      // play 事件只在 paused→playing 时触发，seek 期间不触发 play 只有 playing
      // 所以这里必须也启动 rAF 循环，否则 seek 到未缓冲区恢复后进度条不动
      // 用户已点击暂停时，缓冲恢复仍可能冒出 playing 事件；不能把状态改回播放。
      if (playbackIntentRef.current !== 'playing') return
      optsRef.current.onPlayState?.(true)
      startProgress()
    }
    const onPause = () => {
      // 用自管理 seekingRef 区分：seek 引起的 spurious pause 静默，用户主动暂停正常上报。
      // 意图只读：playbackIntentRef 仅由命令（load/play/pause）写入。load() 切歌时内部
      // audio.pause() 的原生事件在同步代码把意图写回 'playing' 之后才异步到达，若在此
      // 回写意图，会门控掉随后的 play/playing 事件，新歌被上层 pause() 掐死。
      if (seekingRef.current) return
      if (playbackIntentRef.current !== 'paused') return
      optsRef.current.onPlayState?.(false)
      stopProgress()
    }
    const onEnded = () => {
      optsRef.current.onPlayState?.(false)
      stopProgress()
      optsRef.current.onEnd?.()
    }
    const onTimeUpdate = () => {
      if (audio.readyState === 0) return
      optsRef.current.onTimeUpdate?.(audio.currentTime)
    }
    const onSeeked = () => {
      // seek 完成（含缓冲等待后）——上报真实位置 + 确保 rAF 循环在运行
      seekingRef.current = false
      optsRef.current.onTimeUpdate?.(audio.currentTime)
      // 安全网：若 seek 期间 rAF 被误停（部分浏览器 spurious pause），这里重启
      if (!audio.paused && !audio.ended) {
        startProgress()
      }
    }
    const onWaiting = () => {
      // 进入缓冲态（seek 到未缓冲区 / 网络慢）
      optsRef.current.onLoading?.(null)
    }
    const onDurationChange = () => {
      if (!isCurrent()) return
      const dur = audio.duration
      if (Number.isFinite(dur) && dur > 0) {
        optsRef.current.onDuration?.(dur)
      }
    }
    const onError = () => {
      if (!isCurrent()) return
      const err = audio.error
      console.error('[useAudioPlayer] audio error', err)
      optsRef.current.onLoading?.(null)
      optsRef.current.onPlayState?.(false)
      stopProgress()
      // 区分错误类型给上层更准确的信息
      let msg = '音频播放失败'
      if (err) {
        switch (err.code) {
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            msg = '音频格式不支持或源无效'
            break
          case MediaError.MEDIA_ERR_NETWORK:
            msg = '网络错误，音频加载失败'
            break
          case MediaError.MEDIA_ERR_DECODE:
            msg = '音频解码失败'
            break
          case MediaError.MEDIA_ERR_ABORTED:
            return // 主动 abort（如切歌时），不算错误
        }
      }
      optsRef.current.onError?.(msg, err?.code)
    }

    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('seeked', onSeeked)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('error', onError)

    return () => {
      window.removeEventListener('touchstart', unlock)
      window.removeEventListener('click', unlock)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('seeked', onSeeked)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('error', onError)
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
      cancelVolumeFade()
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      audioRef.current = null
      optsRef.current.onAudioElement?.(null)
    }
  }, [cancelVolumeFade])

  // ------------------------------------------------------------------
  // rAF 进度循环：播放期间高精度更新 currentTime
  // 与 onTimeUpdate（每秒 4 次）互补，提供流畅的进度条动画
  // ------------------------------------------------------------------
  const stopProgress = useCallback(() => {
    if (rafRef.current !== undefined) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = undefined
    }
  }, [])

  const startProgress = useCallback(() => {
    if (rafRef.current !== undefined) return
    const loop = () => {
      const audio = audioRef.current
      if (!audio) return
      // readyState > 0 才有有效 currentTime
      if (audio.readyState > 0) {
        optsRef.current.onTimeUpdate?.(audio.currentTime)
      }
      if (!audio.paused && !audio.ended) {
        rafRef.current = requestAnimationFrame(loop)
      } else {
        rafRef.current = undefined
      }
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [])

  // ------------------------------------------------------------------
  // 对外 API：load / play / pause / seek / setVolume / setMuted
  // 签名与旧 Howler 实现完全一致，上层零改动
  // ------------------------------------------------------------------
  const load = useCallback(
    async (url: string, autoplay = false) => {
      console.log('[diag] audio load', url, 'autoplay=', autoplay)
      const audio = audioRef.current
      if (!audio) return

      // generation 计数：快速切歌时放弃过期的事件回调
      const gen = ++loadGenRef.current
      activeGenRef.current = gen
      playbackIntentRef.current = autoplay ? 'playing' : 'paused'

      // 清理旧状态
      stopProgress()
      seekingRef.current = false
      setIsReady(false)
      optsRef.current.onLoading?.(null)

      // 切歌时先快速淡出旧曲，避免 src 直接替换带来的突兀断音。
      if (!audio.paused && audio.src) {
        await fadeVolume(0, 180)
      } else {
        cancelVolumeFade()
      }
      if (gen !== loadGenRef.current) return

      // 设置新源
      audio.pause()
      audio.removeAttribute('src')
      audio.src = url
      audio.load()

      if (autoplay) {
        // play() 是 async，失败时（如 autoplay 被拦截）同步 UI 状态避免假"播放中"
        try {
          // load 内部 pause 产生的原生 pause 事件不能覆盖这次自动播放意图。
          playbackIntentRef.current = 'playing'
          audio.volume = 0
          await audio.play()
          if (gen !== loadGenRef.current) {
            // 已有更新的 load 接管音量；本代不得触碰，否则会打断新歌的淡入。
            if (audioRef.current === audio) audio.volume = targetVolumeRef.current
            return
          }
          void fadeVolume(targetVolumeRef.current, 420)
        } catch (e) {
          // AbortError：play() 被 pause()/load() 打断（快速切歌），浏览器标准行为，忽略
          // gen 校验：过期 load（快速连切）的 play 结果不影响当前歌曲状态，避免状态闪变
          const name = e instanceof Error ? e.name : ''
          if (name === 'AbortError') {
            // 音量此刻可能停在 0：恢复目标值，避免下次恢复播放时静音。
            if (gen === loadGenRef.current && audioRef.current === audio) {
              audio.volume = targetVolumeRef.current
            }
            return
          }
          if (gen !== loadGenRef.current) return
          audio.volume = targetVolumeRef.current
          console.warn('[useAudioPlayer] autoplay blocked', e)
          // autoplay 被浏览器拦截——同步 UI 状态，避免显示"播放中"但实际没声音
          optsRef.current.onPlayState?.(false)
        }
      }
    },
    [cancelVolumeFade, fadeVolume, stopProgress]
  )

  const play = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return
    playbackIntentRef.current = 'playing'
    // 暂停淡出尚未结束时再次播放：取消淡出并平滑恢复，无需重新 play()。
    if (!audio.paused) {
      void fadeVolume(targetVolumeRef.current, 240)
      return
    }
    console.log('[diag] audio play, readyState=', audio.readyState)
    try {
      audio.volume = 0
      await audio.play()
      void fadeVolume(targetVolumeRef.current, 420)
    } catch (e) {
      // AbortError：play() promise 未决期间被 pause()/load()/切歌打断，
      // 是浏览器标准行为，不算播放失败——否则会触发自动跳歌甚至停播
      if (e instanceof Error && e.name === 'AbortError') return
      audio.volume = targetVolumeRef.current
      console.error('[useAudioPlayer] play() failed', e)
      optsRef.current.onError?.('播放失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }, [fadeVolume])

  const pause = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return
    playbackIntentRef.current = 'paused'
    const generation = loadGenRef.current
    // play() Promise 尚未完成时 audio.paused 仍可能为 true；意图已写入，
    // 让随后到达的 play/playing 事件保持静默即可。
    if (audio.paused) return
    console.log('[diag] audio pause, paused=', audio.paused)
    await fadeVolume(0, 360)
    // 淡出期间可能已切歌或恢复播放；仅暂停仍是同一段淡出的音频。
    if (audioRef.current !== audio || audio.paused || loadGenRef.current !== generation || playbackIntentRef.current !== 'paused') return
    audio.pause()
  }, [fadeVolume])

  const seek = useCallback(
    (t: number) => {
      const audio = audioRef.current
      if (!audio) return
      console.log('[diag] audio seek to', t, 'readyState=', audio.readyState)
      // 设置自管理 seek 标志，让 onPause 能区分 seek 引起的 spurious pause
      seekingRef.current = true
      // 原生 seek：设置 currentTime，浏览器自动发 Range 请求
      // seek 到未缓冲区时浏览器会触发 waiting → 服务端 waitForBytes → canplay → seeked
      try {
        audio.currentTime = t
      } catch (e) {
        // readyState=0 时设 currentTime 可能抛 InvalidStateError
        seekingRef.current = false
        console.warn('[useAudioPlayer] seek failed', e)
        return
      }
      // 立即上报目标位置，让进度条即时响应（seeked 事件会再确认真实位置）
      optsRef.current.onTimeUpdate?.(t)
      // 主动启动 rAF 循环——seek 完成恢复播放后 onPlaying 会接管
      // 这是为了防止某些浏览器 seek 后事件时机异常导致 rAF 不启动
      if (!audio.paused) {
        startProgress()
      }
    },
    [startProgress]
  )

  const setVolume = useCallback((v: number) => {
    const audio = audioRef.current
    const volume = Math.max(0, Math.min(1, v))
    targetVolumeRef.current = volume
    if (!audio) return
    cancelVolumeFade()
    audio.volume = volume
  }, [cancelVolumeFade])

  const setMuted = useCallback((m: boolean) => {
    const audio = audioRef.current
    if (!audio) return
    audio.muted = m
  }, [])

  return { isReady, load, play, pause, seek, setVolume, setMuted }
}
