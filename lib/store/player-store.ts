/**
 * 播放器全局状态（zustand）
 * 管理播放队列、当前曲目、播放状态、播放模式、UI 面板。
 * 原生音频引擎在 useAudioPlayer 中，由 PlayerBar 编排 store 与音频。
 */

import { create } from 'zustand'
import { toTrack, type Track, type PlaybackMode } from '@/lib/types/player'
import type { QualityType } from '@/lib/types/music'
import { buildAudioUrl, getTrackByUid } from '@/lib/api/music'
import { resolveQuality, nextLowerQuality, QUALITY_ORDER, isQuality } from '@/lib/quality-options'
import { PLAYBACK_ATTEMPTS_HEADER, PLAYBACK_AUDIO_SPEC_HEADER, PLAYBACK_CANDIDATES_FAILED, PLAYBACK_ERROR_HEADER, PLAYBACK_QUALITY_HEADER, PLAYBACK_REQUEST_ID_HEADER } from '@/lib/playback-protocol'
import { detectCodecCap, capQuality } from '@/lib/codec-support'
import { reportPlay } from '@/lib/api/history'
import { useAuthStore } from '@/hooks/useAuth'
import { logger } from '@/lib/logger'
import { loadPlayerPreferences, playerPreferencesStorage, type PlaybackSession, type PlayerTabState } from '@/lib/player-storage'
import { getOfflineAudio } from '@/lib/offline-audio'
import {
  confirmQueuePlayback, emptyPlaybackQueue, enqueueTrack, nextQueueEntry, playFutureEntry,
  playManualEntry, previousQueueEntry, projectPlaybackQueue, removeManualEntry, removeQueueEntry,
  restoreLegacyQueue, selectTrack, setQueueShuffle, type PlaybackQueue,
} from '@/lib/player-queue'

/** 原生元数据就绪前使用曲目信息，避免有已知时长却显示 0:00。 */
function initialDuration(track: Track): number {
  return Number.isFinite(track.duration) && track.duration > 0 ? track.duration : 0
}

/** 仅在已登录时上报播放历史，匿名跳过（/api/history 受保护） */
function reportPlayIfAuthed(track: Track) {
  if (track.playback?.source !== 'local' && useAuthStore.getState().authenticated) {
    reportPlay(track.musicInfo).catch(() => {})
  }
}

/** 可降级重试的浏览器 audio 错误码（MediaError）：3=DECODE 4=SRC_NOT_SUPPORTED。
 *  这两种通常是「浏览器解不了该格式」（典型：手机 WebView 解不了 FLAC），降一档换 MP3 即可播。
 *  用数字而非 MediaError 常量：store 模块 SSR 也会加载，Node 端无 MediaError 全局。 */
const DEGRADABLE_ERR_CODES = new Set([3, 4])

// ---- 睡眠定时器（句柄放模块级，避免进 store 触发重渲染）----
let sleepTimerHandle: ReturnType<typeof setTimeout> | null = null
const SLEEP_STEPS = [15, 30, 45, 60] // 分钟
let streamRequestId = 0
let streamSelection: AbortController | null = null
let playbackCommandId = 0

interface PlayerStore {
  /** 当前已完成播放记录恢复的账号；仅内存，用于等待会话初始化。 */
  restoredForUsername: string | null
  // 队列与当前
  queue: Track[]
  /** 队列控制模块的会话状态；旧显示字段由它统一投影。 */
  navigation: PlaybackQueue | null
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
  preferSurround?: boolean
  keepScreenAwake: boolean
  /** 系统实际授权状态；不持久化。 */
  wakeLockStatus: 'idle' | 'active' | 'released' | 'unsupported' | 'error'
  /** 当前歌曲实际播放音质（loadStreamUrl 时由 resolveQuality 算出，不持久化；无曲目时 null） */
  effectiveQuality: QualityType | null
  effectiveAudioSpec?: string | null
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

