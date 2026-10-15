/**
 * 播放器全局状态（zustand）
 * 管理播放队列、当前曲目、播放状态、播放模式、UI 面板。
 * 原生音频引擎在 useAudioPlayer 中，由 PlayerBar 编排 store 与音频。
 */

import { create } from 'zustand'
import { toTrack, type Track, type PlaybackMode } from '@/lib/types/player'
import type { QualityType } from '@/lib/types/music'
import { buildAudioUrl, getTrackByUid } from '@/lib/api/music'
import { resolveQuality, nextLowerQuality } from '@/lib/quality-options'
import { detectCodecCap, capQuality } from '@/lib/codec-support'
import { reportPlay } from '@/lib/api/history'
import { useAuthStore } from '@/hooks/useAuth'
import { logger } from '@/lib/logger'
import { loadPlayerPreferences, playerPreferencesStorage, type PlaybackSession, type PlayerTabState } from '@/lib/player-storage'

/** 原生元数据就绪前使用曲目信息，避免有已知时长却显示 0:00。 */
function initialDuration(track: Track): number {
  return Number.isFinite(track.duration) && track.duration > 0 ? track.duration : 0
}

/** 仅在已登录时上报播放历史，匿名跳过（/api/history 受保护） */
function reportPlayIfAuthed(musicInfo: Track['musicInfo']) {
  if (useAuthStore.getState().authenticated) {
    reportPlay(musicInfo).catch(() => {})
  }
}

/** 可降级重试的浏览器 audio 错误码（MediaError）：3=DECODE 4=SRC_NOT_SUPPORTED。
 *  这两种通常是「浏览器解不了该格式」（典型：手机 WebView 解不了 FLAC），降一档换 MP3 即可播。
 *  用数字而非 MediaError 常量：store 模块 SSR 也会加载，Node 端无 MediaError 全局。 */
const DEGRADABLE_ERR_CODES = new Set([3, 4])

// ---- 睡眠定时器（句柄放模块级，避免进 store 触发重渲染）----
let sleepTimerHandle: ReturnType<typeof setTimeout> | null = null
const SLEEP_STEPS = [15, 30, 45, 60] // 分钟

interface PlayerStore {
  // 队列与当前
  queue: Track[]
  /** 手动插播队列（"下一首播放"插队头 / "加入队列"排队尾）。
   *  独立于主队列、优先于一切播放模式（对齐 Spotify "Next in queue" 与 LX tempPlayList）：
   *  随机/单曲循环都会先消费插播；播完即出队、不回流主队列；换列表播放时保留。 */
  playNextQueue: Track[]
  /** 当前曲是否来自插播队列（插播期间主队列 currentIndex 冻结，消费完毕回到冻结处继续） */
  isCurrentTempPlay: boolean
  currentIndex: number
  currentTrack: Track | null
  streamUrl: string | null
  /** 每次加载/重播均递增；同 URL 也必须执行，不能依赖 isPlaying 的瞬时变化。 */
  streamNonce: number
  isFetchingUrl: boolean
  urlFetchError: string | null
  /** 连续播放失败计数（自动跳歌防死循环） */
  errorRetryCount: number

  // 播放状态
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  playbackMode: PlaybackMode
  /** 当前播放音质（持久化到 localStorage） */
  quality: QualityType
  /** 当前歌曲实际播放音质（loadStreamUrl 时由 resolveQuality 算出，不持久化；无曲目时 null） */
  effectiveQuality: QualityType | null
  /** 浏览器原生解码能力上限（启动 canPlayType 探测得出）。
   *  loadStreamUrl 会用它再压一遍音质，避免请求已知解不了的高音质格式。仅内存，不持久化：
   *  浏览器更新后下次启动重新探测即可恢复。 */
  codecCap: QualityType
  /** 音频 blob 下载进度：0-100 表示下载中，null 表示未在下载 */
  bufferProgress: number | null
  /** 睡眠定时器：到点自动暂停；null 表示未启用 */
  sleepTimer: { minutes: number; expiresAt: number } | null

  // seek 指令（通过 nonce 触发音频 seek）
  seekTarget: number | null
  seekNonce: number

  // UI 面板
  isQueueOpen: boolean
  isLyricsOpen: boolean

