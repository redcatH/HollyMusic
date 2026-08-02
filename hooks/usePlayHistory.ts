
import { useCallback, useEffect, useState } from 'react'
import { listHistory, clearHistory, type HistoryEntry } from '@/lib/api/history'

export function usePlayHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  /**
   * 拉取历史。静默刷新（不重置 loading）：
   * 首次挂载由内部 effect 控制 loading 显示 skeleton；
   * 之后由消费方（如 HistoryPage 监听切歌）触发的刷新不闪烁。
   */
  const reload = useCallback(async () => {
    try {
      const { list } = await listHistory()
      setEntries(list)
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
    setEntries([])
  }, [])

  return { entries, loading, reload, clear }
}
