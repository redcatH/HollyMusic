/**
 * Zustand 全局状态管理
 */
import { create } from 'zustand'
import type { StateCreator } from 'zustand'

export interface CurrentMusic {
  id: string
  name: string
  artist: string
  album: string
  duration: number
  cover?: string
  source: string
  originUrl?: string
}

export interface PlayerState {
  currentMusic: CurrentMusic | null
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  playlist: CurrentMusic[]
  playlistIndex: number
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

  // UI 操作
  toggleDarkMode: () => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
}

const playerStoreCreator: StateCreator<PlayerState> = (set) => ({
  currentMusic: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  playlist: [],
  playlistIndex: -1,
  isDarkMode: false,
  sidebarOpen: true,

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

  toggleDarkMode: () => set((state) => ({ isDarkMode: !state.isDarkMode })),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
})

export const usePlayerStore = create<PlayerState>(playerStoreCreator)
