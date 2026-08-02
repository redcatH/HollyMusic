
import { usePlayerStore } from '@/lib/store/player-store'
import { ProgressBar } from './ProgressBar'
import { Play, Pause, SkipBack, SkipForward, Repeat, Repeat1, Shuffle, Loader2 } from 'lucide-react'
import { formatTime } from '@/lib/utils/format'

export function PlayerControls() {
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const currentTrack = usePlayerStore(s => s.currentTrack)
  const currentTime = usePlayerStore(s => s.currentTime)
  const duration = usePlayerStore(s => s.duration)
  const playbackMode = usePlayerStore(s => s.playbackMode)
  const bufferProgress = usePlayerStore(s => s.bufferProgress)
  const togglePlay = usePlayerStore(s => s.togglePlay)
  const next = usePlayerStore(s => s.next)
  const previous = usePlayerStore(s => s.previous)
  const cyclePlaybackMode = usePlayerStore(s => s.cyclePlaybackMode)
  const seek = usePlayerStore(s => s.seek)

  const buffering = bufferProgress !== null
  const ModeIcon = playbackMode === 'loop' ? Repeat1 : playbackMode === 'random' ? Shuffle : Repeat
  // 下载中：进度条显示下载进度；否则显示播放进度
  const progressValue = buffering
    ? bufferProgress
    : duration > 0
      ? (currentTime / duration) * 100
      : 0

  return (
    <div className="flex flex-1 flex-col items-center gap-1">
      <div className="flex items-center gap-3 md:gap-4">
        <button
          onClick={cyclePlaybackMode}
          className={`hover:text-foreground ${playbackMode !== 'sequence' ? 'text-primary' : 'text-muted-foreground'}`}
          aria-label="播放模式"
          title={playbackMode === 'loop' ? '单曲循环' : playbackMode === 'random' ? '随机播放' : '顺序播放'}
        >
          <ModeIcon className="h-4 w-4" />
        </button>
        <button onClick={previous} className="text-muted-foreground hover:text-foreground" aria-label="上一首">
          <SkipBack className="h-5 w-5 fill-current" />
        </button>
        <button
          onClick={togglePlay}
          disabled={buffering}
          className="rounded-full bg-foreground p-2 text-background transition hover:scale-105 disabled:opacity-60 disabled:hover:scale-100"
          aria-label="播放/暂停"
        >
          {buffering ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-5 w-5 fill-current" />
          ) : (
            <Play className="h-5 w-5 fill-current" />
          )}
        </button>
        <button onClick={next} className="text-muted-foreground hover:text-foreground" aria-label="下一首">
          <SkipForward className="h-5 w-5 fill-current" />
        </button>
        <div className="w-4" />
      </div>
      <div className="hidden w-full max-w-xl items-center gap-2 md:flex">
        <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
          {buffering ? `${bufferProgress}%` : formatTime(currentTime)}
        </span>
        <ProgressBar
          value={progressValue}
          onChange={pct => seek((pct / 100) * duration)}
          disabled={!currentTrack || buffering}
        />
        <span className="w-10 text-xs tabular-nums text-muted-foreground">
          {buffering ? '加载' : formatTime(duration)}
        </span>
      </div>
    </div>
  )
}
