
import { useEffect, useRef } from 'react'
import { usePlayerStore } from '@/lib/store/player-store'
import { useAudioPlayer } from '@/hooks/useAudioPlayer'
import { useMediaSession } from '@/hooks/useMediaSession'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useAuthStore } from '@/hooks/useAuth'
import { cachePlayedTrack, getOfflineCacheLimit } from '@/lib/offline-audio'
import { preparePlaybackResponse, type PlaybackResponseCapture } from '@/lib/playback-response'
import { NowPlaying } from './NowPlaying'
import { PlayerControls } from './PlayerControls'
import { PlayerTools } from './PlayerTools'
import { PlayerButton } from './PlayerButton'
import { MobilePlayerMenu } from './MobilePlayerMenu'
import { TransportButtons } from './TransportButtons'
import { ListMusic } from 'lucide-react'

interface PlayerBarProps {
  audio: HTMLAudioElement | null
  onAudioElement: (audio: HTMLAudioElement | null) => void
  onOpenEqualizer?: () => void
}

export function PlayerBar({ audio, onAudioElement, onOpenEqualizer }: PlayerBarProps) {
  const streamUrl = usePlayerStore(s => s.streamUrl)
  const streamNonce = usePlayerStore(s => s.streamNonce)
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const isFetchingUrl = usePlayerStore(s => s.isFetchingUrl)
  const volume = usePlayerStore(s => s.volume)
  const isMuted = usePlayerStore(s => s.isMuted)
  const seekNonce = usePlayerStore(s => s.seekNonce)
  const toggleQueue = usePlayerStore(s => s.toggleQueue)
  const authenticated = useAuthStore(s => s.authenticated)
  const username = useAuthStore(s => s.username)
  const authLoading = useAuthStore(s => s.loading)
  const mustChangePassword = useAuthStore(s => s.mustChangePassword)
  const sessionRevision = useAuthStore(s => s.sessionRevision)

  const loadedRef = useRef<{ url: string; nonce: number; uid: string; username: string | null; pending?: boolean } | null>(null)
  const captureRef = useRef<PlaybackResponseCapture | null>(null)
  useEffect(() => () => { captureRef.current?.cancel() }, [])

  // 读取缓存或 React 尚未提交新音频源时，旧 Audio 的事件不能写入新曲目的状态。
  const isCurrentStream = () => {
    const state = usePlayerStore.getState()
    const loaded = loadedRef.current
    return !state.isFetchingUrl && !!state.streamUrl && !loaded?.pending && loaded?.url === state.streamUrl
      && loaded.nonce === state.streamNonce && loaded.uid === state.currentTrack?.uid
  }

  useEffect(() => () => {
    if (streamUrl?.startsWith('blob:')) URL.revokeObjectURL(streamUrl)
  }, [streamUrl])

  const { isReady, load, unload, play, pause, seek, setVolume, setMuted } = useAudioPlayer({
    onAudioElement: element => {
      // StrictMode 的 effect 重建会创建新 Audio，不能沿用旧元素的加载记录。
      loadedRef.current = null
      onAudioElement(element)
    },
    onTimeUpdate: t => {
      if (isCurrentStream()) usePlayerStore.getState().setCurrentTime(t)
    },
    onDuration: d => { if (isCurrentStream()) usePlayerStore.getState().setDuration(d) },
    onPlayState: p => {
      if (isCurrentStream()) usePlayerStore.getState().setIsPlaying(p, { fromAudio: true })
    },
    onEnd: () => { if (isCurrentStream()) usePlayerStore.getState().handleTrackEnd() },
    onLoading: pct => { if (isCurrentStream()) usePlayerStore.getState().setBufferProgress(pct) },
    onError: (msg, errCode, wasPlaying) => {
      if (isCurrentStream()) void usePlayerStore.getState().handleTrackError(msg, errCode, wasPlaying)
    },
  })

  useEffect(() => usePlayerStore.subscribe(state => {
    // Zustand 通知同步执行：切歌开始就使旧引擎失效，不等待缓存结果或 React effect。
    if (loadedRef.current && (state.currentTrack?.uid !== loadedRef.current.uid || !state.streamUrl)) {
      loadedRef.current = null
      captureRef.current?.cancel()
      unload()
    }
  }), [unload])

  // 同步当前曲目到 MediaSession（锁屏/通知/耳机控制）
  useMediaSession()
  // PC 端全局键盘快捷键
  useKeyboardShortcuts()

  useEffect(() => {
    if (!isReady || !isPlaying || isFetchingUrl || !streamUrl || streamUrl.startsWith('blob:')) return
    if (!authenticated || !username || authLoading || mustChangePassword || !navigator.onLine) return
    const timer = setTimeout(() => {
      const auth = useAuthStore.getState()
      const state = usePlayerStore.getState()
      if (!state.isFetchingUrl && state.streamUrl === streamUrl && state.streamNonce === streamNonce
        && auth.authenticated && !auth.loading && !auth.mustChangePassword && navigator.onLine
        && auth.username === username && loadedRef.current?.username === username
        && state.currentTrack && state.effectiveQuality) {
        void cachePlayedTrack(auth.username, state.currentTrack, state.effectiveQuality)
      }
    }, 3000)
    return () => clearTimeout(timer)
  }, [isReady, isPlaying, isFetchingUrl, streamUrl, streamNonce, authenticated, username, authLoading, mustChangePassword, sessionRevision])

  // 加载/重播与暂停在同一 effect 中编排，避免状态被 React 合并后漏掉播放命令。
  useEffect(() => {
    if (isFetchingUrl) {
      if (!isPlaying) void pause()
      return
    }
    const currentTrack = usePlayerStore.getState().currentTrack
    if (!streamUrl || !currentTrack) {
      loadedRef.current = null
      captureRef.current?.cancel()
      unload()
      return
    }
    const previous = loadedRef.current
    if (previous?.url !== streamUrl || previous.nonce !== streamNonce) {
      const auth = useAuthStore.getState()
      loadedRef.current = { url: streamUrl, nonce: streamNonce, uid: currentTrack.uid,
        username: auth.offlineUsername ?? auth.username }
      if (previous?.url === streamUrl && !previous.pending && isReady) {
        // 同源重播复用已有缓冲；单曲循环在后台也不依赖 rAF 或布尔值翻转。
        seek(usePlayerStore.getState().currentTime)
        if (isPlaying) void play()
        else void pause()
      } else {
        captureRef.current?.cancel()
        const capture = auth.authenticated && auth.username && !auth.loading && !auth.mustChangePassword
          && navigator.onLine
          ? preparePlaybackResponse(auth.username, streamUrl, getOfflineCacheLimit(auth.username)) : null
        captureRef.current = capture
        if (capture) {
          const loaded = loadedRef.current
          loaded.pending = true
          void capture.ready.then(() => {
            if (loadedRef.current !== loaded) return
            loaded.pending = false
            const state = usePlayerStore.getState()
            void load(streamUrl, state.isPlaying, state.currentTime)
          })
        } else {
          void load(streamUrl, isPlaying, usePlayerStore.getState().currentTime)
        }
      }
      return
    }
    // 播放需等待就绪；暂停不能等待。否则用户在加载/缓冲期间点击暂停，
    // 后续 play()/playing 事件仍可能把音频拉起。
    if (!isPlaying) {
      void pause()
      return
    }
    if (isReady && !loadedRef.current?.pending) void play()
  }, [streamUrl, streamNonce, isPlaying, isFetchingUrl, isReady, load, unload, play, pause, seek])

  useEffect(() => {
    setVolume(volume)
  }, [volume, setVolume])

  useEffect(() => {
    setMuted(isMuted)
  }, [isMuted, setMuted])

  // seek 指令 → 跳转
  useEffect(() => {
    const t = usePlayerStore.getState().seekTarget
    if (t != null && !loadedRef.current?.pending && !usePlayerStore.getState().isFetchingUrl && usePlayerStore.getState().streamUrl) seek(t)
  }, [seekNonce, seek])

  return (
    <footer className="glass-surface player-surface relative z-10 flex shrink-0 flex-col gap-1 rounded-2xl border border-border/60 px-3 py-2 desktop:m-3 desktop:grid desktop:min-h-[100px] desktop:grid-cols-[minmax(0,1fr)_minmax(220px,1.2fr)_minmax(0,1fr)] desktop:items-center desktop:gap-3 desktop:rounded-[22px] desktop:px-4 desktop:py-3">
      {/* 手机将播放和歌曲信息合并成一行，进度单独一行；桌面保持三栏。 */}
      <div className="flex items-center gap-1 desktop:contents">
        <NowPlaying />
        <div className="flex items-center desktop:hidden">
          <TransportButtons compact />
          <PlayerButton icon={ListMusic} label="队列" onClick={toggleQueue} size="sm" />
          <MobilePlayerMenu onOpenEqualizer={onOpenEqualizer} />
        </div>
      </div>
      <PlayerControls audio={audio} isPlaying={isPlaying} />
      <PlayerTools onOpenEqualizer={onOpenEqualizer} />
    </footer>
  )
}
