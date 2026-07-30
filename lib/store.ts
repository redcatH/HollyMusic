/**
 * Zustand 全局状态管理
 */
import { create } from 'zustand'
import type { StateCreator } from 'zustand'
import type { MusicInfo } from '@/lib/types/music'
import { historyDb } from './local-db'

// 播放模式类型定义
export type PlaybackMode = 'loop' | 'sequence' | 'random'

export interface CurrentMusic {
  id: string
  name: string
  artist: string
  album: string
  duration: number
  cover?: string
  source: string
  // 注意：originUrl 已移除，改为在 store 中统一管理 currentMusicUrl
}

export interface PlayerState {
  // 音乐数据
  currentMusic: CurrentMusic | null
  currentMusicUrl: string | null          // ✨ 新增：当前播放 URL
  isFetchingUrl: boolean                  // ✨ 新增：正在获取 URL
  urlFetchError: string | null            // ✨ 新增：URL 获取错误

  // 播放状态
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  playlist: CurrentMusic[]
  playlistIndex: number
  playbackMode: PlaybackMode              // ✨ 新增：播放模式（默认单曲循环）
  isDarkMode: boolean
  sidebarOpen: boolean

  // 播放器操作
  setCurrentMusic: (music: CurrentMusic | null) => void
  setIsPlaying: (playing: boolean) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setVolume: (volume: number) => void
  setPlaylist: (playlist: CurrentMusic[]) => void
  setPlaylistIndex: (index: number) => void
  removeFromPlaylist: (index: number) => void
  cyclePlaybackMode: () => void            // ✨ 新增：循环切换播放模式

  // ✨ 新增：核心方法 - 加载音乐和 URL
  loadMusicAndUrl: (musicInfo: MusicInfo, quality?: string) => Promise<void>

  // UI 操作
  toggleDarkMode: () => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
}

const playerStoreCreator: StateCreator<PlayerState> = (set) => ({
  // 初始状态
  currentMusic: null,
  currentMusicUrl: null,
  isFetchingUrl: false,
  urlFetchError: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  playlist: [],
  playlistIndex: -1,
  playbackMode: 'loop',  // ✨ 默认单曲循环
  isDarkMode: false,
  sidebarOpen: false,

  // 同步方法
  setCurrentMusic: (music) => set({ currentMusic: music }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
  setPlaylist: (playlist) => set({ playlist }),
  setPlaylistIndex: (index) => set({ playlistIndex: index }),
  removeFromPlaylist: (index) => set((state) => {
    const newPlaylist = state.playlist.filter((_, i) => i !== index)
    return { playlist: newPlaylist }
  }),

  // ✨ 播放模式循环切换：loop → sequence → random → loop
  cyclePlaybackMode: () => set((state) => {
    const modes: PlaybackMode[] = ['loop', 'sequence', 'random']
    const currentIndex = modes.indexOf(state.playbackMode)
    const nextIndex = (currentIndex + 1) % modes.length
    const nextMode = modes[nextIndex]
    console.log('store: 切换播放模式', { from: state.playbackMode, to: nextMode })
    return { playbackMode: nextMode }
  }),

  // ✨ 核心异步方法：加载音乐和 URL
  loadMusicAndUrl: async (musicInfo: MusicInfo, quality = '128k', saveToHistory = true) => {
    try {
      set({ isFetchingUrl: true, urlFetchError: null })

      // 构建请求体
      const requestBody = {
        musicInfo: {
          name: musicInfo.name,
          singer: musicInfo.singer,
          source: musicInfo.source,
          songmid: musicInfo.songmid,
          _types: musicInfo._types,
        },
        quality,
      }

      console.log('store: 开始获取音乐 URL', requestBody)

      // 调用 API 获取 URL
      const response = await fetch('/api/music-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      const data = await response.json()
      console.log('store: 获取 URL 响应', data)

      if (!data.success || !data.data?.url) {
        const errorMsg = data.error?.message || '无法获取音乐 URL'
        throw new Error(errorMsg)
      }

      // 构建代理 URL
      const proxyUrl = `/api/proxy/${encodeURIComponent(data.data.url)}`

      // 映射 MusicInfo 到 CurrentMusic
      const currentMusic: CurrentMusic = {
        id: musicInfo.songmid,
        name: musicInfo.name,
        artist: musicInfo.singer,
        album: musicInfo.albumName || '',
        duration: musicInfo.interval ? parseInt(musicInfo.interval) : 0,
        cover: musicInfo.img || undefined,
        source: musicInfo.source,
      }

      // 更新状态：设置当前歌曲、URL、播放列表
      // 注意：暂时不设置 isPlaying，让 BottomPlayer 的 effect 统一处理加载和播放
      set({
        currentMusic,
        currentMusicUrl: proxyUrl,
        playlist: [currentMusic],
        isFetchingUrl: false,
      })

      // 加载完成后，设置 isPlaying 来触发播放
      // 使用 setTimeout 延迟一下，确保 currentMusicUrl 已经更新
      setTimeout(() => {
        set({ isPlaying: true })
      }, 0)

      console.log('store: 音乐 URL 加载完成', currentMusic.name)

      // ✨ 保存完整的 MusicInfo 到历史记录（包含 types 和 _types）
      if (saveToHistory) {
        await historyDb.addOrUpdate(musicInfo)
        console.log('store: 已保存到播放历史', musicInfo.name)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误'
      console.error('store: 音乐加载失败', errorMsg)
      set({
        isFetchingUrl: false,
        urlFetchError: errorMsg,
        currentMusicUrl: null,
      })
      throw error
    }
  },

  // UI 操作
  toggleDarkMode: () => set((state) => ({ isDarkMode: !state.isDarkMode })),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
})

export const usePlayerStore = create<PlayerState>(playerStoreCreator)
