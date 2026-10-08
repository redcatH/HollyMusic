
import { usePlayerStore } from '@/lib/store/player-store'
import { PlayerButton } from './PlayerButton'
import { TransportButtons } from './TransportButtons'
import { SeekBar } from './SeekBar'
import { QualityPopover } from './QualityPopover'
import { AudioSpectrum } from './AudioSpectrum'
import { Repeat, Repeat1, Shuffle } from 'lucide-react'

/**
 * 桌面端播放控制、频谱与进度；手机只保留进度。
 */
export function PlayerControls({ audio, isPlaying }: { audio: HTMLAudioElement | null; isPlaying: boolean }) {
  const playbackMode = usePlayerStore(s => s.playbackMode)
  const cyclePlaybackMode = usePlayerStore(s => s.cyclePlaybackMode)

  const ModeIcon = playbackMode === 'loop' ? Repeat1 : playbackMode === 'random' ? Shuffle : Repeat
  const modeLabel = playbackMode === 'loop' ? '单曲循环' : playbackMode === 'random' ? '随机播放' : '顺序播放'

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
      <div className="order-2 hidden w-full max-w-xl px-10 desktop:block">
        <AudioSpectrum audio={audio} isPlaying={isPlaying} className="h-3 opacity-70" />
      </div>
      <div className="order-3 flex w-full max-w-xl items-center gap-2">
        <SeekBar />
      </div>
      <div className="order-1 hidden items-center gap-1 desktop:flex">
        <PlayerButton
          icon={ModeIcon}
          label={modeLabel}
          onClick={cyclePlaybackMode}
          active={playbackMode !== 'sequence'}
        />
        <TransportButtons />
        <QualityPopover />
      </div>
    </div>
  )
}
