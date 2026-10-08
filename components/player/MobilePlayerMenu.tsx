/**
 * 手机端「更多」菜单（低频功能入口收纳）。
 *
 * 手机播放栏空间有限：高频的歌词/队列直接放行1按钮，低频的播放模式/音质/定时器/音量
 * 收进此菜单。popover 参考 SongContextMenu 的 outside-click + ESC 模式（手撸，无新依赖）。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePlayerStore } from '@/lib/store/player-store'
import { useFavoritesStore } from '@/lib/store/favorites-store'
import { shareContent, buildSongShareUrl } from '@/lib/share'
import { toast } from '@/lib/toast'
import { ProgressBar } from './ProgressBar'
import { PlayerButton } from './PlayerButton'
import { QualityList } from './QualityList'
import { MoreHorizontal, Repeat, Repeat1, Shuffle, Timer, Volume2, VolumeX, ChevronDown, SkipBack, SkipForward, Heart, Share2, Mic2 } from 'lucide-react'
import { QUALITY_LABEL, QUALITY_ORDER } from '@/lib/quality-options'

export function MobilePlayerMenu() {
  const [open, setOpen] = useState(false)
  const [qualityOpen, setQualityOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<number | null>(null)

  const playbackMode = usePlayerStore(s => s.playbackMode)
  const cyclePlaybackMode = usePlayerStore(s => s.cyclePlaybackMode)
  const quality = usePlayerStore(s => s.quality)
  const setQuality = usePlayerStore(s => s.setQuality)
  const currentTrack = usePlayerStore(s => s.currentTrack)
  const previous = usePlayerStore(s => s.previous)
  const next = usePlayerStore(s => s.next)
  const toggleLyrics = usePlayerStore(s => s.toggleLyrics)
  const isFav = useFavoritesStore(s => currentTrack ? s.ids.has(currentTrack.uid) : false)
  const toggleFavorite = useFavoritesStore(s => s.toggle)
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

  // 测量触发器位置：悬浮窗贴其顶部上方展开，避免被播放栏遮挡（固定 bottom 值不够高）
  useLayoutEffect(() => {
    if (!open || !ref.current) {
      setPos(null)
      return
    }
    const r = ref.current.getBoundingClientRect()
    setPos(window.innerHeight - r.top + 8)
  }, [open])

  const ModeIcon = playbackMode === 'loop' ? Repeat1 : playbackMode === 'random' ? Shuffle : Repeat
  const modeLabel = playbackMode === 'loop' ? '单曲循环' : playbackMode === 'random' ? '随机播放' : '顺序播放'
  const VolIcon = isMuted || volume === 0 ? VolumeX : Volume2

  const types = currentTrack?.musicInfo.types
  // 偏好选择器：始终列出全部音质，不随歌曲变动（实际播放音质由歌名旁标签显示）
  const qualityItems = QUALITY_ORDER

  return (
    <div className="relative" ref={ref}>
      <PlayerButton icon={MoreHorizontal} label="更多" onClick={() => setOpen(v => !v)} active={open} size="sm" />
      {open && (
        <div
          className="mobile-player-menu fixed right-2 z-50 w-64 overflow-y-auto rounded-2xl border border-border bg-card p-2 shadow-lg"
          style={{ bottom: pos ?? 80 }}
        >
          <div className="mb-1 flex justify-between border-b border-border/60 pb-2">
            <PlayerButton icon={SkipBack} label="上一首" onClick={previous} disabled={!currentTrack} />
            <PlayerButton icon={SkipForward} label="下一首" onClick={next} disabled={!currentTrack} />
            <PlayerButton icon={Heart} label={isFav ? '取消收藏' : '收藏'} active={isFav} disabled={!currentTrack} onClick={() => {
              if (currentTrack) void toggleFavorite(currentTrack.uid).catch(() => toast.error('收藏操作失败，请重试'))
            }} />
            <PlayerButton icon={Share2} label="分享" disabled={!currentTrack} onClick={() => {
              if (currentTrack) void shareContent({ title: currentTrack.name, text: `${currentTrack.name} - ${currentTrack.artist}`, url: buildSongShareUrl(currentTrack.uid) })
            }} />
          </div>
          <button type="button" onClick={() => { setOpen(false); toggleLyrics() }} disabled={!currentTrack} className="flex w-full items-center gap-2 rounded-xl px-2 py-2.5 text-sm hover:bg-accent disabled:opacity-50"><Mic2 className="h-4 w-4" /> 查看歌词</button>
          <button
            type="button"
            onClick={cyclePlaybackMode}
            className="flex w-full items-center justify-between rounded-md px-2 py-2.5 text-[11px] hover:bg-accent"
          >
            <span className="flex items-center gap-2">
              <ModeIcon className="h-4 w-4" /> 播放模式
            </span>
            <span className="text-[11px] text-muted-foreground">{modeLabel}</span>
          </button>

          <button
            type="button"
            onClick={() => setQualityOpen(v => !v)}
            className="flex w-full items-center justify-between rounded-md px-2 py-2.5 text-[11px] hover:bg-accent"
          >
            <span>音质</span>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {QUALITY_LABEL[quality]}
              <ChevronDown className={`h-3 w-3 transition-transform ${qualityOpen ? 'rotate-180' : ''}`} />
            </span>
          </button>
          {qualityOpen && (
            <div className="mt-1 border-t border-border pt-1 text-[11px]">
              <QualityList
                items={qualityItems}
                current={quality}
                types={types}
                onSelect={setQuality}
              />
            </div>
          )}

          <button
            type="button"
            onClick={cycleSleepTimer}
            className="flex w-full items-center justify-between rounded-md px-2 py-2.5 text-[11px] hover:bg-accent"
          >
            <span className="flex items-center gap-2">
              <Timer className="h-4 w-4" /> 定时关闭
            </span>
            <span className={`text-[11px] ${sleepTimer ? 'text-primary' : 'text-muted-foreground'}`}>
              {sleepTimer ? `${sleepTimer.minutes} 分钟` : '关闭'}
            </span>
          </button>

          <div className="mt-1 flex items-center gap-2 border-t border-border px-2 pt-2">
            <PlayerButton icon={VolIcon} label={isMuted ? '取消静音' : '静音'} onClick={toggleMute} size="sm" active={isMuted} />
            <ProgressBar label="音量" value={isMuted ? 0 : volume * 100} onChange={pct => setVolume(pct / 100)} />
          </div>
        </div>
      )}
    </div>
  )
}
