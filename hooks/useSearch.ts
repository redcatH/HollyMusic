
import { useCallback } from 'react'
import { useSearchStore } from '@/lib/store/search-store'
import type { SourceType } from '@/lib/types/music'

/**
 * 搜索 hook（store 薄包装）
 *
 * 数据存放在 search-store（组件外部），组件卸载不丢数据：
 * 切换到其他页面再切回搜索页，输入框/源/结果均保留。
 * 参考实现：hooks/useRandomSongs.ts + lib/store/discover-store.ts。
 */
export function useSearch() {
  const results = useSearchStore(s => s.results)
  const loading = useSearchStore(s => s.loading)
  const error = useSearchStore(s => s.error)
  const keyword = useSearchStore(s => s.keyword)
  const source = useSearchStore(s => s.source)
  const setKeyword = useSearchStore(s => s.setKeyword)
  const setSource = useSearchStore(s => s.setSource)
  const runStore = useSearchStore(s => s.run)

  const run = useCallback(
    (kw: string, src: SourceType | 'all') => runStore(kw, src),
    [runStore]
  )

  return { results, loading, error, keyword, source, setKeyword, setSource, run }
}
