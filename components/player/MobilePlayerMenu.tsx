/**
 * 手机端「更多」菜单（低频功能入口收纳）。
 *
 * 手机播放栏空间有限：高频的歌词/队列直接放行1按钮，低频的播放模式/音质/定时器/音量
 * 收进此菜单。popover 参考 SongContextMenu 的 outside-click + ESC 模式（手撸，无新依赖）。
 */

import { useEffect, useRef, useState } from 'react'
import { usePlayerStore } from '@/lib/store/player-store'
import { ProgressBar } from './ProgressBar'
import { PlayerButton } from './PlayerButton'
import { MoreHorizontal, Repeat, Repeat1, Shuffle, Timer, Volume2, VolumeX } from 'lucide-react'
import type { QualityType } from '@/lib/types/music'

const QUALITY_CYCLE: QualityType[] = ['320k', 'flac', 'flac24bit', '128k']
const QUALITY_LABEL: Record<QualityType, string> = {
  '320k': '320K',
  '128k': '128K',
  flac: 'FLAC',
  flac24bit: 'Hi-Res',
}

export function MobilePlayerMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const playbackMode = usePlayerStore(s => s.playbackMode)
  const cyclePlaybackMode = usePlayerStore(s => s.cyclePlaybackMode)
  const quality = usePlayerStore(s => s.quality)
  const setQuality = usePlayerStore(s => s.setQuality)
  const sleepTimer = usePlayerStore(s => s.sleepTimer)
  const cycleSleepTimer = usePlayerStore(s => s.cycleSleepTimer)
  const volume = usePlayerStore(s => s.volume)
  const isMuted = usePlayerStore(s => s.isMuted)
  const setVolume = usePlayerStore(s => s.setVolume)
  const toggleMute = usePlayerStore(s => s.toggleMute)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const ModeIcon = playbackMode === 'loop' ? Repeat1 : playbackMode === 'random' ? Shuffle : Repeat
  const modeLabel = playbackMode === 'loop' ? '单曲循环' : playbackMode === 'random' ? '随机播放' : '顺序播放'
  const VolIcon = isMuted || volume === 0 ? VolumeX : Volume2

  const cycleQuality = () => {
    const i = QUALITY_CYCLE.indexOf(quality)
    setQuality(QUALITY_CYCLE[(i + 1) % QUALITY_CYCLE.length])
  }

  return (
    <div className="relative" ref={ref}>
      <PlayerButton icon={MoreHorizontal} label="更多" onClick={() => setOpen(v => !v)} active={open} size="sm" />
      {open && (
        <div className="fixed bottom-20 right-2 z-50 w-60 rounded-md border border-border bg-card p-2 shadow-lg">
          <button
            type="button"
            onClick={cyclePlaybackMode}
            className="flex w-full items-center justify-between rounded-md px-2 py-2.5 text-sm hover:bg-accent"
          >
            <span className="flex items-center gap-2">
              <ModeIcon className="h-4 w-4" /> 播放模式
            </span>
            <span className="text-xs text-muted-foreground">{modeLabel}</span>
          </button>

          <button
            type="button"
            onClick={cycleQuality}
            className="flex w-full items-center justify-between rounded-md px-2 py-2.5 text-sm hover:bg-accent"
          >
            <span>音质</span>
            <span className="text-xs text-muted-foreground">{QUALITY_LABEL[quality]}</span>
          </button>

          <button
            type="button"
            onClick={cycleSleepTimer}
            className="flex w-full items-center justify-between rounded-md px-2 py-2.5 text-sm hover:bg-accent"
          >
            <span className="flex items-center gap-2">
              <Timer className="h-4 w-4" /> 定时关闭
            </span>
            <span className={`text-xs ${sleepTimer ? 'text-primary' : 'text-muted-foreground'}`}>
              {sleepTimer ? `${sleepTimer.minutes} 分钟` : '关闭'}
            </span>
          </button>

          <div className="mt-1 flex items-center gap-2 border-t border-border px-2 pt-2">
            <PlayerButton icon={VolIcon} label={isMuted ? '取消静音' : '静音'} onClick={toggleMute} size="sm" active={isMuted} />
            <ProgressBar value={isMuted ? 0 : volume * 100} onChange={pct => setVolume(pct / 100)} />
          </div>
        </div>
      )}
    </div>
  )
}
