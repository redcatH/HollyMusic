
/**
 * Media Session API 封装
 *
 * 监听 player-store 的当前曲目与播放状态，同步到 navigator.mediaSession：
 * - 锁屏/通知栏/耳机按钮显示歌名、歌手、封面
 * - 绑定 play / pause / next / previous 控制按钮
 *
 * 组件只需挂载一次：<useMediaSession />
 */

import { useEffect } from 'react'
import { usePlayerStore } from '@/lib/store/player-store'
import { buildCoverUrl } from '@/lib/api/music'
import type { Track } from '@/lib/types/player'

export function useMediaSession() {
  const currentTrack = usePlayerStore(s => s.currentTrack)
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const duration = usePlayerStore(s => s.duration)
  const currentTime = usePlayerStore(s => s.currentTime)

  // 设置元数据 + action handler（依赖 currentTrack）
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('mediaSession' in navigator)) return
    if (!currentTrack) {
      navigator.mediaSession.metadata = null
      return
    }

    // 元数据
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.name,
      artist: currentTrack.artist,
      album: currentTrack.album || 'Holly Music',
      artwork: buildArtwork(currentTrack),
    })

    // 控制按钮（直接调 store，避免与 PlayerBar 的 play/pause 重复）
    const store = usePlayerStore.getState()
    navigator.mediaSession.setActionHandler('play', () => {
      if (!usePlayerStore.getState().isPlaying) usePlayerStore.getState().setIsPlaying(true)
    })
    navigator.mediaSession.setActionHandler('pause', () => {
      if (usePlayerStore.getState().isPlaying) usePlayerStore.getState().setIsPlaying(false)
    })
    navigator.mediaSession.setActionHandler('nexttrack', () => store.next())
    navigator.mediaSession.setActionHandler('previoustrack', () => store.previous())
    // seek 支持（耳机线控/锁屏进度条）
    try {
      navigator.mediaSession.setActionHandler('seekto', (details: MediaSessionActionDetails) => {
        if (details.seekTime != null) usePlayerStore.getState().seek(details.seekTime)
      })
    } catch {
      /* seekto 部分浏览器不支持，忽略 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack])

  // 同步播放状态 + 位置状态（依赖 isPlaying / duration / currentTime）
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('mediaSession' in navigator)) return

    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'

    if ('setPositionState' in navigator.mediaSession && duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration,
          position: Math.min(currentTime, duration),
          playbackRate: 1,
        })
      } catch {
        /* 部分浏览器对异常参数会抛错，忽略 */
      }
    }
  }, [isPlaying, duration, currentTime])
}

/** 生成 MediaSession artwork 列表（各尺寸封面） */
function buildArtwork(track: Track) {
  const url = buildCoverUrl(track.uid)
  // 同一张封面用不同尺寸声明，浏览器自选最合适的
  return [
    { src: url, sizes: '96x96', type: 'image/png' },
    { src: url, sizes: '128x128', type: 'image/png' },
    { src: url, sizes: '192x192', type: 'image/png' },
    { src: url, sizes: '256x256', type: 'image/png' },
    { src: url, sizes: '384x384', type: 'image/png' },
    { src: url, sizes: '512x512', type: 'image/png' },
  ]
}
