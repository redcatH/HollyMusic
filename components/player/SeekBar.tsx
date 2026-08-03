/**
 * 播放进度条 + 时间显示。
 * 桌面（PlayerControls 下栏）与手机（PlayerBar 行2）共用。
 *
 * 输出三项（时间 / ProgressBar / 时间），调用方提供 flex 容器：
 *   <div className="flex items-center gap-2"><SeekBar /></div>
 * ProgressBar 自身 flex-1 撑满。
 */

import { usePlayerStore } from '@/lib/store/player-store'
import { ProgressBar } from './ProgressBar'
import { formatTime } from '@/lib/utils/format'

export function SeekBar() {
  const currentTrack = usePlayerStore(s => s.currentTrack)
  const currentTime = usePlayerStore(s => s.currentTime)
  const duration = usePlayerStore(s => s.duration)
  const bufferProgress = usePlayerStore(s => s.bufferProgress)
  const seek = usePlayerStore(s => s.seek)

  const buffering = bufferProgress !== null
  const progressValue = buffering
    ? bufferProgress
    : duration > 0
      ? (currentTime / duration) * 100
      : 0

  return (
    <>
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {buffering ? `${bufferProgress}%` : formatTime(currentTime)}
      </span>
      <ProgressBar
        value={progressValue}
        onChange={pct => seek((pct / 100) * duration)}
        disabled={!currentTrack || buffering}
      />
      <span className="w-9 shrink-0 text-xs tabular-nums text-muted-foreground">
        {buffering ? '加载' : formatTime(duration)}
      </span>
    </>
  )
}
