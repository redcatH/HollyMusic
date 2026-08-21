/**
 * 触屏长按 hook（移动端呼出歌曲操作菜单用，对齐 Spotify/网易云的长按交互）。
 *
 * - 500ms 触发；位移 >10px（滚动）或 touchcancel 取消
 * - 触发时轻震动反馈（支持的设备）
 * - 触发后的 onTouchEnd preventDefault：吞掉合成的 click/mousedown，
 *   避免长按松手"点穿"刚弹出的菜单、或误触行内按钮
 * - 仅绑定 touch 事件，桌面鼠标交互不受影响
 */

import { useCallback, useRef } from 'react'
import type { TouchEvent } from 'react'

const LONG_PRESS_MS = 500
/** 位移超过该值视为滚动，取消长按 */
const MOVE_TOLERANCE = 10

export function useLongPress(onLongPress: (x: number, y: number) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 本次触摸是否已触发长按（用于 touchend 决定是否吞掉合成 click） */
  const fired = useRef(false)
  const startX = useRef(0)
  const startY = useRef(0)

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const onTouchStart = useCallback(
    (e: TouchEvent<Element>) => {
      const t = e.touches[0]
      if (!t) return
      fired.current = false
      startX.current = t.clientX
      startY.current = t.clientY
      cancel()
      const { clientX: x, clientY: y } = t
      timer.current = setTimeout(() => {
        fired.current = true
        navigator.vibrate?.(10)
        onLongPress(x, y)
      }, LONG_PRESS_MS)
    },
    [cancel, onLongPress]
  )

  const onTouchMove = useCallback(
    (e: TouchEvent<Element>) => {
      if (timer.current == null) return
      const t = e.touches[0]
      if (!t) return
      const moved = Math.hypot(t.clientX - startX.current, t.clientY - startY.current)
      if (moved > MOVE_TOLERANCE) cancel()
    },
    [cancel]
  )

  const onTouchEnd = useCallback(
    (e: TouchEvent<Element>) => {
      cancel()
      if (fired.current) {
        // 长按已触发：preventDefault 阻止浏览器合成 click（touchend 非 passive，可拦截）
        e.preventDefault()
        fired.current = false
      }
    },
    [cancel]
  )

  const onTouchCancel = useCallback(() => cancel(), [cancel])

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel }
}
