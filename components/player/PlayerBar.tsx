
import { useEffect, useRef } from 'react'
import { usePlayerStore } from '@/lib/store/player-store'
import { useAudioPlayer } from '@/hooks/useAudioPlayer'
import { useMediaSession } from '@/hooks/useMediaSession'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { NowPlaying } from './NowPlaying'
import { PlayerControls } from './PlayerControls'
import { PlayerTools } from './PlayerTools'
import { PlayerButton } from './PlayerButton'
import { MobilePlayerMenu } from './MobilePlayerMenu'
import { Mic2, ListMusic } from 'lucide-react'

interface PlayerBarProps {
  audio: HTMLAudioElement | null
  onAudioElement: (audio: HTMLAudioElement | null) => void
}

export function PlayerBar({ audio, onAudioElement }: PlayerBarProps) {
  const streamUrl = usePlayerStore(s => s.streamUrl)
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const volume = usePlayerStore(s => s.volume)
  const isMuted = usePlayerStore(s => s.isMuted)
  const seekNonce = usePlayerStore(s => s.seekNonce)
  const toggleLyrics = usePlayerStore(s => s.toggleLyrics)
  const toggleQueue = usePlayerStore(s => s.toggleQueue)

  /**
   * loadSeq：每次 streamUrl 变化自增。
   * play/pause effect 用它判断 isPlaying 变化是否由「切歌」引起——
   * 若是，跳过本次 play()，由 load(autoplay=true) 接管，避免 Howler 叠加双实例。
   */
  const loadSeqRef = useRef(0)
  const skipNextPlayPauseRef = useRef(false)

  const { isReady, load, play, pause, seek, setVolume, setMuted } = useAudioPlayer({
    onAudioElement,
    onTimeUpdate: t => usePlayerStore.getState().setCurrentTime(t),
    onDuration: d => usePlayerStore.getState().setDuration(d),
    onPlayState: p => usePlayerStore.getState().setIsPlaying(p),
    onEnd: () => usePlayerStore.getState().handleTrackEnd(),
    onLoading: pct => usePlayerStore.getState().setBufferProgress(pct),
    onError: (msg, errCode) => usePlayerStore.getState().handleTrackError(msg, errCode),
  })

  // 同步当前曲目到 MediaSession（锁屏/通知/耳机控制）
  useMediaSession()
  // PC 端全局键盘快捷键
  useKeyboardShortcuts()

  // streamUrl 变化 → 加载音频（load 内部决定是否 autoplay）
  useEffect(() => {
    if (!streamUrl) return
    loadSeqRef.current++
    skipNextPlayPauseRef.current = true // 切歌引起的 isPlaying 变化由 load 接管
    load(streamUrl, usePlayerStore.getState().isPlaying)
  }, [streamUrl, load])

  // isPlaying 变化 → 播放/暂停（跳过切歌引起的那一次，避免与 autoplay 叠加双实例）
  useEffect(() => {
    if (skipNextPlayPauseRef.current) {
      skipNextPlayPauseRef.current = false
      return
    }
    // 音频未 ready 时不主动调 play/pause（Howler 会排队，可能叠加）
    if (!isReady) return
    if (isPlaying) play()
    else pause()
  }, [isPlaying, isReady, play, pause])

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
    <footer className="safe-area-bottom flex flex-col gap-2 border-t border-border bg-card px-3 py-3 md:min-h-[136px] md:flex-row md:items-center md:justify-between md:gap-4 md:px-4">
      {/* 单一 DOM 布局：桌面端横排三栏，移动端纵向排列。频谱只保留一张 canvas。 */}
      <div className="flex items-center gap-1 md:contents">
        <NowPlaying />
        <div className="flex items-center md:hidden">
          <PlayerButton icon={Mic2} label="歌词" onClick={toggleLyrics} size="sm" />
          <PlayerButton icon={ListMusic} label="队列" onClick={toggleQueue} size="sm" />
          <MobilePlayerMenu />
        </div>
      </div>
      <PlayerControls audio={audio} isPlaying={isPlaying} />
      <PlayerTools />
    </footer>
  )
}
