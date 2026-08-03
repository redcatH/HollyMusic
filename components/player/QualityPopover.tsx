/**
 * 桌面端音质偏好下拉（渲染于 PlayerControls）。
 *
 * 职责单一：纯偏好选择入口。trigger 显示用户偏好 quality（稳定，不随歌跳），
 * 点击弹出当前歌曲支持的音质列表。实际播放音质由 NowPlaying 歌名旁标签承担，
 * 故本组件不订阅 effectiveQuality、不做降级提示。
 *
 * 浮层手撸（无 portal / 无 Radix），参考 MobilePlayerMenu 的 outside-click + ESC 模式：
 * fixed + 测量触发器右下角，向上展开（footer 在视口底部，向上几乎总有空间）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronUp } from 'lucide-react'
import { usePlayerStore } from '@/lib/store/player-store'
import { QUALITY_LABEL, QUALITY_ORDER, getAvailableQualities } from '@/lib/quality-options'
import { QualityList } from './QualityList'

export function QualityPopover() {
  const quality = usePlayerStore(s => s.quality)
  const currentTrack = usePlayerStore(s => s.currentTrack)
  const setQuality = usePlayerStore(s => s.setQuality)

  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ right: number; bottom: number } | null>(null)

  const types = currentTrack?.musicInfo.types
  const available = getAvailableQualities(types)
  const items = available.length ? available : QUALITY_ORDER // types 异常时回退全量

  // 每次打开前测量锚点（layout 避免首帧闪烁）
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPos(null)
      return
    }
    const r = triggerRef.current.getBoundingClientRect()
    setPos({ right: window.innerWidth - r.right, bottom: window.innerHeight - r.top + 8 })
  }, [open])

  // outside-click + ESC 关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
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

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-0.5 rounded-md px-2 py-2 text-xs font-semibold tabular-nums transition-colors hover:bg-accent ${
          quality !== '320k' ? 'text-primary' : 'text-foreground/70 hover:text-foreground'
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="切换音质"
      >
        {QUALITY_LABEL[quality]}
        <ChevronUp className={`h-3 w-3 transition-transform ${open ? '' : 'rotate-180'}`} />
      </button>

      {open && pos && (
        <div
          ref={panelRef}
          role="listbox"
          className="fixed z-50 w-44 rounded-md border border-border bg-card p-1 text-sm shadow-lg"
          style={{ right: pos.right, bottom: pos.bottom }}
        >
          <QualityList
            items={items}
            current={quality}
            types={types}
            onSelect={q => {
              setQuality(q)
              setOpen(false)
            }}
          />
        </div>
      )}
    </div>
  )
}
