
import { useEffect } from 'react'
import { usePlayerStore } from '@/lib/store/player-store'
import { CoverImage } from '@/components/shared/CoverImage'
import { X, Trash2 } from 'lucide-react'

export function QueuePanel() {
  const isOpen = usePlayerStore(s => s.isQueueOpen)
  const setQueueOpen = usePlayerStore(s => s.setQueueOpen)
  const queue = usePlayerStore(s => s.queue)
  const playNextQueue = usePlayerStore(s => s.playNextQueue)
  const isCurrentTempPlay = usePlayerStore(s => s.isCurrentTempPlay)
  const currentTrack = usePlayerStore(s => s.currentTrack)
  const currentIndex = usePlayerStore(s => s.currentIndex)
  const playTrack = usePlayerStore(s => s.playTrack)
  const removeFromQueue = usePlayerStore(s => s.removeFromQueue)
  const clearQueue = usePlayerStore(s => s.clearQueue)
  const playFromPlayNext = usePlayerStore(s => s.playFromPlayNext)
  const removeFromPlayNext = usePlayerStore(s => s.removeFromPlayNext)
  const clearPlayNext = usePlayerStore(s => s.clearPlayNext)

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
          <h2 className="shrink-0 font-semibold">播放队列（{queue.length + playNextQueue.length}）</h2>
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
          {/* 正在播放的插播曲（主队列游标冻结，该曲播完回到下方队列高亮处继续） */}
          {isCurrentTempPlay && currentTrack && (
            <div className="mb-2 border-b border-border pb-2">
              <div className="px-2 pb-1 text-xs text-muted-foreground">正在播放 · 插播</div>
              <div className="flex items-center gap-3 rounded-md bg-accent p-2">
                <CoverImage uid={currentTrack.uid} className="h-10 w-10" />
                <div className="min-w-0">
                  <div className="truncate text-sm text-primary">{currentTrack.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{currentTrack.artist}</div>
                </div>
              </div>
            </div>
          )}
          {/* 手动插播区（"下一首播放"/"加入队列"），优先于主队列播放，播完即出队 */}
          {playNextQueue.length > 0 && (
            <div className="mb-2 border-b border-border pb-2">
              <div className="flex items-center justify-between px-2 pb-1">
                <span className="text-xs font-medium text-muted-foreground">
                  下一首播放（{playNextQueue.length}）
                </span>
                <button
                  onClick={clearPlayNext}
                  className="touch-target flex items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="清空下一首播放"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {playNextQueue.map((t, i) => (
                <div key={`${t.uid}-next-${i}`} className="group flex items-center gap-3 rounded-md p-2 hover:bg-accent/50">
                  <button
                    onClick={() => playFromPlayNext(i)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <CoverImage uid={t.uid} className="h-10 w-10" />
                    <div className="min-w-0">
                      <div className="truncate text-sm">{t.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{t.artist}</div>
                    </div>
                  </button>
                  <button
                    onClick={() => removeFromPlayNext(i)}
                    className="touch-target flex items-center justify-center rounded-full text-muted-foreground opacity-70 hover:text-foreground focus-visible:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
                    aria-label="移除"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {queue.length === 0 && playNextQueue.length === 0 ? (
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
                  <CoverImage uid={t.uid} className="h-10 w-10" />
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
