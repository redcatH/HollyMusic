/**
 * 缓存键生成工具
 * 统一管理所有缓存键的构造逻辑
 */

/**
 * 生成 Subsonic 搜索结果的缓存键
 * @param query 搜索查询字符串
 * @param sources 搜索源列表
 * @param songCount 歌曲数量
 * @param songOffset 偏移量
 */
export function buildSubsonicSearchCacheKey(
  query: string,
  sources: string[],
  songCount: number = 50,
  songOffset: number = 0
): string {
  return `subsonic-search:${encodeURIComponent(query)}:${songCount}:${songOffset}:${sources.join(',')}`
}
