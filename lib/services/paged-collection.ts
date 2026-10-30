export interface CollectionPage<T> {
  items: T[]
  total: number
  version?: string
}

/** 榜单必须有明确总数；任何缺页、重复或期数变化都不能成为完整缓存。 */
export async function collectCollectionPages<T, P extends CollectionPage<T>>(
  fetchPage: (page: number, offset: number, version: string | undefined, signal: AbortSignal) => Promise<P>,
  itemKey: (item: T) => string,
  pageSize: number,
): Promise<{ first: P; items: T[]; signal: AbortSignal }> {
  const signal = AbortSignal.timeout(30_000)
  const first = await fetchPage(0, 0, undefined, signal)
  if (!Number.isSafeInteger(first.total) || first.total < 0 || first.total > 10_000) throw new Error('榜单总数异常')
  const items: T[] = []
  const seen = new Set<string>()
  let current = first
  for (let page = 0; ; page++) {
    signal.throwIfAborted()
    if (current.total !== first.total || current.version !== first.version) throw new Error('榜单在分页期间发生变化，请重试')
    if (current.items.length !== Math.min(pageSize, first.total - items.length)) throw new Error('榜单分页获取不完整，请重试')
    for (const item of current.items) {
      const key = itemKey(item)
      if (!key || seen.has(key)) throw new Error('榜单分页重复或歌曲标识缺失，请重试')
      seen.add(key)
      items.push(item)
    }
    if (items.length === first.total) return { first, items, signal }
    current = await fetchPage(page + 1, items.length, first.version, signal)
  }
}
