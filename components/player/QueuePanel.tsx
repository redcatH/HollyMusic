
import { useEffect } from 'react'
import { usePlayerStore } from '@/lib/store/player-store'
import { CoverImage } from '@/components/shared/CoverImage'
import { X, Trash2 } from 'lucide-react'

export function QueuePanel() {
  const isOpen = usePlayerStore(s => s.isQueueOpen)
  const setQueueOpen = usePlayerStore(s => s.setQueueOpen)
  const queue = usePlayerStore(s => s.queue)
  const currentIndex = usePlayerStore(s => s.currentIndex)
  const playTrack = usePlayerStore(s => s.playTrack)
  const removeFromQueue = usePlayerStore(s => s.removeFromQueue)
  const clearQueue = usePlayerStore(s => s.clearQueue)

  // WAI-ARIA 对话框模式：Esc 关闭（输入框聚焦时除外，避免打断输入）
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      setQueueOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, setQueueOpen])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/50"
      onClick={() => setQueueOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="播放队列"
    >
      <div
        className="safe-area-top flex h-full w-full max-w-md flex-col bg-card"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border p-4">
          <h2 className="shrink-0 font-semibold">播放队列（{queue.length}）</h2>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={clearQueue}
              className="touch-target flex items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="清空"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setQueueOpen(false)}
              className="touch-target flex items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {queue.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">队列为空</div>
          ) : (
            queue.map((t, i) => (
              <div
                key={`${t.uid}-${i}`}
                className={`group flex items-center gap-3 rounded-md p-2 ${
                  i === currentIndex ? 'bg-accent' : 'hover:bg-accent/50'
                }`}
              >
                <button
                  onClick={() => playTrack(t, queue)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <CoverImage uid={t.uid} cacheKey={t.musicInfo.img} className="h-10 w-10" />
                  <div className="min-w-0">
                    <div className={`truncate text-sm ${i === currentIndex ? 'text-primary' : ''}`}>
                      {t.name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{t.artist}</div>
                  </div>
                </button>
                <button
                  onClick={() => removeFromQueue(i)}
                  className="touch-target flex items-center justify-center rounded-full text-muted-foreground opacity-70 hover:text-foreground focus-visible:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
                  aria-label="移除"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
