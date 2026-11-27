import { useId, useState } from 'react'
import { Download } from 'lucide-react'
import { useTrackQualities } from '@/hooks/useTrackQualities'
import { getAvailableQualities, getSizeOf, QUALITY_ORDER, QUALITY_TITLE, resolveQuality } from '@/lib/quality-options'
import { usePlayerStore } from '@/lib/store/player-store'
import type { QualityType } from '@/lib/types/music'
import type { Track } from '@/lib/types/player'
import { Modal } from './Modal'

interface DownloadDialogProps {
  track: Track
  onClose: () => void
  onDownload: (quality: QualityType) => void
}

export function DownloadDialog({ track, onClose, onDownload }: DownloadDialogProps) {
  const groupName = useId()
  const types = useTrackQualities(track.uid, track.musicInfo.types)
  const available = getAvailableQualities(types)
  const items = available.length > 0 ? available : QUALITY_ORDER.filter(item => item !== 'master')
  const [selectedQuality, setQuality] = useState<QualityType>()
  const preferred = resolveQuality(usePlayerStore.getState().quality, types)
  const quality = selectedQuality && items.includes(selectedQuality)
    ? selectedQuality : items.includes(preferred) ? preferred : items[0]

  return (
    <Modal
      open
      onClose={onClose}
      title="选择下载音质"
      description={`${track.name} · ${track.artist}`}
      size="sm"
      footer={<>
        <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
          取消
        </button>
        <button
          type="button"
          onClick={() => { onDownload(quality); onClose() }}
          className="flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Download className="h-4 w-4" />
          开始下载
        </button>
      </>}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">下载音质</legend>
        {items.map(item => {
          const size = getSizeOf(types, item)
          return (
            <label key={item} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm transition-colors hover:bg-accent ${quality === item ? 'border-primary bg-primary/5' : 'border-border'}`}>
              <input
                type="radio"
                name={groupName}
                value={item}
                checked={quality === item}
                onChange={() => setQuality(item)}
                className="h-4 w-4 shrink-0 accent-primary"
              />
              <span className="flex-1 font-medium">{QUALITY_TITLE[item]}</span>
              {size && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{size}</span>}
            </label>
          )
        })}
      </fieldset>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        {available.length === 0 && '暂无音质信息，可选择音质尝试下载。'}
        将下载所选版本。该版本暂不可用时，请选择另一档。
      </p>
    </Modal>
  )
}
