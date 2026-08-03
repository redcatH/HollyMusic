import { Check } from 'lucide-react'
import type { QualityInfo, QualityType } from '@/lib/types/music'
import { QUALITY_LABEL, QUALITY_TITLE, getSizeOf } from '@/lib/quality-options'

interface QualityListProps {
  /** 可选音质，按从高到低传入 */
  items: QualityType[]
  /** 要打勾的档（调用方传用户偏好 quality） */
  current: QualityType
  /** 歌曲类型信息，用于展示每档文件大小 */
  types?: QualityInfo[]
  onSelect: (q: QualityType) => void
}

/**
 * 音质选项列表（纯展示）。桌面 QualityPopover 与移动 MobilePlayerMenu 共用。
 */
export function QualityList({ items, current, types, onSelect }: QualityListProps) {
  return (
    <ul className="flex flex-col" role="listbox" aria-label="选择音质">
      {items.map(q => {
        const active = q === current
        const size = getSizeOf(types, q)
        return (
          <li key={q} role="option" aria-selected={active}>
            <button
              type="button"
              onClick={() => onSelect(q)}
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition-colors hover:bg-accent ${
                active ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <span className="flex flex-col">
                <span className="font-medium">{QUALITY_LABEL[q]}</span>
                <span className="text-[10px] text-muted-foreground/80">{QUALITY_TITLE[q]}</span>
              </span>
              <span className="flex items-center gap-2">
                {size && <span className="text-[10px] tabular-nums text-muted-foreground">{size}</span>}
                {active && <Check className="h-3.5 w-3.5" />}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
