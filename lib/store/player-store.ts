/**
 * 播放器全局状态（zustand）
 * 管理播放队列、当前曲目、播放状态、播放模式、UI 面板。
 * 音频引擎（howler）在 useAudioPlayer 中，由 PlayerBar 编排 store 与音频。
 */

import { create } from 'zustand'
import type { Track, PlaybackMode } from '@/lib/types/player'
import { getMusicUrl, buildStreamUrl } from '@/lib/api/music'
import { reportPlay } from '@/lib/api/history'
import { useAuthStore } from '@/hooks/useAuth'

/** 仅在已登录时上报播放历史，匿名跳过（/api/history 受保护） */
function reportPlayIfAuthed(musicInfo: Track['musicInfo']) {
  if (useAuthStore.getState().authenticated) {
    reportPlay(musicInfo).catch(() => {})
  }
}

interface PlayerStore {
  // 队列与当前
  queue: Track[]
  currentIndex: number
  currentTrack: Track | null
  streamUrl: string | null
  isFetchingUrl: boolean
  urlFetchError: string | null

  // 播放状态
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  playbackMode: PlaybackMode

  // seek 指令（通过 nonce 触发音频 seek）
  seekTarget: number | null
  seekNonce: number

  // UI 面板
  isQueueOpen: boolean
  isLyricsOpen: boolean

  // 核心动作
  playTrack: (track: Track, queue?: Track[]) => Promise<void>
  loadStreamUrl: (track: Track) => Promise<void>
  togglePlay: () => void
  setIsPlaying: (v: boolean) => void
  setCurrentTime: (t: number) => void
  setDuration: (d: number) => void
  seek: (t: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  cyclePlaybackMode: () => void

  next: () => void
  previous: () => void
  handleTrackEnd: () => void

  // 队列操作
  addToQueue: (track: Track) => void
  addNext: (track: Track) => void
  removeFromQueue: (index: number) => void
  clearQueue: () => void

  // UI
  toggleQueue: () => void
  setQueueOpen: (v: boolean) => void
  toggleLyrics: () => void
  setLyricsOpen: (v: boolean) => void
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  queue: [],
  currentIndex: -1,
  currentTrack: null,
  streamUrl: null,
  isFetchingUrl: false,
  urlFetchError: null,

  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  isMuted: false,
  playbackMode: 'sequence',

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
    set({ currentTrack: track, currentTime: 0, duration: 0, urlFetchError: null })
    await get().loadStreamUrl(track)
    reportPlayIfAuthed(track.musicInfo)
  },

  loadStreamUrl: async (track) => {
    console.log('[diag] loadStreamUrl', track?.name)
    set({ isFetchingUrl: true, urlFetchError: null })
    try {
      const { url } = await getMusicUrl(track.musicInfo, '320k')
      set({ streamUrl: buildStreamUrl(url), isFetchingUrl: false, isPlaying: true })
    } catch (e) {
      set({
        isFetchingUrl: false,
        urlFetchError: e instanceof Error ? e.message : '获取播放链接失败',
        streamUrl: null,
        isPlaying: false,
      })
    }
  },

  togglePlay: () => {
    console.log('[diag] togglePlay, isPlaying=', get().isPlaying)
    set(s => (s.currentTrack ? { isPlaying: !s.isPlaying } : {}))
  },
  setIsPlaying: (v) => set({ isPlaying: v }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setDuration: (d) => set({ duration: d }),
  seek: (t) => set(s => ({ currentTime: t, seekTarget: t, seekNonce: s.seekNonce + 1 })),
  setVolume: (v) => set({ volume: Math.max(0, Math.min(1, v)), isMuted: false }),
  toggleMute: () => set(s => ({ isMuted: !s.isMuted })),
  cyclePlaybackMode: () =>
    set(s => {
      const modes: PlaybackMode[] = ['sequence', 'loop', 'random']
      const i = modes.indexOf(s.playbackMode)
      return { playbackMode: modes[(i + 1) % modes.length] }
    }),

  next: () => {
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
    set({ currentIndex: nextIndex, currentTrack: track, currentTime: 0, duration: 0 })
    get().loadStreamUrl(track)
    reportPlayIfAuthed(track.musicInfo)
  },

  previous: () => {
    const { queue, currentIndex, currentTime } = get()
    if (queue.length === 0) return
    if (currentTime > 3) {
      get().seek(0)
      return
    }
    const prevIndex = (currentIndex - 1 + queue.length) % queue.length
    const track = queue[prevIndex]
    set({ currentIndex: prevIndex, currentTrack: track, currentTime: 0, duration: 0 })
    get().loadStreamUrl(track)
    reportPlayIfAuthed(track.musicInfo)
  },

  handleTrackEnd: () => {
    const { playbackMode, queue, currentIndex } = get()
    if (queue.length === 0) return
    if (playbackMode === 'loop') {
      // 单曲循环：回到开头重新播放（onEnd 已将 isPlaying 置 false，此处 true 触发播放）
      set({ currentTime: 0, seekTarget: 0, seekNonce: get().seekNonce + 1, isPlaying: true })
      return
    }
    if (playbackMode === 'sequence' && currentIndex >= queue.length - 1) {
      // 顺序播放到末尾：停止
      set({ isPlaying: false, currentTime: 0 })
      return
    }
    get().next()
  },

  addToQueue: (track) =>
    set(s => (s.queue.some(t => t.uid === track.uid) ? {} : { queue: [...s.queue, track] })),
  addNext: (track) =>
    set(s => {
      if (s.queue.some(t => t.uid === track.uid)) return {}
      const newQueue = [...s.queue]
      newQueue.splice(s.currentIndex + 1, 0, track)
      return { queue: newQueue }
    }),
  removeFromQueue: (index) =>
    set(s => {
      if (index < 0 || index >= s.queue.length) return {}
      const newQueue = s.queue.filter((_, i) => i !== index)
      let newIndex = s.currentIndex
      let newTrack = s.currentTrack
      if (index < s.currentIndex) newIndex = s.currentIndex - 1
      else if (index === s.currentIndex) {
        newIndex = -1
        newTrack = null
      }
      return { queue: newQueue, currentIndex: newIndex, currentTrack: newTrack }
    }),
  clearQueue: () =>
    set({ queue: [], currentIndex: -1, currentTrack: null, streamUrl: null, isPlaying: false }),

  toggleQueue: () => set(s => ({ isQueueOpen: !s.isQueueOpen })),
  setQueueOpen: (v) => set({ isQueueOpen: v }),
  toggleLyrics: () => set(s => ({ isLyricsOpen: !s.isLyricsOpen })),
  setLyricsOpen: (v) => set({ isLyricsOpen: v }),
}))
