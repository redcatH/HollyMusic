
import { usePlayerStore } from '@/lib/store/player-store'
import { PlayerButton } from './PlayerButton'
import { TransportButtons } from './TransportButtons'
import { SeekBar } from './SeekBar'
import { QualityPopover } from './QualityPopover'
import { AudioSpectrum } from './AudioSpectrum'
import { Repeat, Repeat1, Shuffle } from 'lucide-react'

/**
 * 桌面端播放控制（仅渲染于桌面 footer 分支）。
 * 自上而下：频谱、进度条、播放控制。
 */
export function PlayerControls({ audio, isPlaying }: { audio: HTMLAudioElement | null; isPlaying: boolean }) {
  const playbackMode = usePlayerStore(s => s.playbackMode)
  const cyclePlaybackMode = usePlayerStore(s => s.cyclePlaybackMode)

  const ModeIcon = playbackMode === 'loop' ? Repeat1 : playbackMode === 'random' ? Shuffle : Repeat
  const modeLabel = playbackMode === 'loop' ? '单曲循环' : playbackMode === 'random' ? '随机播放' : '顺序播放'

  return (
    <div className="flex flex-1 flex-col items-center gap-2">
      <div className="w-full max-w-xl px-1">
        <AudioSpectrum audio={audio} isPlaying={isPlaying} className="h-7 md:h-9" />
      </div>
      <div className="flex w-full max-w-xl items-center gap-2">
        <SeekBar />
      </div>
      <div className="hidden items-center gap-2 md:flex">
        <PlayerButton
          icon={ModeIcon}
          label={modeLabel}
          onClick={cyclePlaybackMode}
          active={playbackMode !== 'sequence'}
        />
        <TransportButtons />
        <QualityPopover />
      </div>
      <div className="flex justify-center py-0.5 md:hidden">
        <TransportButtons size="sm" />
      </div>
    </div>
  )
}
