
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
  const streamNonce = usePlayerStore(s => s.streamNonce)
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const volume = usePlayerStore(s => s.volume)
  const isMuted = usePlayerStore(s => s.isMuted)
  const seekNonce = usePlayerStore(s => s.seekNonce)
  const toggleLyrics = usePlayerStore(s => s.toggleLyrics)
  const toggleQueue = usePlayerStore(s => s.toggleQueue)

  const loadedRef = useRef<{ url: string; nonce: number } | null>(null)

  const { isReady, load, play, pause, seek, setVolume, setMuted } = useAudioPlayer({
    onAudioElement: element => {
      // StrictMode 的 effect 重建会创建新 Audio，不能沿用旧元素的加载记录。
      loadedRef.current = null
      onAudioElement(element)
    },
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

  // 加载/重播与暂停在同一 effect 中编排，避免状态被 React 合并后漏掉播放命令。
  useEffect(() => {
    if (!streamUrl) {
      loadedRef.current = null
      void pause()
      return
    }
    const previous = loadedRef.current
    if (previous?.url !== streamUrl || previous.nonce !== streamNonce) {
      loadedRef.current = { url: streamUrl, nonce: streamNonce }
      if (previous?.url === streamUrl && isReady) {
        // 同源重播复用已有缓冲；单曲循环在后台也不依赖 rAF 或布尔值翻转。
        seek(0)
        if (isPlaying) void play()
        else void pause()
      } else {
        void load(streamUrl, isPlaying)
      }
      return
    }
    // 播放需等待就绪；暂停不能等待。否则用户在加载/缓冲期间点击暂停，
    // 后续 play()/playing 事件仍可能把音频拉起。
    if (!isPlaying) {
      void pause()
      return
    }
    if (isReady) void play()
  }, [streamUrl, streamNonce, isPlaying, isReady, load, play, pause, seek])

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