  // 核心动作
  playTrack: (track: Track, queue?: Track[], options?: { offline?: boolean; quality?: QualityType; queueIndex?: number }) => Promise<void>
  loadStreamUrl: (track: Track, forceQuality?: QualityType, options?: { startTime?: number; autoplay?: boolean; offline?: boolean }) => Promise<void>
  /** 只恢复显示状态；用户点击播放时才加载音频，不计入一次新播放。 */
  restorePlayback: (session: PlaybackSession | null) => void
  /** 通过 uid 反查并播放（分享链接 ?uid= 自动播放用） */
  playByUid: (uid: string) => Promise<void>
  togglePlay: () => void
  setIsPlaying: (v: boolean, options?: { fromAudio?: boolean }) => void
  markPlaybackStarted: () => void
  setCurrentTime: (t: number) => void
  setDuration: (d: number) => void
  setBufferProgress: (v: number | null) => void
  handleTrackError: (msg: string, errCode?: number, wasPlaying?: boolean) => Promise<void>
  seek: (t: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  cyclePlaybackMode: () => void
  setPlaybackMode: (mode: PlaybackMode) => void
  setQuality: (q: QualityType) => void
  setPreferSurround: (enabled: boolean) => void
  setKeepScreenAwake: (enabled: boolean) => void

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
  playFromQueue: (index: number) => void
  playFromFuture: (index: number) => void
  removeFromFuture: (index: number) => void
  removeFromQueue: (index: number) => void
  clearQueue: () => void

  // UI
  toggleQueue: () => void
  setQueueOpen: (v: boolean) => void

  // 睡眠定时器
  cycleSleepTimer: () => void
  setSleepTimer: (timer: PlayerTabState['sleepTimer']) => void
  clearSleepTimer: () => void
}

export const usePlayerStore = create<PlayerStore>((set, get) => {
  const navigation = () => {
    const state = get()
    return setQueueShuffle(state.navigation ?? restoreLegacyQueue(state, state.playbackMode), state.playbackMode === 'random')
  }
  const activate = async (next: PlaybackQueue, options?: { offline?: boolean; quality?: QualityType }) => {
    const track = next.current?.entry.track
    if (!track) return
    // 同步切换队列与播放意图，使旧 Audio 事件立即失效，包括同曲的不同队列条目。
    set({ ...projectPlaybackQueue(next), currentTime: 0, duration: initialDuration(track),
      isFetchingUrl: true, urlFetchError: null })
    const request = get().loadStreamUrl(track, options?.quality, { offline: options?.offline })
    const requestId = streamRequestId
    await request
    if (requestId === streamRequestId && !options?.offline) reportPlayIfAuthed(track)
  }
  return ({
  restoredForUsername: null,
  queue: [],
  navigation: null,
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
  wakeLockStatus: 'idle',
  effectiveQuality: null,
  codecCap: detectCodecCap(),
  bufferProgress: null,
  sleepTimer: null,

  seekTarget: null,
  seekNonce: 0,

  isQueueOpen: false,

  playTrack: async (track, newQueue, options) => {
    await activate(selectTrack(navigation(), track, newQueue, options?.queueIndex), options)
  },

  restorePlayback: (session) => {
    get().clearQueue()
    if (!session) return
    const next = setQueueShuffle(session.navigation ?? restoreLegacyQueue(session, get().playbackMode), get().playbackMode === 'random')
    set({ ...projectPlaybackQueue(next), currentTime: session.currentTime,
      duration: next.current ? initialDuration(next.current.entry.track) : 0, isQueueOpen: false })
  },

  loadStreamUrl: async (track, forceQuality?, options?) => {
    streamSelection?.abort()
    const selection = new AbortController()
    streamSelection = selection
    const requestId = ++streamRequestId
    const commandId = playbackCommandId
    const seekNonce = get().seekNonce
    // 等待缓存时也立即记录播放意图，让按钮/媒体会话可以暂停；完成后仍以最新用户指令为准。
    set({ isFetchingUrl: true, isPlaying: options?.autoplay ?? true, bufferProgress: null })
    // 旧歌曲记录可能缺少高音质。先按偏好向服务端请求 Hi-Res 或母带，再按实际取流结果降级。
    // forceQuality：解码失败降级重试时强制指定（绕过用户偏好），见 handleTrackError。
    // codecCap：浏览器能力上限（启动 canPlayType 探测），把已知解不了的格式压掉，
    //          避免对不支持 FLAC 的浏览器反复请求 FLAC。
    const preference = get().quality
    const requested = preference === 'master' || preference === 'flac24bit'
      ? preference : resolveQuality(preference, track.musicInfo.types)
    const resolved = forceQuality ?? track.playback?.quality ?? requested
    let eff = capQuality(resolved, get().codecCap)
    const surround = !forceQuality && !track.playback?.quality && get().preferSurround === true
      && capQuality('atmos_plus', get().codecCap) === 'atmos_plus'
    const preferredLocal = surround ? 'atmos_plus' : eff
    const auth = useAuthStore.getState()
    const localPlayback = track.playback?.source === 'local'
    const offline = !!(localPlayback || options?.offline || auth.offlineUsername || (typeof navigator !== 'undefined' && !navigator.onLine))
    const username = auth.offlineUsername ?? auth.username
    let local: Awaited<ReturnType<typeof getOfflineAudio>> = null
    try {
      // uid 包含渠道与歌曲 ID；在线仅命中相同音质，离线保留可播放音质回退。
      if (username) local = await getOfflineAudio(username, track.uid, preferredLocal,
        offline && !localPlayback ? [...(surround ? ['atmos_plus' as const] : []), ...QUALITY_ORDER.filter(q => capQuality(q, get().codecCap) === q
          && (q !== 'master' || eff === 'master')
          && (!forceQuality || QUALITY_ORDER.indexOf(q) >= QUALITY_ORDER.indexOf(forceQuality)))] : [preferredLocal])
    } catch { /* 在线读取失败继续请求服务端；离线时显示未缓存。 */ }
    let streamUrl = buildAudioUrl(track.uid, eff, { surround })
    let effectiveAudioSpec: string | null = null
    let candidatesFailed = false
    if (!local && !offline && !selection.signal.aborted && typeof window !== 'undefined') {
      try {
        const signal = AbortSignal.any([selection.signal, AbortSignal.timeout(27_000)])
        const response = await fetch(streamUrl, { method: 'HEAD', cache: 'no-store', signal })
        const selected = response.headers.get(PLAYBACK_QUALITY_HEADER)
        if (response.ok && isQuality(selected)) {
          eff = selected
          effectiveAudioSpec = response.headers.get(PLAYBACK_AUDIO_SPEC_HEADER)
          streamUrl = buildAudioUrl(track.uid, eff, { exact: true })
        } else {
          const code = response.headers.get(PLAYBACK_ERROR_HEADER)
          candidatesFailed = !response.ok && code === PLAYBACK_CANDIDATES_FAILED
          logger.warn('[player] 音频预检未拿到可播放档位', {
            uid: track.uid, requestedQuality: eff, surround, method: 'HEAD',
            status: response.status, code, requestId: response.headers.get(PLAYBACK_REQUEST_ID_HEADER),
            contentType: response.headers.get('content-type'), selectedQuality: selected,
            attempts: response.headers.get(PLAYBACK_ATTEMPTS_HEADER),
          })
        }
      } catch (error) {
        if (!selection.signal.aborted) {
          logger.warn('[player] 音频预检请求异常', { uid: track.uid, requestedQuality: eff, surround,
            name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : undefined })
        }
      }
    }
    if (streamSelection === selection) streamSelection = null
    const currentAuth = useAuthStore.getState()
    if (requestId !== streamRequestId || get().currentTrack?.uid !== track.uid
      || username !== (currentAuth.offlineUsername ?? currentAuth.username)) {
      if (local) URL.revokeObjectURL(local.url)
      return
    }
    // 用户在缓存读取期间发出的暂停/播放和拖动指令优先于请求开始时的选项。
    const autoplay = commandId === playbackCommandId ? options?.autoplay ?? true : get().isPlaying
    const startTime = seekNonce === get().seekNonce ? options?.startTime ?? 0 : get().currentTime
    if (local) {
      set({ streamUrl: local.url, streamNonce: get().streamNonce + 1, effectiveQuality: local.quality, effectiveAudioSpec: null,
        seekTarget: null, currentTime: startTime, isFetchingUrl: false,
        isPlaying: autoplay, bufferProgress: null, urlFetchError: null })
      return
    }
    if (offline) {
      set({ streamUrl: null, isPlaying: false, isFetchingUrl: false, urlFetchError: '此歌曲尚未完整缓存，请联网播放后重试' })
      return
    }
    if (candidatesFailed) {
      set({ streamUrl: null, effectiveQuality: null, effectiveAudioSpec: null, isFetchingUrl: false, bufferProgress: null })
      await get().handleTrackError('音源没有返回可播放的音频', undefined, autoplay)
      return
    }
    set({
      streamUrl,
      streamNonce: get().streamNonce + 1,
      seekTarget: null,
      currentTime: startTime,
      effectiveQuality: eff,
      effectiveAudioSpec,
      isFetchingUrl: false,
      isPlaying: autoplay,
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
  setIsPlaying: (v, options) => {
    if (!options?.fromAudio) playbackCommandId++
    const { currentTrack, streamUrl, currentTime, isFetchingUrl } = get()
    if (v && currentTrack && !streamUrl && !isFetchingUrl) {
      void get().loadStreamUrl(currentTrack, undefined, { startTime: currentTime })
    } else set({ isPlaying: v && currentTrack !== null })
  },
  markPlaybackStarted: () => {
    const current = navigation()
    const confirmed = confirmQueuePlayback(current)
    if (confirmed !== get().navigation) set({ navigation: confirmed })
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
  handleTrackError: async (msg, errCode?, wasPlaying = get().isPlaying) => {
    // 暂停加载/恢复时遇到错误不能自动出声或跳歌；保留歌曲与位置供用户重试。
    if (!wasPlaying) {
      set({ urlFetchError: msg, isPlaying: false, streamUrl: null, bufferProgress: null })
      return
    }
    const { currentTrack, effectiveQuality, streamUrl } = get()
    const offline = typeof navigator !== 'undefined' && !navigator.onLine
    if (currentTrack && effectiveQuality && streamUrl?.startsWith('/api/audio?')
      && (errCode === 2 || (offline && errCode !== 1))) {
      const requestId = ++streamRequestId
      const commandId = playbackCommandId
      const auth = useAuthStore.getState()
      const username = auth.offlineUsername ?? auth.username
      let local: Awaited<ReturnType<typeof getOfflineAudio>> = null
      try {
        if (username) local = await getOfflineAudio(username, currentTrack.uid, effectiveQuality, [effectiveQuality])
      } catch { /* 缓存不可用时继续原有错误处理，不重复请求网络音频。 */ }
      const currentAuth = useAuthStore.getState()
      if (requestId !== streamRequestId || get().currentTrack?.uid !== currentTrack.uid
        || username !== (currentAuth.offlineUsername ?? currentAuth.username)) {
        if (local) URL.revokeObjectURL(local.url)
        return
      }
      // 音频错误会上报暂停；仅后续用户命令可以改变恢复时的播放意图。
      const autoplay = commandId === playbackCommandId ? wasPlaying : get().isPlaying
      if (local) {
        set({ streamUrl: local.url, streamNonce: get().streamNonce + 1, effectiveQuality: local.quality, effectiveAudioSpec: null,
          seekTarget: null, isFetchingUrl: false, isPlaying: autoplay, bufferProgress: null, urlFetchError: null })
        return
      }
      if (!autoplay) {
        set({ urlFetchError: msg, isPlaying: false, streamUrl: null, bufferProgress: null })
        return
      }
    }
    // 解码/格式不支持 → 仅对当前这首歌降一档重试（手机 WebView 常解不了 FLAC，降到 MP3 即可播）。
    // 降到最低档仍失败，才走下面的跳歌逻辑。网络错误(2)不降级（换格式无意义）。
    if (errCode !== undefined && DEGRADABLE_ERR_CODES.has(errCode)) {
      const { currentTrack, effectiveQuality } = get()
      const lower = effectiveQuality === 'atmos_plus' || effectiveQuality === 'atmos'
        ? get().quality : effectiveQuality ? nextLowerQuality(effectiveQuality) : null
      if (currentTrack && lower) {
        // ponytail: 只对当前歌曲降级重试，不再全局下调 codecCap。
        // errCode 3/4 多是单首音源坏数据 / 网络截断 / 服务端返回非音频，而非浏览器能力不足；
        // 旧实现把瞬时失败误判为能力上限并只降不升，一次失败就把整会话压到 128k（即使用户 flac 优先）。
        // 浏览器能力探测交给启动时的 canPlayType（detectCodecCap），已足够覆盖真不支持 FLAC 的设备。
        logger.warn(
          `[player] 解码失败(err=${errCode})，${effectiveQuality} → ${lower} 降级重试：${currentTrack.name}`
        )
        await get().loadStreamUrl(currentTrack, lower, { startTime: get().currentTime })
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
  setKeepScreenAwake: enabled => set({ keepScreenAwake: enabled }),
  setPlaybackMode: mode => set({ playbackMode: mode, navigation: setQueueShuffle(navigation(), mode === 'random') }),
  cyclePlaybackMode: () => {
    const modes: PlaybackMode[] = ['sequence', 'loop', 'random']
    get().setPlaybackMode(modes[(modes.indexOf(get().playbackMode) + 1) % modes.length])
  },
  setQuality: (q) => {
    if (!QUALITY_ORDER.includes(q)) return
    set({ quality: q })
    // 切音质需重建 streamUrl（不同音质独立缓存键）
    const { currentTrack, streamUrl, isFetchingUrl, currentTime, isPlaying } = get()
    if (currentTrack && (streamUrl || isFetchingUrl)) void get().loadStreamUrl(currentTrack, undefined, { startTime: currentTime, autoplay: isPlaying })
  },
  setPreferSurround: (enabled) => {
    set({ preferSurround: enabled })
    const { currentTrack, streamUrl, isFetchingUrl, currentTime, isPlaying } = get()
    if (currentTrack && (streamUrl || isFetchingUrl)) void get().loadStreamUrl(currentTrack, undefined, { startTime: currentTime, autoplay: isPlaying })
  },

  next: () => {
    const current = navigation()
    const next = nextQueueEntry(current)
    if (next !== current) void activate(next)
  },

  previous: () => {
    const { currentTrack, currentTime } = get()
    if (!currentTrack) return
    if (currentTime > 3) {
      get().seek(0)
      return
    }
    const current = navigation()
    const previous = previousQueueEntry(current)
    if (previous === current) get().seek(0)
    else void activate(previous)
  },

  handleTrackEnd: () => {
    // 插播队列优先于一切模式：随机不跳过、单曲循环被打断、列表循环先消费插播
    if (get().playNextQueue.length > 0) {
      get().playFromPlayNext(0)
      return
    }
    const { playbackMode, currentTrack } = get()
    if (playbackMode === 'loop' && currentTrack) {
      // 单曲/插播都可重播。保留实际音质，由独立请求触发 seek(0) + play()。
      set(s => ({ currentTime: 0, seekTarget: null, streamNonce: s.streamNonce + 1, isPlaying: true }))
      return
    }
    // 回退后的前进、插播与下一轮随机顺序统一交给队列控制模块。
    get().next()
  },

  /** 加入队列（Play Later 语义）：排到插播队列末尾，整体优先于主队列剩余歌曲。
   *  允许重复入队（Spotify/Apple/LX 一致），不做 uid 去重——去重会让列表内已存在的歌静默失效。 */
  addToQueue: (track) => {
    set(projectPlaybackQueue(enqueueTrack(navigation(), track, false)))
    // 播放器空闲时直接开播用户刚操作的这首（LX addTempPlayList 同款）
    if (!get().currentTrack) get().playFromPlayNext(get().playNextQueue.length - 1)
  },
  /** 下一首播放（Play Next 语义）：插到插播队列最前，后点的先播（Apple 同款） */
  addNext: (track) => {
    set(projectPlaybackQueue(enqueueTrack(navigation(), track, true)))
    if (!get().currentTrack) get().playFromPlayNext(0)
  },
  removeFromPlayNext: index => set(projectPlaybackQueue(removeManualEntry(navigation(), index))),
  clearPlayNext: () => set(projectPlaybackQueue({ ...navigation(), manual: [] })),
  playFromPlayNext: (index) => {
    const current = navigation()
    const next = playManualEntry(current, index)
    if (next !== current) void activate(next)
  },
  playFromQueue: index => {
    const current = navigation()
    const entry = current.entries[index]
    if (entry) void activate(selectTrack(current, entry.track, undefined, index))
  },
  playFromFuture: index => {
    const current = navigation()
    const next = playFutureEntry(current, index)
    if (next !== current) void activate(next)
  },
  removeFromFuture: index => {
    const current = navigation()
    set(projectPlaybackQueue({ ...current, future: current.future.filter((_, i) => i !== index) }))
  },
  removeFromQueue: index => {
    const current = navigation()
    const next = removeQueueEntry(current, index)
    if (next === current) return
    if (current.current && !next.current) {
      streamRequestId++
      set({ ...projectPlaybackQueue(next), effectiveQuality: null, streamUrl: null, isPlaying: false,
        isFetchingUrl: false, bufferProgress: null, currentTime: 0, duration: 0, seekTarget: null })
    } else set(projectPlaybackQueue(next))
  },
  clearQueue: () => {
    streamRequestId++
    set({
      queue: [],
      navigation: emptyPlaybackQueue(get().playbackMode === 'random'),
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
    })
  },

  toggleQueue: () => set(s => ({ isQueueOpen: !s.isQueueOpen })),
  setQueueOpen: (v) => set({ isQueueOpen: v }),

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
  })
})

// 高频播放进度不触发偏好写入；字段白名单也避免把瞬时状态持久化。
usePlayerStore.subscribe((state, previous) => {
  if (state.volume === previous.volume && state.isMuted === previous.isMuted
    && state.playbackMode === previous.playbackMode && state.quality === previous.quality
    && state.keepScreenAwake === previous.keepScreenAwake && state.preferSurround === previous.preferSurround) return
  const { volume, isMuted, playbackMode, quality, keepScreenAwake, preferSurround } = state
  playerPreferencesStorage.write({ volume, isMuted, playbackMode, quality, keepScreenAwake, preferSurround })
})
