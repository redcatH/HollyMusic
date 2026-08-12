/**
 * Subsonic API 工具模块
 * 提供认证、参数解析和响应格式化功能
 */

import { NextRequest } from 'next/server'
import crypto from 'crypto'

// Subsonic 协议版本
export const SUBSONIC_VERSION = '1.16.1'

// Subsonic XML 命名空间
export const SUBSONIC_XMLNS = 'http://subsonic.org/restapi'

/**
 * Subsonic 请求参数接口
 */
export interface SubsonicParams {
  u?: string  // 用户名
  t?: string  // token (API key or md5(password+salt))
  s?: string  // salt
  v?: string  // 客户端协议版本
  c?: string  // 客户端名称
  f?: string  // 返回格式 (xml/json/jsonp)
  [key: string]: string | undefined
}

/**
 * 从请求中解析 Subsonic 通用参数
 * 支持 GET (URL query) 和 POST (body)
 */
export function parseSubsonicParams(req: NextRequest): SubsonicParams {
  const { searchParams } = new URL(req.url)
  const params: SubsonicParams = {}

  // 从 URL query 参数解析
  searchParams.forEach((value, key) => {
    params[key] = value
  })

  return params
}

/**
 * 格式化 Subsonic XML 响应
 */
export interface SubsonicXMLOptions {
  status: 'ok' | 'failed'
  version?: string
  children?: string  // 子节点的 XML 字符串
  error?: {
    code: number
    message: string
  }
  rootheader?: string  // 额外的根节点属性字符串
}

export function formatSubsonicXML(options: SubsonicXMLOptions): string {
  const {
    status,
    version = SUBSONIC_VERSION,
    children = '',
    error,
    rootheader = ''
  } = options

  const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>'
  
  let responseContent = ''
  if (error) {
    responseContent = `<error code="${error.code}" message="${escapeXml(error.message)}"/>`
  } else if (children) {
    responseContent = children
  }

  const response = `<subsonic-response xmlns="${SUBSONIC_XMLNS}" status="${status}" version="${version}"${rootheader}>${responseContent}</subsonic-response>`

  return `${xmlHeader}\n${response}`
}

/**
 * 转义 XML 特殊字符
 */
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 创建 Subsonic XML 响应对象
 */
export function createSubsonicResponse(xml: string) {
  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=UTF-8'
    }
  })
}
