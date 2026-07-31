import { NextRequest, NextResponse } from 'next/server'
import { requireUser, AuthError } from '@/lib/services/user-context'

/**
 * 音乐下载代理路由
 * 
 * 用途：
 * - 解决直连下载的 CORS 问题
 * - 强制浏览器保存文件（设置 Content-Disposition）
 * - 保证文件名正确性
 * 
 * 请求方式：
 * - GET /api/download?url=...&filename=...
 * - POST /api/download
 *   Body: { url: string, filename?: string }
 * 
 * TODO: 以下安全功能需要在生产环境实施：
 * 
 * 1. TODO: 实现主机白名单验证
 *    - 只允许特定的音乐源域名进行代理下载
 *    - 读取配置文件或环境变量维护白名单列表
 *    - 示例：ALLOWED_DOMAINS=music.qq.com,netease.music.com
 * 
 * 2. TODO: 添加 Referer/Origin 验证
 *    - 验证请求来自本站点而非其他域名
 *    - 防止被第三方网站滥用代理服务
 * 
 * 3. TODO: 实现速率限制 (Rate Limiting)
 *    - 按 IP 地址限制单位时间内的下载次数
 *    - 全局下载队列管理，防止服务器过载
 *    - 示例：每 IP 每分钟最多 10 次请求
 * 
 * 4. TODO: 添加文件大小限制
 *    - 设定单个文件的最大下载大小（如 50MB）
 *    - 验证 Content-Length 响应头，超过则中止
 * 
 * 5. TODO: 记录访问日志
 *    - 记录所有下载请求（IP、URL、时间戳）
 *    - 用于审计和故障排查
 * 
 * 6. TODO: 支持 Range 请求（断点续传）
 *    - 解析 Range 请求头，支持部分内容下载
 *    - 返回 206 Partial Content 状态码
 * 
 * 7. TODO: 实现可选的响应缓存
 *    - 缓存热门文件以减轻上游服务器压力
 *    - 考虑缓存策略和存储成本
 */

/**
 * 验证和清洁文件名
 */
function sanitizeFilename(filename: string): string {
  // 移除路径分隔符和特殊字符
  let cleaned = filename
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\.\./g, '')
    .trim()

  if (!cleaned) {
    cleaned = 'download'
  }

  // 限制长度
  if (cleaned.length > 200) {
    cleaned = cleaned.substring(0, 200)
  }

  return cleaned
}

/**
 * 处理 GET 请求：/api/download?url=...&filename=...
 */
export async function GET(request: NextRequest) {
  try {
    await requireUser(request)
    const { searchParams } = new URL(request.url)
    const encodedUrl = searchParams.get('url')
    const filename = searchParams.get('filename')

    if (!encodedUrl) {
      return NextResponse.json(
        { error: '缺少 url 参数' },
        { status: 400 }
      )
    }

    let url: string
    try {
      url = decodeURIComponent(encodedUrl)
    } catch {
      return NextResponse.json(
        { error: '无效的 URL 编码' },
        { status: 400 }
      )
    }

    // TODO: 验证 URL 是否在白名单中
    // if (!isAllowedDomain(url)) {
    //   return NextResponse.json({ error: '不支持的域名' }, { status: 403 })
    // }

    // TODO: 验证 Referer/Origin
    // const referer = request.headers.get('referer')
    // if (!isValidReferer(referer)) {
    //   return NextResponse.json({ error: '无效的请求来源' }, { status: 403 })
    // }

    // TODO: 检查速率限制
    // const clientIP = request.ip || 'unknown'
    // if (isRateLimited(clientIP)) {
    //   return NextResponse.json({ error: '请求过于频繁' }, { status: 429 })
    // }

    // 从远端获取资源
    console.log('download route: 开始代理下载', url)
    
    const remoteResponse = await fetch(url, {
      headers: {
        // 移除可能导致远端拒绝的头
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    })

    if (!remoteResponse.ok) {
      console.error('download route: 远端返回错误', remoteResponse.status)
      return NextResponse.json(
        { error: `远端服务器错误: ${remoteResponse.status}` },
        { status: remoteResponse.status }
      )
    }

    // TODO: 检查文件大小限制
    // const contentLength = remoteResponse.headers.get('content-length')
    // if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
    //   return NextResponse.json({ error: '文件过大' }, { status: 413 })
    // }

    // 准备响应头
    const contentType = remoteResponse.headers.get('content-type') || 'application/octet-stream'
    const finalFilename = sanitizeFilename(filename || 'download.mp3')

    const headers = new Headers()
    headers.set('Content-Type', contentType)
    headers.set('Content-Disposition', `attachment; filename="${finalFilename}"`)
    
    // TODO: 添加 Range 请求支持
    // 如果远端支持 Range，转发相应头
    // headers.set('Accept-Ranges', remoteResponse.headers.get('accept-ranges') || 'none')

    // 转发远端响应体
    return new NextResponse(remoteResponse.body, {
      status: remoteResponse.status,
      headers,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    console.error('download route error:', error)
    return NextResponse.json(
      { error: '下载失败' },
      { status: 500 }
    )
  }
}

/**
 * 处理 POST 请求：/api/download
 * Body: { url: string, filename?: string }
 */
export async function POST(request: NextRequest) {
  try {
    await requireUser(request)
    const body = await request.json()
    const { url, filename } = body

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: '缺少或无效的 url 参数' },
        { status: 400 }
      )
    }

    // TODO: 验证 URL 是否在白名单中
    // if (!isAllowedDomain(url)) {
    //   return NextResponse.json({ error: '不支持的域名' }, { status: 403 })
    // }

    // TODO: 验证 Referer/Origin
    // const referer = request.headers.get('referer')
    // if (!isValidReferer(referer)) {
    //   return NextResponse.json({ error: '无效的请求来源' }, { status: 403 })
    // }

    // TODO: 检查速率限制
    // const clientIP = request.ip || 'unknown'
    // if (isRateLimited(clientIP)) {
    //   return NextResponse.json({ error: '请求过于频繁' }, { status: 429 })
    // }

    console.log('download route: 处理 POST 请求', url)

    const parsedUrl = new URL(url)
    const hostname = parsedUrl.hostname

    function getPrimaryDomain(h: string) {
      // 保留 IPv4 / localhost 原样
      if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h === 'localhost') return h
      const parts = h.split('.')
      if (parts.length <= 2) return h
      return parts.slice(-2).join('.')
    }

    const refererHost = getPrimaryDomain(hostname)
    const referer = `${parsedUrl.protocol}//${refererHost}`

    const remoteResponse = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
        'Referer': referer,
      },
    })

    if (!remoteResponse.ok) {
      console.error('download route: 远端返回错误', remoteResponse.status)
      return NextResponse.json(
        { error: `远端服务器错误: ${remoteResponse.status}` },
        { status: remoteResponse.status }
      )
    }

    // TODO: 检查文件大小限制
    // const contentLength = remoteResponse.headers.get('content-length')
    // if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
    //   return NextResponse.json({ error: '文件过大' }, { status: 413 })
    // }

    const contentType = remoteResponse.headers.get('content-type') || 'application/octet-stream'
    const finalFilename = sanitizeFilename(filename || 'download.mp3')

    const headers = new Headers()
    headers.set('Content-Type', contentType)
    headers.set('Content-Disposition', `attachment; filename="${finalFilename}"`)

    return new NextResponse(remoteResponse.body, {
      status: remoteResponse.status,
      headers,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    console.error('download route error:', error)
    return NextResponse.json(
      { error: '下载失败' },
      { status: 500 }
    )
  }
}
