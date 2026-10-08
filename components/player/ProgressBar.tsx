import { useRef, useState, type CSSProperties } from 'react'

interface ProgressBarProps {
  value: number
  onChange?: (pct: number) => void
  disabled?: boolean
  label?: string
}

/** 原生 range 支持触摸与键盘；拖动结束后再提交，避免连续触发音频跳转。 */
export function ProgressBar({ value, onChange, disabled, label = '播放进度' }: ProgressBarProps) {
  const dragging = useRef(false)
  const [dragValue, setDragValue] = useState<number | null>(null)
  const current = Math.max(0, Math.min(100, dragValue ?? value))

  return (
    <input
      type="range"
      min={0}
      max={100}
      step={0.1}
      value={current}
      disabled={disabled}
      aria-label={label}
      style={{ '--progress': `${current}%` } as CSSProperties}
      className="player-range min-w-0 flex-1 disabled:cursor-not-allowed disabled:opacity-50"
      onPointerDown={event => {
        if (disabled) return
        dragging.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onChange={event => {
        const next = Number(event.currentTarget.value)
        if (dragging.current) setDragValue(next)
        else onChange?.(next)
      }}
      onPointerUp={event => {
        if (!dragging.current) return
        dragging.current = false
        onChange?.(Number(event.currentTarget.value))
        setDragValue(null)
      }}
      onPointerCancel={() => {
        dragging.current = false
        setDragValue(null)
      }}
    />
  )
}
