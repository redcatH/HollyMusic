/**
 * 服务端下载工具函数库
 * 用于后端路由和 API 调用中的辅助逻辑
 */

/**
 * 验证 URL 格式
 * @param url 要验证的 URL
 * @returns 是否是有效的 URL
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * 从 URL 中提取域名
 * @param url 源 URL
 * @returns 域名，如 'music.qq.com'；无效则返回 null
 */
export function extractDomain(url: string): string | null {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname
  } catch {
    return null
  }
}

/**
 * 检查域名是否在白名单中
 * @param domain 要检查的域名
 * @param allowedDomains 允许的域名列表
 * @returns 是否允许
 */
export function isAllowedDomain(domain: string, allowedDomains: string[]): boolean {
  return allowedDomains.some(allowed => {
    // 支持精确匹配和通配符匹配（如 *.qq.com）
    if (allowed === '*') return true
    if (allowed === domain) return true
    if (allowed.startsWith('*.')) {
      const suffix = allowed.substring(1)
      return domain.endsWith(suffix)
    }
    return false
  })
}

/**
 * 从环境变量读取允许的域名列表
 * @param envVar 环境变量名称
 * @returns 允许的域名数组
 */
export function getAllowedDomainsFromEnv(envVar: string = 'ALLOWED_DOWNLOAD_DOMAINS'): string[] {
  const domains = process.env[envVar] || ''
  return domains
    .split(',')
    .map(d => d.trim())
    .filter(d => d.length > 0)
}

/**
 * 验证 Referer 来自本站点
 * @param referer Referer 请求头值
 * @param allowedOrigins 允许的源列表
 * @returns 是否有效
 */
export function isValidReferer(referer: string | null, allowedOrigins: string[]): boolean {
  if (!referer) return false

  try {
    const refererUrl = new URL(referer)
    return allowedOrigins.some(origin => {
      const originUrl = new URL(origin)
      return refererUrl.hostname === originUrl.hostname
    })
  } catch {
    return false
  }
}

/**
 * 验证 Origin 请求头
 * @param origin Origin 请求头值
 * @param allowedOrigins 允许的源列表
 * @returns 是否有效
 */
export function isValidOrigin(origin: string | null, allowedOrigins: string[]): boolean {
  if (!origin) return false
  return allowedOrigins.includes(origin)
}

/**
 * 清洁和验证文件名
 * @param filename 原始文件名
 * @param maxLength 最大长度（默认 200）
 * @returns 安全的文件名
 */
export function sanitizeFilename(filename: string, maxLength: number = 200): string {
  // 移除路径分隔符和危险字符
  let cleaned = filename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\.\./g, '')
    .trim()

  if (!cleaned) {
    cleaned = 'download'
  }

  // 移除连续的空格和点
  cleaned = cleaned.replace(/\.+/g, '.').replace(/\s+/g, ' ')

  // 限制长度
  if (cleaned.length > maxLength) {
    cleaned = cleaned.substring(0, maxLength)
  }

  // 避免以点或空格结尾
  cleaned = cleaned.replace(/[\s.]+$/, '')

  return cleaned
}

/**
 * 从响应头中提取文件名
 * @param contentDisposition Content-Disposition 响应头
 * @param fallbackName 备用文件名
 * @returns 文件名
 */
export function extractFilenameFromHeader(
  contentDisposition: string | null,
  fallbackName: string = 'download.mp3'
): string {
  if (!contentDisposition) {
    return fallbackName
  }

  // 尝试提取 filename*=UTF-8''...
  const match1 = contentDisposition.match(/filename\*=(?:UTF-8'')?([^;]+)/)
  if (match1 && match1[1]) {
    try {
      return decodeURIComponent(match1[1])
    } catch {}
  }

  // 尝试提取 filename="..." 或 filename=...
  const match2 = contentDisposition.match(/filename=["']?([^"';]+)["']?(?:;|$)/)
  if (match2 && match2[1]) {
    return match2[1]
  }

  return fallbackName
}

/**
 * 推断文件扩展名
 * @param url 源 URL
 * @param contentType Content-Type 响应头
 * @returns 文件扩展名（如 '.mp3'）
 */
export function inferExtension(url: string, contentType?: string | null): string {
  // 优先从 Content-Type 推断
  if (contentType) {
    const typeMap: Record<string, string> = {
      'audio/mpeg': '.mp3',
      'audio/mp4': '.m4a',
      'audio/flac': '.flac',
      'audio/wav': '.wav',
      'audio/aac': '.aac',
      'audio/ogg': '.ogg',
      'audio/webm': '.webm',
      'audio/wma': '.wma',
      'audio/x-ms-wma': '.wma',
    }

    for (const [type, ext] of Object.entries(typeMap)) {
      if (contentType.includes(type)) {
        return ext
      }
    }
  }

  // 从 URL 路径推断
  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname
    const match = pathname.match(/\.(\w+)($|\?)/)
    if (match && match[1]) {
      const ext = match[1].toLowerCase()
      const validExts = ['mp3', 'm4a', 'flac', 'wav', 'aac', 'ogg', 'webm', 'wma']
      if (validExts.includes(ext)) {
        return `.${ext}`
      }
    }
  } catch {}

  // 默认返回 .mp3
  return '.mp3'
}

/**
 * 速率限制检查器（简易版）
 * 在生产环境中建议使用 Redis 或专门的速率限制库
 */
class RateLimiter {
  private requests: Map<string, number[]> = new Map()
  private windowMs: number = 60000 // 时间窗口（毫秒）
  private maxRequests: number = 10 // 时间窗口内最大请求数

  constructor(windowMs: number = 60000, maxRequests: number = 10) {
    this.windowMs = windowMs
    this.maxRequests = maxRequests
  }

  check(key: string): boolean {
    const now = Date.now()
    const times = this.requests.get(key) || []

    // 移除超出时间窗口的记录
    const validTimes = times.filter(t => now - t < this.windowMs)

    if (validTimes.length >= this.maxRequests) {
      return false
    }

    validTimes.push(now)
    this.requests.set(key, validTimes)
    return true
  }

  reset(key: string): void {
    this.requests.delete(key)
  }
}

export { RateLimiter }

/**
 * 生成安全的下载头信息
 */
export function getDownloadHeaders(
  filename: string,
  contentType: string = 'application/octet-stream'
): Record<string, string> {
  const cleanedFilename = sanitizeFilename(filename)
  return {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${cleanedFilename}"`,
    'Content-Security-Policy': "default-src 'none'",
    'X-Content-Type-Options': 'nosniff',
  }
}
