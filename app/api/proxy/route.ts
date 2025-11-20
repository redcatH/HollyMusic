

/**
 * 代理转发 API - POST 处理
 * POST /api/proxy (body: { url: string, method?: string, headers?: Record<string, string>, body?: string })
 * 
 * GET 请求由 /api/proxy/[...path]/route.ts 处理
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
 * POST 请求处理 - 从 body 获取 url 和其他参数
 */
export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>

    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      return createErrorResponse(
        ErrorCodes.INVALID_PARAMS,
        '无效的请求体，必须是 JSON 格式',
        400
      )
    }

    const url = body.url as string
    const method = (body.method as string) || 'GET'
    const headers = (body.headers as Record<string, string>) || {}
    const requestBody = body.body as string

    if (!url) {
      return createErrorResponse(
        ErrorCodes.INVALID_PARAMS,
        '缺少必填参数: url',
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

    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']
    if (!validMethods.includes(method.toUpperCase())) {
      return createErrorResponse(
        ErrorCodes.INVALID_PARAMS,
        `无效的 HTTP 方法: ${method}，仅支持 ${validMethods.join(', ')}`,
        400
      )
    }

    logger.debug(`代理请求: ${method} ${url}`)

    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...headers,
      },
    }

    if (requestBody && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
      fetchOptions.body = requestBody
    }

    const response = await fetch(url, fetchOptions)

    if (!response.ok) {
      logger.warn(`代理请求失败: ${url}, 状态码: ${response.status}`)
      return createErrorResponse(
        ErrorCodes.INTERNAL_ERROR,
        `远程服务器返回错误: ${response.status} ${response.statusText}`,
        response.status
      )
    }

    // 构建响应头
    const responseHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
    }

    // 保留原始响应头
    response.headers.forEach((value, key) => {
      if (!['connection', 'transfer-encoding'].includes(key.toLowerCase())) {
        responseHeaders[key] = value
      }
    })

    // 流式传输响应
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
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