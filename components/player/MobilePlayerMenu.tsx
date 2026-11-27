/**
 * 播放设置：手机底栏与歌词页共用。原生弹窗保证触屏操作和焦点不受底栏层叠影响。
 */

import { useState } from 'react'
import { MoreHorizontal, Timer, Volume2, VolumeX, ChevronDown, SkipBack, SkipForward, Heart, Share2, Mic2 } from 'lucide-react'
import { usePlayerStore } from '@/lib/store/player-store'
import { useLyricsPanel } from '@/hooks/useLyricsPanel'
import { useTrackQualities } from '@/hooks/useTrackQualities'
import { useFavoritesStore } from '@/lib/store/favorites-store'
import { Modal } from '@/components/shared/Modal'
import { shareContent, buildSongShareUrl } from '@/lib/share'
import { QUALITY_LABEL, QUALITY_ORDER } from '@/lib/quality-options'
import { EqualizerButton } from './EqualizerPanel'
import { ProgressBar } from './ProgressBar'
import { PlayerButton } from './PlayerButton'
import { QualityList } from './QualityList'
import { PLAYBACK_MODE_CONFIG } from './playback-modes'
import { ScreenWakeLockSetting } from './ScreenWakeLockSetting'

export function MobilePlayerMenu({ onOpenEqualizer }: { onOpenEqualizer?: () => void }) {
  const [open, setOpen] = useState(false)
  const [qualityOpen, setQualityOpen] = useState(false)
  const [favoritePending, setFavoritePending] = useState(false)
  const [favoriteFeedback, setFavoriteFeedback] = useState<{ uid: string; message: string; error: boolean } | null>(null)

  const playbackMode = usePlayerStore(s => s.playbackMode)
  const cyclePlaybackMode = usePlayerStore(s => s.cyclePlaybackMode)
  const quality = usePlayerStore(s => s.quality)
  const setQuality = usePlayerStore(s => s.setQuality)
  const preferSurround = usePlayerStore(s => s.preferSurround)
  const setPreferSurround = usePlayerStore(s => s.setPreferSurround)
  const currentTrack = usePlayerStore(s => s.currentTrack)
  const previous = usePlayerStore(s => s.previous)
  const next = usePlayerStore(s => s.next)
  const { toggle: toggleLyrics } = useLyricsPanel()
  const isFav = useFavoritesStore(s => currentTrack ? s.ids.has(currentTrack.uid) : false)
  const toggleFavorite = useFavoritesStore(s => s.toggle)
  const sleepTimer = usePlayerStore(s => s.sleepTimer)
  const cycleSleepTimer = usePlayerStore(s => s.cycleSleepTimer)
  const volume = usePlayerStore(s => s.volume)
  const isMuted = usePlayerStore(s => s.isMuted)
  const setVolume = usePlayerStore(s => s.setVolume)
  const toggleMute = usePlayerStore(s => s.toggleMute)

  const handleFavorite = async () => {
    if (!currentTrack || favoritePending) return
    setFavoritePending(true)
    setFavoriteFeedback(null)
    try {
      await toggleFavorite(currentTrack.uid)
      setFavoriteFeedback({ uid: currentTrack.uid, message: isFav ? '已取消收藏' : '已收藏', error: false })
    } catch {
      setFavoriteFeedback({ uid: currentTrack.uid, message: '收藏操作失败，请重试', error: true })
    } finally {
      setFavoritePending(false)
    }
  }

  const { icon: ModeIcon, label: modeLabel } = PLAYBACK_MODE_CONFIG[playbackMode]
  const VolIcon = isMuted || volume === 0 ? VolumeX : Volume2

  const types = useTrackQualities(open && qualityOpen ? currentTrack?.uid : undefined, currentTrack?.musicInfo.types)
  // 偏好选择器：始终列出全部音质，不随歌曲变动（实际播放音质由歌名旁标签显示）
  const qualityItems = QUALITY_ORDER

  return (
    <>
      <PlayerButton icon={MoreHorizontal} label="更多" onClick={() => setOpen(v => !v)} active={open} size="sm" aria-expanded={open} aria-haspopup="dialog" />
      {open && (
        <Modal open onClose={() => setOpen(false)} title="播放设置" size="sm" closeButtonLabel="关闭播放设置">
          <div className="mb-1 flex justify-between border-b border-border/60 pb-2">
            <PlayerButton icon={SkipBack} label="上一首" onClick={previous} disabled={!currentTrack} />
            <PlayerButton icon={SkipForward} label="下一首" onClick={next} disabled={!currentTrack} />
            {onOpenEqualizer && <EqualizerButton onClick={() => { setOpen(false); onOpenEqualizer() }} />}
            <PlayerButton icon={Share2} label="分享" disabled={!currentTrack} onClick={() => {
              if (currentTrack) void shareContent({ title: currentTrack.name, text: `${currentTrack.name} - ${currentTrack.artist}`, url: buildSongShareUrl(currentTrack.uid) })
            }} />
          </div>
          <button type="button" onClick={() => void handleFavorite()} disabled={!currentTrack || favoritePending}
            aria-pressed={isFav} aria-busy={favoritePending}
            className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 py-2.5 text-sm hover:bg-accent disabled:opacity-50">
            <Heart className={`h-4 w-4 ${isFav ? 'fill-current text-primary' : ''}`} />
            {favoritePending ? '正在保存…' : isFav ? '取消收藏' : '收藏'}
          </button>
          {favoriteFeedback && favoriteFeedback.uid === currentTrack?.uid && <p
            role={favoriteFeedback.error ? 'alert' : 'status'} className={`px-2 pb-2 text-xs ${favoriteFeedback.error ? 'text-destructive' : 'text-primary'}`}>
            {favoriteFeedback.message}
          </p>}
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
                preferSurround={preferSurround}
                onSurroundChange={setPreferSurround}
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
          <ScreenWakeLockSetting />
        </Modal>
      )}
    </>
  )
}
