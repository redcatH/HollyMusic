
import { usePlayerStore } from '@/lib/store/player-store'
import { PlayerButton } from './PlayerButton'
import { TransportButtons } from './TransportButtons'
import { SeekBar } from './SeekBar'
import { Repeat, Repeat1, Shuffle } from 'lucide-react'
import type { QualityType } from '@/lib/types/music'

// 音质循环顺序与展示文案（label 规则同 QualityBadge：flac24bit→Hi-Res，其余 toUpperCase）
const QUALITY_CYCLE: QualityType[] = ['320k', 'flac', 'flac24bit', '128k']
const QUALITY_LABEL: Record<QualityType, string> = {
  '320k': '320K',
  '128k': '128K',
  flac: 'FLAC',
  flac24bit: 'Hi-Res',
}
const QUALITY_TITLE: Record<QualityType, string> = {
  '320k': '320K 高品质',
  '128k': '128K 标准',
  flac: 'FLAC 无损',
  flac24bit: 'Hi-Res 无损',
}

/**
 * 桌面端播放控制（仅渲染于桌面 footer 分支）。
 * 上行：播放模式 + 传输按钮 + 音质；下行：进度条。
 */
export function PlayerControls() {
  const playbackMode = usePlayerStore(s => s.playbackMode)
  const cyclePlaybackMode = usePlayerStore(s => s.cyclePlaybackMode)
  const quality = usePlayerStore(s => s.quality)
  const setQuality = usePlayerStore(s => s.setQuality)

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
        <button
          type="button"
          onClick={() => {
            const i = QUALITY_CYCLE.indexOf(quality)
            setQuality(QUALITY_CYCLE[(i + 1) % QUALITY_CYCLE.length])
          }}
          className={`rounded-md px-2 py-2 text-xs font-semibold tabular-nums transition-colors hover:bg-accent ${
            quality !== '320k' ? 'text-primary' : 'text-foreground/70 hover:text-foreground'
          }`}
          aria-label="切换音质"
          title={`当前音质：${QUALITY_TITLE[quality]}`}
        >
          {QUALITY_LABEL[quality]}
        </button>
      </div>
      <div className="flex w-full max-w-xl items-center gap-2">
        <SeekBar />
      </div>
    </div>
  )
}
