
import { usePlayerStore } from '@/lib/store/player-store'
import { PlayerButton } from './PlayerButton'
import { TransportButtons } from './TransportButtons'
import { SeekBar } from './SeekBar'
import { QualityPopover } from './QualityPopover'
import { Repeat, Repeat1, Shuffle } from 'lucide-react'

/**
 * 桌面端播放控制（仅渲染于桌面 footer 分支）。
 * 上行：播放模式 + 传输按钮 + 音质；下行：进度条。
 */
export function PlayerControls() {
  const playbackMode = usePlayerStore(s => s.playbackMode)
  const cyclePlaybackMode = usePlayerStore(s => s.cyclePlaybackMode)

  const ModeIcon = playbackMode === 'loop' ? Repeat1 : playbackMode === 'random' ? Shuffle : Repeat
  const modeLabel = playbackMode === 'loop' ? '单曲循环' : playbackMode === 'random' ? '随机播放' : '顺序播放'

  return (
    <div className="flex flex-1 flex-col items-center gap-1">
      <div className="flex items-center gap-2">
        <PlayerButton
          icon={ModeIcon}
          label={modeLabel}
          onClick={cyclePlaybackMode}
          active={playbackMode !== 'sequence'}
        />
        <TransportButtons />
        <QualityPopover />
      </div>
      <div className="flex w-full max-w-xl items-center gap-2">
        <SeekBar />
      </div>
    </div>
  )
}