  // 核心动作
  playTrack: (track: Track, queue?: Track[]) => Promise<void>
  loadStreamUrl: (track: Track, forceQuality?: QualityType, options?: { startTime?: number; autoplay?: boolean }) => Promise<void>
  /** 只恢复显示状态；用户点击播放时才加载音频，不计入一次新播放。 */
  restorePlayback: (session: PlaybackSession | null) => void
  /** 通过 uid 反查并播放（分享链接 ?uid= 自动播放用） */
  playByUid: (uid: string) => Promise<void>
  togglePlay: () => void
  setIsPlaying: (v: boolean) => void
  setCurrentTime: (t: number) => void
  setDuration: (d: number) => void
  setBufferProgress: (v: number | null) => void
  handleTrackError: (msg: string, errCode?: number, wasPlaying?: boolean) => void
  seek: (t: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  cyclePlaybackMode: () => void
  setQuality: (q: QualityType) => void

  next: () => void
  previous: () => void
  handleTrackEnd: () => void

  // 队列操作
  addToQueue: (track: Track) => void
  addNext: (track: Track) => void
  removeFromPlayNext: (index: number) => void
  clearPlayNext: () => void
  /** 消费插播队列第 index 首并立即播放（next/handleTrackEnd 优先调 index 0；队列面板点击用） */
  playFromPlayNext: (index: number) => void
  removeFromQueue: (index: number) => void
  clearQueue: () => void

  // UI
  toggleQueue: () => void
  setQueueOpen: (v: boolean) => void
  toggleLyrics: () => void
  setLyricsOpen: (v: boolean) => void

  // 睡眠定时器
  cycleSleepTimer: () => void
  setSleepTimer: (timer: PlayerTabState['sleepTimer']) => void
  clearSleepTimer: () => void
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  queue: [],
  playNextQueue: [],
  isCurrentTempPlay: false,
  currentIndex: -1,
  currentTrack: null,
  streamUrl: null,
  streamNonce: 0,
  isFetchingUrl: false,
  urlFetchError: null,
  errorRetryCount: 0,

  isPlaying: false,
  currentTime: 0,
  duration: 0,
  ...loadPlayerPreferences(),
  effectiveQuality: null,
  codecCap: detectCodecCap(),
  bufferProgress: null,
  sleepTimer: null,

  seekTarget: null,
  seekNonce: 0,

  isQueueOpen: false,
  isLyricsOpen: false,

  playTrack: async (track, newQueue) => {
    if (newQueue && newQueue.length > 0) {
      const idx = newQueue.findIndex(t => t.uid === track.uid)
      set({ queue: newQueue, currentIndex: idx >= 0 ? idx : 0 })
    } else {
      const existing = get().queue.findIndex(t => t.uid === track.uid)
      if (existing >= 0) {
        set({ currentIndex: existing })
      } else {
        set(s => ({ queue: [...s.queue, track], currentIndex: s.queue.length }))
      }
    }
    set({ currentTrack: track, isCurrentTempPlay: false, currentTime: 0, duration: initialDuration(track), urlFetchError: null })
    await get().loadStreamUrl(track)
    reportPlayIfAuthed(track.musicInfo)
  },

  restorePlayback: (session) => {
    get().clearQueue()
    set({ ...(session ?? {}), duration: session?.currentTrack ? initialDuration(session.currentTrack) : 0,
      isQueueOpen: false, isLyricsOpen: false })
  },

  loadStreamUrl: async (track, forceQuality?, options?) => {
    // 前端按歌曲支持范围就近降级，URL 带准确音质 → 缓存键准确、UI 如实显示。
    // 服务端 getMusicUrl 仍保留降级作音源级兜底。
    // forceQuality：解码失败降级重试时强制指定（绕过用户偏好），见 handleTrackError。
    // codecCap：浏览器能力上限（启动 canPlayType 探测），把已知解不了的格式压掉，
    //          避免对不支持 FLAC 的浏览器反复请求 FLAC。
    const resolved = forceQuality ?? resolveQuality(get().quality, track.musicInfo.types)
    const eff = capQuality(resolved, get().codecCap)
    set({
      streamUrl: buildAudioUrl(track.uid, eff),
      streamNonce: get().streamNonce + 1,
      seekTarget: null,
      currentTime: options?.startTime ?? 0,
      effectiveQuality: eff,
      isFetchingUrl: false,
      isPlaying: options?.autoplay ?? true,
      bufferProgress: null,
    })
  },
  playByUid: async (uid) => {
    const username = useAuthStore.getState().username
    const { musicInfo } = await getTrackByUid(uid)
    if (useAuthStore.getState().username !== username) return
    await get().playTrack(toTrack({ uid, musicInfo }))
  },

  togglePlay: () => {
    if (get().currentTrack) get().setIsPlaying(!get().isPlaying)
  },
  // 不在此处重置 errorRetryCount：解码失败常是「播一瞬间就挂」，play 事件已触发会把计数清零，
  // 导致连续失败上限永远达不到 → 无限循环跳歌。改由 setCurrentTime 在播放稳定(>5s)时重置。
  setIsPlaying: (v) => {
    const { currentTrack, streamUrl, currentTime } = get()
    if (v && currentTrack && !streamUrl) {
      void get().loadStreamUrl(currentTrack, undefined, { startTime: currentTime })
    } else set({ isPlaying: v && currentTrack !== null })
  },
  setCurrentTime: (t) => set(s => {
    // 播放超过 5 秒视为「播放稳定」，重置连续失败计数（区分「真失败」与「稳定播放」）
    if (t > 5 && s.errorRetryCount > 0) return { currentTime: t, errorRetryCount: 0 }
    return { currentTime: t }
  }),
  setDuration: (d) => {
    if (Number.isFinite(d) && d > 0) set({ duration: d })
  },
  setBufferProgress: (v) => set({ bufferProgress: v }),
  handleTrackError: (msg, errCode?, wasPlaying = get().isPlaying) => {
    // 暂停加载/恢复时遇到错误不能自动出声或跳歌；保留歌曲与位置供用户重试。
    if (!wasPlaying) {
      set({ urlFetchError: msg, isPlaying: false, streamUrl: null, bufferProgress: null })
      return
    }
    // 解码/格式不支持 → 仅对当前这首歌降一档重试（手机 WebView 常解不了 FLAC，降到 MP3 即可播）。
    // 降到最低档仍失败，才走下面的跳歌逻辑。网络错误(2)不降级（换格式无意义）。
    if (errCode !== undefined && DEGRADABLE_ERR_CODES.has(errCode)) {
      const { currentTrack, effectiveQuality } = get()
      const lower = effectiveQuality ? nextLowerQuality(effectiveQuality) : null
      if (currentTrack && lower) {
        // ponytail: 只对当前歌曲降级重试，不再全局下调 codecCap。
        // errCode 3/4 多是单首音源坏数据 / 网络截断 / 服务端返回非音频，而非浏览器能力不足；
        // 旧实现把瞬时失败误判为能力上限并只降不升，一次失败就把整会话压到 128k（即使用户 flac 优先）。
        // 浏览器能力探测交给启动时的 canPlayType（detectCodecCap），已足够覆盖真不支持 FLAC 的设备。
        logger.warn(
          `[player] 解码失败(err=${errCode})，${effectiveQuality} → ${lower} 降级重试：${currentTrack.name}`
        )
        get().loadStreamUrl(currentTrack, lower, { startTime: get().currentTime })
        return
      }
    }

    const { queue, errorRetryCount } = get()
    // 连续失败上限：min(3, 队列长度)；队列只有 1 首时失败 1 次即停止，避免对同一首无限重试
    const limit = Math.max(1, Math.min(3, queue.length))
    if (errorRetryCount + 1 >= limit) {
      set({
        urlFetchError: `连续 ${limit} 首播放失败，已停止：${msg}`,
        isPlaying: false,
        isFetchingUrl: false,
        streamUrl: null,
        errorRetryCount: 0,
        bufferProgress: null,
      })
      return
    }
    set({ errorRetryCount: errorRetryCount + 1, isFetchingUrl: false })
    get().next()
  },
  seek: (t) => set(s => ({ currentTime: t, seekTarget: t, seekNonce: s.seekNonce + 1 })),
  setVolume: (v) => { if (Number.isFinite(v)) set({ volume: Math.max(0, Math.min(1, v)), isMuted: false }) },
  toggleMute: () => set(s => ({ isMuted: !s.isMuted })),
  cyclePlaybackMode: () =>
    set(s => {
      const modes: PlaybackMode[] = ['sequence', 'loop', 'random']
      const i = modes.indexOf(s.playbackMode)
      return { playbackMode: modes[(i + 1) % modes.length] }
    }),
  setQuality: (q) => {
    set({ quality: q })
    // 切音质需重建 streamUrl（不同音质独立缓存键）
    const { currentTrack, streamUrl, currentTime, isPlaying } = get()
    if (currentTrack && streamUrl) void get().loadStreamUrl(currentTrack, undefined, { startTime: currentTime, autoplay: isPlaying })
  },

  next: () => {
    // 插播队列优先：手动点"下一首"也先播"下一首播放"插进来的歌（Spotify 同款）
    if (get().playNextQueue.length > 0) {
      get().playFromPlayNext(0)
      return
    }
    const { queue, currentIndex, playbackMode } = get()
    if (queue.length === 0) return
    let nextIndex: number
    if (playbackMode === 'random' && queue.length > 1) {
      nextIndex = Math.floor(Math.random() * queue.length)
      if (nextIndex === currentIndex) nextIndex = (nextIndex + 1) % queue.length
    } else {
      nextIndex = (currentIndex + 1) % queue.length
    }
    const track = queue[nextIndex]
    set({ currentIndex: nextIndex, currentTrack: track, isCurrentTempPlay: false, currentTime: 0, duration: initialDuration(track) })
    get().loadStreamUrl(track)
    reportPlayIfAuthed(track.musicInfo)
  },

  previous: () => {
    const { queue, currentIndex, currentTime, isCurrentTempPlay } = get()
    if (queue.length === 0) return
    if (currentTime > 3) {
      get().seek(0)
      return
    }
    // 插播中按上一首：回到主队列冻结游标处（插播前刚播的那首，LX 同款）
    const prevIndex = isCurrentTempPlay
      ? currentIndex
      : (currentIndex - 1 + queue.length) % queue.length
    if (prevIndex < 0 || prevIndex >= queue.length) return
    const track = queue[prevIndex]
    set({ currentIndex: prevIndex, currentTrack: track, isCurrentTempPlay: false, currentTime: 0, duration: initialDuration(track) })
    get().loadStreamUrl(track)
    reportPlayIfAuthed(track.musicInfo)
  },

  handleTrackEnd: () => {
    // 插播队列优先于一切模式：随机不跳过、单曲循环被打断、顺序播到队尾也不提前停止
    if (get().playNextQueue.length > 0) {
      get().playFromPlayNext(0)
      return
    }
    const { playbackMode, queue, currentIndex, currentTrack } = get()
    if (playbackMode === 'loop' && currentTrack) {
      // 单曲/插播都可重播。保留实际音质，由独立请求触发 seek(0) + play()。
      set(s => ({ currentTime: 0, seekTarget: null, streamNonce: s.streamNonce + 1, isPlaying: true }))
      return
    }
    if (queue.length === 0) return
    if (playbackMode === 'sequence' && currentIndex >= queue.length - 1) {
      // 顺序播放到末尾：停止
      set({ isPlaying: false, currentTime: 0 })
      return
    }
    get().next()
  },

  /** 加入队列（Play Later 语义）：排到插播队列末尾，整体优先于主队列剩余歌曲。
   *  允许重复入队（Spotify/Apple/LX 一致），不做 uid 去重——去重会让列表内已存在的歌静默失效。 */
  addToQueue: (track) => {
    set(s => ({ playNextQueue: [...s.playNextQueue, track] }))
    // 播放器空闲时直接开播用户刚操作的这首（LX addTempPlayList 同款）
    if (!get().currentTrack) get().playFromPlayNext(get().playNextQueue.length - 1)
  },
  /** 下一首播放（Play Next 语义）：插到插播队列最前，后点的先播（Apple 同款） */
  addNext: (track) => {
    set(s => ({ playNextQueue: [track, ...s.playNextQueue] }))
    if (!get().currentTrack) get().playFromPlayNext(0)
  },
  removeFromPlayNext: (index) =>
    set(s => ({ playNextQueue: s.playNextQueue.filter((_, i) => i !== index) })),
  clearPlayNext: () => set({ playNextQueue: [] }),
  playFromPlayNext: (index) => {
    const { playNextQueue } = get()
    const track = playNextQueue[index]
    if (!track) return
    // 主队列 currentIndex 冻结不动：插播消费完毕后 next() 从冻结位置继续主队列
    set({
      playNextQueue: playNextQueue.filter((_, i) => i !== index),
      currentTrack: track,
      isCurrentTempPlay: true,
      currentTime: 0,
      duration: initialDuration(track),
    })
    get().loadStreamUrl(track)
    reportPlayIfAuthed(track.musicInfo)
  },
  removeFromQueue: (index) =>
    set(s => {
      if (index < 0 || index >= s.queue.length) return {}
      const newQueue = s.queue.filter((_, i) => i !== index)
      if (index < s.currentIndex) {
        return { queue: newQueue, currentIndex: s.currentIndex - 1 }
      }
      if (index === s.currentIndex) {
        // 插播期间移除的是主队列冻结游标处的歌（并非正在播的曲）：只回退游标，不打断插播
        if (s.isCurrentTempPlay) {
          return { queue: newQueue, currentIndex: s.currentIndex - 1 }
        }
        // 移除当前曲目：清空播放状态（顺带修预存 bug——原实现留下指向已移除曲目的 streamUrl）
        return {
          queue: newQueue,
          currentIndex: -1,
          currentTrack: null,
          effectiveQuality: null,
          streamUrl: null,
          isPlaying: false,
          bufferProgress: null,
        }
      }
      return { queue: newQueue }
    }),
  clearQueue: () =>
    set({
      queue: [],
      playNextQueue: [],
      isCurrentTempPlay: false,
      currentIndex: -1,
      currentTrack: null,
      streamUrl: null,
      streamNonce: get().streamNonce + 1,
      isFetchingUrl: false,
      urlFetchError: null,
      errorRetryCount: 0,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      seekTarget: null,
      effectiveQuality: null,
      bufferProgress: null,
    }),

  toggleQueue: () => set(s => ({ isQueueOpen: !s.isQueueOpen })),
  setQueueOpen: (v) => set({ isQueueOpen: v }),
  toggleLyrics: () => set(s => ({ isLyricsOpen: !s.isLyricsOpen })),
  setLyricsOpen: (v) => set({ isLyricsOpen: v }),

  cycleSleepTimer: () => {
    const cur = get().sleepTimer
    const nextMinutes = !cur
      ? SLEEP_STEPS[0]
      : SLEEP_STEPS.indexOf(cur.minutes) >= SLEEP_STEPS.length - 1
        ? null
        : SLEEP_STEPS[SLEEP_STEPS.indexOf(cur.minutes) + 1]
    get().setSleepTimer(nextMinutes === null ? null : { minutes: nextMinutes, expiresAt: Date.now() + nextMinutes * 60_000 })
  },
  setSleepTimer: (timer) => {
    if (sleepTimerHandle) { clearTimeout(sleepTimerHandle); sleepTimerHandle = null }
    if (!timer) { set({ sleepTimer: null }); return }
    if (timer.expiresAt <= Date.now()) { set({ isPlaying: false, sleepTimer: null }); return }
    sleepTimerHandle = setTimeout(() => {
      usePlayerStore.getState().setIsPlaying(false)
      usePlayerStore.setState({ sleepTimer: null })
      sleepTimerHandle = null
    }, timer.expiresAt - Date.now())
    set({ sleepTimer: timer })
  },
  clearSleepTimer: () => get().setSleepTimer(null),
}))

// 高频播放进度不触发偏好写入；字段白名单也避免把瞬时状态持久化。
usePlayerStore.subscribe((state, previous) => {
  if (state.volume === previous.volume && state.isMuted === previous.isMuted
    && state.playbackMode === previous.playbackMode && state.quality === previous.quality) return
  const { volume, isMuted, playbackMode, quality } = state
  playerPreferencesStorage.write({ volume, isMuted, playbackMode, quality })
})
