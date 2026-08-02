/**
 * 服务端下载工具函数库
 * 用于后端路由和 API 调用中的辅助逻辑
 */

import he from 'he'
import type { MusicInfo, QualityType } from '@/lib/types/music'

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
    'Content-Disposition': buildContentDisposition(cleanedFilename),
    'Content-Security-Policy': "default-src 'none'",
    'X-Content-Type-Options': 'nosniff',
  }
}

/**
 * 构造符合 RFC 6266 / RFC 5987 的 Content-Disposition 头。
 *
 * - filename="..." 仅含 ASCII 字符（ByteString 限制：每个字符 ≤ 255）
 * - filename*=UTF-8''<percent-encoded> 用于非 ASCII（如中文）文件名
 *
 * 不这样做时，headers.set('Content-Disposition', `filename="中文.mp3"`)
 * 会抛 `ByteString` TypeError（实测，见 route.test.ts），是 500 的隐藏根因。
 *
 * @param filename 已经过 sanitizeFilename 清洗
 */
export function buildContentDisposition(filename: string): string {
  // 是否含非 ASCII 字符
  const isAscii = /^[\x00-\x7f]*$/.test(filename)
  if (isAscii) {
    return `attachment; filename="${filename}"`
  }
  // 非 ASCII：filename*=UTF-8''<encoded>，同时给一个 ASCII fallback（用 'download'）
  const encoded = encodeURIComponent(filename)
  return `attachment; filename="download"; filename*=UTF-8''${encoded}`
}

// ============================================================================
// 回源请求头构造
// ============================================================================

/** 固定的桌面浏览器 User-Agent，避免被上游识别为爬虫/空 UA 拒绝 */
const UPSTREAM_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0'

/**
 * 从 hostname 提取主域名（保留最后两段）。
 * - 普通域名 `a.b.example.com` → `example.com`
 * - 两段域名 `qq.com` → `qq.com`
 * - IPv4 / localhost 保持原样
 *
 * 与 POST 路由原内联实现行为一致，抽取出来供 GET/POST 共用，
 * 消除 GET 路由漏设 Referer 导致上游防盗链拒绝（500 根因）的 bug。
 */
function getPrimaryDomain(h: string): string {
  // 保留 IPv4 / localhost 原样
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h === 'localhost') return h
  const parts = h.split('.')
  if (parts.length <= 2) return h
  return parts.slice(-2).join('.')
}

/**
 * 构造回源下载请求头。
 *
 * 核心作用：为上游音源 API 补齐 `Referer`（防盗链绕过）与 `User-Agent`，
 * 这是 GET 路由此前 500 报错的根因修复点。
 *
 * @param url 远端资源 URL
 * @returns 包含 User-Agent 与 Referer 的 headers 对象
 * @throws URL 无效时抛错（由调用方捕获并返回 400）
 */
export function buildUpstreamHeaders(url: string): Record<string, string> {
  const parsed = new URL(url)
  const refererHost = getPrimaryDomain(parsed.hostname)
  const referer = `${parsed.protocol}//${refererHost}`
  return {
    'User-Agent': UPSTREAM_USER_AGENT,
    'Referer': referer,
  }
}

// ============================================================================
// 文件名构造（uid 模式后端组装，不信任前端输入）
// ============================================================================

/**
 * 剥离 HTML 标签并解码实体。
 *
 * 上游音源 API 返回的 name/singer（以及 upsert 进 DB 的数据）可能携带
 * 搜索高亮标签（如 '<em>万能青年旅店<'），直接拼接会导致文件名出现
 * <em> 字面量、Content-Disposition 头非法（ByteString 错误）、或下载路由 500。
 */
function stripHtml(s: string): string {
  // 1. 移除所有完整的 HTML 标签（<em>、<b>、<span class="x"> 等）
  const noTags = s.replace(/<[^>]*>/g, '')
  // 2. 解码 HTML 实体（&amp; &lt; &gt; &quot; &#39; &nbsp; …）
  const decoded = he.decode(noTags)
  // 3. 移除残留的孤立 < >（上游数据可能含未闭合标签如 '万能青年旅店<'）
  const noAngles = decoded.replace(/[<>]/g, '')
  // 4. &nbsp; 解码为 U+00A0（不间断空格），归一为普通空格；同时折叠连续空格
  return noAngles.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ')
}

/** 音质 → 扩展名；FLAC 系用 .flac，其余（mp3 码率档）用 .mp3 */
function extForQuality(q: QualityType): string {
  return q === 'flac' || q === 'flac24bit' ? '.flac' : '.mp3'
}

/**
 * 根据歌曲信息与音质组装下载文件名（uid 模式后端组装）。
 *
 * 安全考量：uid 模式下 filename 完全由后端从 DB 中的 MusicInfo 构造，
 * 不接收前端 filename 参数，消除"前端可控文件名"的攻击面。
 * 上游数据可能被 HTML 高亮标签污染，内部经 stripHtml 清洗。
 *
 * @param mi 从 DB resolveMusicInfoById 解析出的歌曲信息
 * @param quality 音质，决定扩展名（flac 系 → .flac，其余 → .mp3）
 * @returns 形如 "万能青年旅店 - 杀死那个石家庄人.mp3" 的文件名（未 sanitize，供 buildContentDisposition 进一步处理）
 */
export function buildFilenameFromMusicInfo(mi: MusicInfo, quality: QualityType = '320k'): string {
  const singer = stripHtml(mi.singer || '').trim() || 'unknown'
  const name = stripHtml(mi.name || '').trim() || 'audio'
  return `${singer} - ${name}${extForQuality(quality)}`
}
