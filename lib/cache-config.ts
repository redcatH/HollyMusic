/**
 * 缓存配置管理
 * 从环境变量读取，提供默认值
 */

/**
 * 获取搜索缓存 TTL（毫秒）
 * 环境变量: SEARCH_CACHE_TTL_MS
 * 默认值: 210 分钟
 */
export function getSearchCacheTTL(): number {
  const envValue = process.env.SEARCH_CACHE_TTL_MS
  if (envValue) {
    const parsed = parseInt(envValue, 10)
    if (!isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }
  // 默认 210 分钟
  return 210 * 60 * 1000
}

/**
 * 获取所有缓存配置对象
 */
export const cacheConfig = {
  searchCacheTTL: getSearchCacheTTL(),
}
