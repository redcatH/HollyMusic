/**
 * Subsonic API 工具模块
 * 提供认证、参数解析和响应格式化功能
 */

import { NextRequest } from 'next/server'
import { load, type CheerioAPI } from 'cheerio'
import type { Element } from 'domhandler'

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

/** JSON 响应中 `subsonic-response` 根对象的附加字段。 */
export interface SubsonicJSONOptions {
  status: 'ok' | 'failed'
  version?: string
  error?: {
    code: number
    message: string
  }
  attributes?: Record<string, unknown>
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
 * 判断客户端是否要求 Subsonic JSON 格式。
 * 协议通过 `f=json` 指定格式；未指定时仍按 XML 返回，以保持兼容性。
 */
export function wantsSubsonicJson(request: NextRequest): boolean {
  return new URL(request.url).searchParams.get('f')?.toLowerCase() === 'json'
}

/** 格式化 Subsonic JSON 响应。 */
export function formatSubsonicJSON(options: SubsonicJSONOptions): string {
  const {
    status,
    version = SUBSONIC_VERSION,
    error,
    attributes = {},
  } = options

  return JSON.stringify({
    'subsonic-response': {
      status,
      version,
      ...attributes,
      ...(error ? { error } : {}),
    },
  })
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

/** 创建 Subsonic JSON 响应对象。 */
export function createSubsonicJsonResponse(json: string) {
  return new Response(json, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
    },
  })
}

type SubsonicJsonValue = string | number | boolean | SubsonicJsonObject | SubsonicJsonValue[]
type SubsonicJsonObject = { [key: string]: SubsonicJsonValue }

/**
 * Subsonic / OpenSubsonic JSON 中即使只有一项也必须保持数组的集合节点。
 *
 * XML 本身通过重复同名标签表示集合；直接转换时，单项会退化成对象，
 * 这会使严格按 OpenSubsonic 模型解析的客户端（例如箭头音乐）丢弃歌词。
 */
const SUBSONIC_ARRAY_ELEMENT_NAMES = new Set(['structuredLyrics', 'line'])

/** 这些元素在 Subsonic JSON 中以对象的 `value` 字段承载 XML 文本内容。 */
const SUBSONIC_VALUE_ELEMENT_NAMES = new Set(['line'])

function coerceSubsonicValue(value: string): string | number | boolean {
  if (value === 'true') return true
  if (value === 'false') return false

  if (/^-?\d+$/.test(value)) {
    const numericValue = Number(value)
    if (Number.isSafeInteger(numericValue)) return numericValue
  }

  return value
}

function xmlElementToJson($: CheerioAPI, element: Element): SubsonicJsonValue {
  const node = $(element)
  const attributes: SubsonicJsonObject = {}
  for (const [key, value] of Object.entries(element.attribs)) {
    attributes[key] = coerceSubsonicValue(value)
  }

  const childElements = node.children().toArray().filter((child): child is Element => child.type === 'tag')
  if (childElements.length === 0) {
    const text = node.text().trim()
    if (Object.keys(attributes).length === 0) {
      if (text === '') return {}
      const value = coerceSubsonicValue(text)
      return SUBSONIC_VALUE_ELEMENT_NAMES.has(element.name) ? { value } : value
    }
    return text === '' ? attributes : { ...attributes, value: coerceSubsonicValue(text) }
  }

  const result: SubsonicJsonObject = { ...attributes }
  for (const child of childElements) {
    const value = xmlElementToJson($, child)
    const existing = result[child.name]
    if (existing === undefined) {
      result[child.name] = SUBSONIC_ARRAY_ELEMENT_NAMES.has(child.name) ? [value] : value
    } else if (Array.isArray(existing)) {
      existing.push(value)
    } else {
      result[child.name] = [existing, value]
    }
  }

  return result
}

/** 将现有 Subsonic XML 响应转换为协议等价的 JSON 包装对象。 */
export function formatSubsonicXmlAsJson(xml: string): string {
  const $ = load(xml, { xmlMode: true })
  const root = $('subsonic-response').first().get(0)
  if (!root || root.type !== 'tag') {
    throw new Error('Invalid Subsonic XML response')
  }

  const response = xmlElementToJson($, root)
  // xmlns 仅是 XML 命名空间声明，Subsonic JSON 格式不需要该字段。
  if (typeof response === 'object' && !Array.isArray(response)) {
    delete response.xmlns
  }

  return JSON.stringify({
    'subsonic-response': response,
  })
}

/**
 * 在 REST 入口统一协商响应格式。
 *
 * handler 可以继续维护 XML（或二进制）实现；仅 XML 响应会在 `f=json` 时转换。
 */
export async function formatSubsonicResponseForRequest(request: NextRequest, response: Response): Promise<Response> {
  if (!wantsSubsonicJson(request) || !response.headers.get('content-type')?.includes('xml')) {
    return response
  }

  const headers = new Headers(response.headers)
  headers.set('Content-Type', 'application/json; charset=UTF-8')
  headers.delete('Content-Length')

  return new Response(formatSubsonicXmlAsJson(await response.text()), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
