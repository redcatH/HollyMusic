'use client'

import { useEffect } from 'react'
import { usePlayerStore } from '@/lib/store/player-store'
import { useAudioPlayer } from '@/hooks/useAudioPlayer'
import { useMediaSession } from '@/hooks/useMediaSession'
import { NowPlaying } from './NowPlaying'
import { PlayerControls } from './PlayerControls'
import { VolumeControl } from './VolumeControl'

export function PlayerBar() {
  const streamUrl = usePlayerStore(s => s.streamUrl)
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const volume = usePlayerStore(s => s.volume)
  const isMuted = usePlayerStore(s => s.isMuted)
  const seekNonce = usePlayerStore(s => s.seekNonce)

  const { load, play, pause, seek, setVolume, setMuted } = useAudioPlayer({
    onTimeUpdate: t => usePlayerStore.getState().setCurrentTime(t),
    onDuration: d => usePlayerStore.getState().setDuration(d),
    onPlayState: p => usePlayerStore.getState().setIsPlaying(p),
    onEnd: () => usePlayerStore.getState().handleTrackEnd(),
    onLoading: pct => usePlayerStore.getState().setBufferProgress(pct),
    onError: msg => usePlayerStore.getState().handleTrackError(msg),
  })

  // 同步当前曲目到 MediaSession（锁屏/通知/耳机控制）
  useMediaSession()

  // streamUrl 变化 → 加载音频
  useEffect(() => {
    if (!streamUrl) return
    load(streamUrl, usePlayerStore.getState().isPlaying)
  }, [streamUrl, load])

  // isPlaying 变化 → 播放/暂停
  useEffect(() => {
    if (isPlaying) play()
    else pause()
  }, [isPlaying, play, pause])

  useEffect(() => {
    setVolume(volume)
  }, [volume, setVolume])

  useEffect(() => {
    setMuted(isMuted)
  }, [isMuted, setMuted])

  // seek 指令 → 跳转
  useEffect(() => {
    const t = usePlayerStore.getState().seekTarget
    if (t != null) seek(t)
  }, [seekNonce, seek])

  return (
    <footer className="safe-area-bottom flex items-center justify-between gap-4 border-t border-border bg-card px-4 py-3">
      <NowPlaying />
      <PlayerControls />
      <VolumeControl />
    </footer>
  )
}
