/**
 * 全局键盘快捷键（PC 端）。
 *
 * 走 store action，与 useMediaSession 同层；PlayerBar 的 effect 负责反应到音频引擎。
 * 输入框/文本域/富文本聚焦时全部禁用，避免打字时误触发。
 *
 * Space       播放/暂停
 * ←/→         上一首/下一首
 * Shift+←/→   快退/快进 10s
 * ↑/↓         音量 ±10%
 * M           静音
 * R           切换播放模式
 * L           歌词面板
 * Q           播放队列
 */

import { useEffect } from 'react'
import { usePlayerStore } from '@/lib/store/player-store'

const VOLUME_STEP = 0.1
const SEEK_STEP = 10

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      const st = usePlayerStore.getState()

      if (e.code === 'Space') {
        e.preventDefault()
        st.togglePlay()
        return
      }

      // Shift+←/→：快退/快进 10s（须在普通方向键之前判断）
      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        const t = e.key === 'ArrowRight' ? st.currentTime + SEEK_STEP : st.currentTime - SEEK_STEP
        st.seek(Math.max(0, t))
        return
      }

      switch (e.key) {
        case 'ArrowRight': e.preventDefault(); st.next(); return
        case 'ArrowLeft': e.preventDefault(); st.previous(); return
        case 'ArrowUp':
          e.preventDefault()
          st.setVolume(Math.min(1, st.volume + VOLUME_STEP))
          return
        case 'ArrowDown':
          e.preventDefault()
          st.setVolume(Math.max(0, st.volume - VOLUME_STEP))
          return
      }

      switch (e.key.toLowerCase()) {
        case 'm': st.toggleMute(); return
        case 'r': st.cyclePlaybackMode(); return
        case 'l': st.toggleLyrics(); return
        case 'q': st.toggleQueue(); return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
