/**
 * 代理转发 API - catch-all 路由版本
 * GET /api/proxy/[encoded-url] - 编码的 URL 在路径中（通过 catch-all 捕获）
 * 
 * 用途: 代理转发用户指定的 HTTP/HTTPS 请求，支持文件、图片、音频等各种类型的响应
 */

import { NextRequest } from 'next/server'
import { createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { logger } from '@/lib/logger'

/**
 * 验证 URL 是否合法
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * GET 请求处理 - 从 catch-all 路由参数提取编码的 URL
 */
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ path: string[] }> }
) {
  try {
    const params = await props.params
    
    // catch-all 路由会把 URL 分解成数组，需要重新组合
    // /api/proxy/http%3A%2F%2F... -> path = ['http%3A%2F%2F...']
    // /api/proxy/http%3A%2F%2Fexample.com%2Ffile.mp3 -> path = ['http%3A%2F%2Fexample.com%2Ffile.mp3']
    const pathSegments = params.path || []
    
    if (pathSegments.length === 0) {
      return createErrorResponse(
        ErrorCodes.INVALID_PARAMS,
        '缺少必填参数: URL',
        400
      )
    }

    // 重新组合路径（如果被分割成多个段）
    const encodedUrl = pathSegments.join('/')
    
    let url: string
    try {
      url = decodeURIComponent(encodedUrl)
    } catch {
      return createErrorResponse(
        ErrorCodes.INVALID_PARAMS,
        'URL 解码失败',
        400
      )
    }

    if (!isValidUrl(url)) {
      return createErrorResponse(
        ErrorCodes.INVALID_PARAMS,
        '无效的 URL 格式，仅支持 HTTP 和 HTTPS',
        400
      )
    }

    logger.debug(`代理请求: GET ${url}`)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })

    if (!response.ok) {
      logger.warn(`代理请求失败: ${url}, 状态码: ${response.status}`)
      return createErrorResponse(
        ErrorCodes.INTERNAL_ERROR,
        `远程服务器返回错误: ${response.status} ${response.statusText}`,
        response.status
      )
    }

    // 透传上游 Content-Length（让客户端能计算真实下载进度）
    const contentLength = response.headers.get('content-length')

    const headers: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
    }
    if (contentLength) {
      headers['Content-Length'] = contentLength
    }

    // 流式转发上游响应体：边下载边推给客户端，让客户端能跟踪真实下载进度。
    // 用 ReadableStream 手动泵送（而非直接 new Response(response.body)），
    // 可在出错时优雅关闭，规避 dev/turbopack 下直接透传易触发的 EPIPE。
    const upstream = response.body
    if (!upstream) {
      // 上游 body 为空（异常），退化为缓冲
      const buf = await response.arrayBuffer()
      return new Response(buf, { status: response.status, headers })
    }

    const reader = upstream.getReader()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            controller.enqueue(value)
          }
          controller.close()
        } catch (err) {
          // 客户端断开或上游异常：释放 reader，优雅关闭
          logger.debug('代理流式转发中断:', err instanceof Error ? err.message : err)
          try { controller.error(err) } catch { /* noop */ }
        }
      },
      cancel() {
        // 客户端取消（如切歌）：释放上游 reader
        reader.cancel().catch(() => {})
      },
    })

    return new Response(stream, {
      status: response.status,
      headers,
    })
  } catch (error) {
    logger.error('代理请求失败:', error)

    return createErrorResponse(
      ErrorCodes.INTERNAL_ERROR,
      error instanceof Error ? error.message : '代理请求失败',
      500,
      error instanceof Error ? error.stack : undefined
    )
  }
}
