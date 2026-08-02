
import { useCallback, useEffect, useRef, useState } from 'react'

interface ProgressBarProps {
  value: number // 0-100
  onChange?: (pct: number) => void
  disabled?: boolean
}

export function ProgressBar({ value, onChange, disabled }: ProgressBarProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [dragValue, setDragValue] = useState<number | null>(null)

  const current = dragValue ?? value

  const calcPct = useCallback((clientX: number) => {
    const el = ref.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100))
  }, [])

  useEffect(() => {
    if (!dragging) return
    const move = (e: MouseEvent) => setDragValue(calcPct(e.clientX))
    const up = (e: MouseEvent) => {
      onChange?.(calcPct(e.clientX))
      setDragging(false)
      setDragValue(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [dragging, calcPct, onChange])

  return (
    <div
      ref={ref}
      onMouseDown={e => {
        if (disabled) return
        setDragging(true)
        setDragValue(calcPct(e.clientX))
      }}
      className={`group relative h-1 flex-1 cursor-pointer rounded-full bg-muted ${disabled ? 'opacity-50' : ''}`}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-primary"
        style={{ width: `${current}%` }}
      />
      <div
        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover:opacity-100"
        style={{ left: `${current}%` }}
      />
    </div>
  )
}
