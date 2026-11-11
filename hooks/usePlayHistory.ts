
import { useCallback, useEffect, useRef, useState } from 'react'
import { listHistory, clearHistory, removeHistoryEntry, type HistoryEntry } from '@/lib/api/history'

export function usePlayHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const revision = useRef(0)

  /**
   * 拉取历史。静默刷新（不重置 loading）：
   * 首次挂载由内部 effect 控制 loading 显示 skeleton；
   * 之后由消费方（如 HistoryPage 监听切歌）触发的刷新不闪烁。
   */
  const reload = useCallback(async () => {
    const requestRevision = ++revision.current
    try {
      const { list } = await listHistory()
      if (requestRevision === revision.current) setEntries(list)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await reload()
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [reload])

  const clear = useCallback(async () => {
    await clearHistory()
    revision.current++
    setEntries([])
  }, [])

  const remove = useCallback(async (id: number) => {
    await removeHistoryEntry(id)
    // 忽略删除前启动的刷新，避免旧响应把已删除的记录重新放回列表。
    revision.current++
    setEntries(current => current.filter(entry => entry.id !== id))
  }, [])

  return { entries, loading, reload, clear, remove }
}
