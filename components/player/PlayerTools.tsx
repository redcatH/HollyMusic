/**
 * 桌面端播放栏右侧工具区（替代旧 VolumeControl）。
 *
 * 宽屏显示歌词/队列文字，手机对应功能由播放栏和更多菜单提供。
 */

import { usePlayerStore } from '@/lib/store/player-store'
import { ProgressBar } from './ProgressBar'
import { PlayerButton } from './PlayerButton'
import { Mic2, ListMusic, Timer, Volume2, VolumeX } from 'lucide-react'

export function PlayerTools() {
  const volume = usePlayerStore(s => s.volume)
  const isMuted = usePlayerStore(s => s.isMuted)
  const setVolume = usePlayerStore(s => s.setVolume)
  const toggleMute = usePlayerStore(s => s.toggleMute)
  const toggleQueue = usePlayerStore(s => s.toggleQueue)
  const toggleLyrics = usePlayerStore(s => s.toggleLyrics)
  const sleepTimer = usePlayerStore(s => s.sleepTimer)
  const cycleSleepTimer = usePlayerStore(s => s.cycleSleepTimer)

  const VolIcon = isMuted || volume === 0 ? VolumeX : Volume2

  return (
    <div className="hidden min-w-0 items-center justify-end gap-0.5 desktop:flex xl:gap-1">
      <PlayerButton icon={Mic2} label="歌词" onClick={toggleLyrics} showLabel />
      <PlayerButton icon={ListMusic} label="队列" onClick={toggleQueue} showLabel />
      <PlayerButton
        icon={Timer}
        label={sleepTimer ? `定时关闭：${sleepTimer.minutes} 分钟后暂停` : '定时关闭'}
        onClick={cycleSleepTimer}
        active={!!sleepTimer}
      />
      <PlayerButton
        icon={VolIcon}
        label={isMuted ? '取消静音' : '静音'}
        onClick={toggleMute}
        active={isMuted}
      />
      <div className="ml-1 flex h-8 w-12 min-w-8 items-center lg:w-20">
        <ProgressBar label="音量" value={isMuted ? 0 : volume * 100} onChange={pct => setVolume(pct / 100)} />
      </div>
    </div>
  )
}
