/**
 * Subsonic API 统一响应构造层
 *
 * 设计参考 Navidrome 的“一份模型、双输出”范式：handler 只产出普通类型化
 * 对象（payload），由本模块按请求的 f= 参数渲染为 XML（默认）/ JSON / JSONP。
 * 字段注释中的 "since x.y.z" 来自官方 XSD（subsonic-rest-api-1.16.1.xsd），
 * 演进字段时以 XSD 为权威依据，只改对象模型即可，无需触碰渲染逻辑。
 *
 * 渲染约定（见 SubsonicNode）：
 * - 原始类型值       → XML 属性（字符串化）；JSON 平级键（保留原生类型）
 * - null / undefined → 属性整体省略（Subsonic 大量可选字段）
 * - 对象             → 子元素；保留键 `_text` → 元素文本内容（JSON 中映射为 "value"，
 *                      对应 Subsonic JSON 规范“元素文本存入 value 属性”）
 * - 数组             → 同名重复子元素；原始类型数组 → 重复的文本子元素（allowedUser/versions）
 * - 逗号/空格分隔的属性（allowedUser 旧式、versions 等）由 handler 自行 join 成字符串
 */
// Subsonic 协议版本（全部端点统一上报，不再各自硬编码）
export const SUBSONIC_VERSION = '1.16.1'

// Subsonic XML 命名空间
export const SUBSONIC_XMLNS = 'http://subsonic.org/restapi'

/** 元素文本内容的保留键：XML 输出为元素文本，JSON 输出为 "value" 键 */
export const TEXT_KEY = '_text'

/** 节点属性值：XML 中字符串化，JSON 中保留原生类型（对齐 Navidrome/OpenSubsonic） */
export type SubsonicScalar = string | number | boolean

/**
 * Subsonic 响应节点（也用作整个 payload）。
 * 允许 null/undefined 值，渲染时省略，方便 handler 直接透传可空字段。
 */
export interface SubsonicNode {
  [key: string]: SubsonicScalar | null | undefined | SubsonicNode | SubsonicNode[] | SubsonicScalar[]
}

/** 响应 payload：信封内、各端点根元素组成的对象，如 { searchResult3: {...} } */
export type SubsonicPayload = SubsonicNode

/** Child（song/entry/randomSongs 内歌曲）常用字段，since 版本来自官方 XSD */
export type SubsonicSongNode = SubsonicNode & {
  id: string
  parent?: string
  title: string
  album?: string
  artist?: string
  isDir?: boolean
  coverArt?: string
  created?: string
  duration?: number
  bitRate?: number
  size?: number
  suffix?: string
  contentType?: string
  isVideo?: boolean // since 1.4
  path?: string
  albumId?: string // since 1.1
  artistId?: string // since 1.1
  track?: number
  year?: number
  genre?: string
  type?: 'music' | 'video' | 'audiobook' | 'podcast' // since 1.3
  starred?: string // since 1.4，ISO 时间
}

/** AlbumID3（getAlbumList2/getAlbum）常用字段 */
export type SubsonicAlbumNode = SubsonicNode & {
  id: string
  name?: string
  album?: string
  title?: string
  artist?: string
  parent?: string
  isDir?: boolean
  coverArt?: string
  songCount?: number
  duration?: number
  created?: string
  starred?: string // since 1.4
  year?: number
  genre?: string
}

/** Playlist 节点（getPlaylists/getPlaylist/createPlaylist） */
export type SubsonicPlaylistNode = SubsonicNode & {
  id: string
  name: string
  comment?: string
  owner?: string
  public?: boolean
  songCount?: number
  duration?: number
  created?: string
  coverArt?: string
  allowedUser?: string[] // XML → 重复 <allowedUser> 文本子元素；JSON → 字符串数组
}

export interface SubsonicRespondOptions {
  status?: 'ok' | 'failed'
  /** 覆盖信封 version（一般不用，统一走 SUBSONIC_VERSION） */
  version?: string
  /** 额外根属性：ping 的 serverVersion/openSubsonic、getPlaylist 的 type="navidrome" 等 */
  rootAttrs?: Record<string, SubsonicScalar>
  /** status=failed 时的错误信封 */
  error?: { code: number; message: string }
  /** 透传额外响应头（Cache-Control 等） */
  headers?: Record<string, string>
}

/* ------------------------------------------------------------------ */
/* XML 渲染                                                            */
/* ------------------------------------------------------------------ */

/** 转义 XML 特殊字符（全仓库唯一实现，终结各 handler 的复制粘贴） */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function isScalar(value: unknown): value is SubsonicScalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function renderAttributes(node: SubsonicNode): string {
  let attrs = ''
  for (const [key, value] of Object.entries(node)) {
    if (key === TEXT_KEY || value === null || value === undefined) continue
    if (isScalar(value)) attrs += ` ${key}="${escapeXml(String(value))}"`
  }
  return attrs
}

/** 渲染单个元素：对象 → 属性+子元素；标量 → 文本子元素；数组由调用方展开 */
function renderElement(name: string, value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(item => renderElement(name, item)).join('')
  if (isScalar(value)) return `<${name}>${escapeXml(String(value))}</${name}>`
  if (typeof value !== 'object') return ''

  const node = value as SubsonicNode
  const attrs = renderAttributes(node)

  const children: string[] = []
  for (const [key, child] of Object.entries(node)) {
    if (key === TEXT_KEY || child === null || child === undefined) continue
    if (isScalar(child)) continue // 标量已作为属性输出
    const rendered = renderElement(key, child)
    if (rendered) children.push(rendered) // 空数组渲染为空串，不占用子元素位（保持容器可自闭合）
  }

  const textValue = node[TEXT_KEY]
  const text = textValue === null || textValue === undefined ? null : escapeXml(String(textValue))

  if (children.length === 0 && text === null) return `<${name}${attrs}/>`
  return `<${name}${attrs}>${text ?? ''}${children.join('')}</${name}>`
}

/** 渲染完整 XML 响应文档（含信封） */
export function renderSubsonicXml(payload: SubsonicPayload | null, opts: SubsonicRespondOptions = {}): string {
  const status = opts.status ?? 'ok'
  const version = opts.version ?? SUBSONIC_VERSION

  let rootAttrs = ` xmlns="${SUBSONIC_XMLNS}" status="${status}" version="${version}"`
  for (const [key, value] of Object.entries(opts.rootAttrs ?? {})) {
    rootAttrs += ` ${key}="${escapeXml(String(value))}"`
  }

  let body = ''
  if (opts.error) {
    body = `<error code="${opts.error.code}" message="${escapeXml(opts.error.message)}"/>`
  } else if (payload) {
    body = Object.entries(payload)
      .map(([key, value]) => renderElement(key, value))
      .join('')
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<subsonic-response${rootAttrs}>${body}</subsonic-response>`
}

/* ------------------------------------------------------------------ */
/* JSON 渲染                                                           */
/* ------------------------------------------------------------------ */

/** 递归把 payload 转为 JSON 结构：_text → "value"，省略 null/undefined */
function toJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toJsonValue)
  if (value !== null && value !== undefined && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as SubsonicNode)) {
      if (child === null || child === undefined) continue
      out[key === TEXT_KEY ? 'value' : key] = toJsonValue(child)
    }
    return out
  }
  return value
}

/** 构造 JSON 响应体：{"subsonic-response":{status,version,...rootAttrs,...payload}} */
export function buildSubsonicJsonBody(payload: SubsonicPayload | null, opts: SubsonicRespondOptions = {}): unknown {
  const envelope: Record<string, unknown> = {
    status: opts.status ?? 'ok',
    version: opts.version ?? SUBSONIC_VERSION,
    ...opts.rootAttrs,
  }
  if (opts.error) {
    envelope.error = { code: opts.error.code, message: opts.error.message }
  } else if (payload) {
    Object.assign(envelope, toJsonValue(payload))
  }
  return { 'subsonic-response': envelope }
}

/* ------------------------------------------------------------------ */
/* 统一入口                                                            */
/* ------------------------------------------------------------------ */

/** JSONP callback 合法字符（字母数字下划线点美元），防脚本注入 */
const JSON_CALLBACK_RE = /^[\w$.]+$/

/**
 * 统一 Subsonic 响应入口：按请求 f= 参数（xml/json/jsonp，默认 xml）渲染 payload。
 * 恒返回 HTTP 200（Subsonic 协议在信封内表达错误）。
 *
 * @param request 当前请求（或其 URL），用于读取 f / callback 参数
 * @param payload 信封内的根元素对象；null 表示空 body（纯 ok/failed）
 */
export function respond(
  request: Request | URL,
  payload: SubsonicPayload | null,
  opts: SubsonicRespondOptions = {}
): Response {
  const url = request instanceof URL ? request : new URL(request.url)
  const format = (url.searchParams.get('f') || 'xml').toLowerCase()

  const baseHeaders = opts.headers ?? {}
  let body: string
  let contentType: string

  if (format === 'json') {
    body = JSON.stringify(buildSubsonicJsonBody(payload, opts))
    contentType = 'application/json; charset=UTF-8'
  } else if (format === 'jsonp') {
    const json = JSON.stringify(buildSubsonicJsonBody(payload, opts))
    const callback = url.searchParams.get('callback') || ''
    // callback 缺失或非法时回退纯 JSON，避免注入与解析错误
    body = JSON_CALLBACK_RE.test(callback) ? `${callback}(${json});` : json
    contentType = 'text/javascript; charset=UTF-8'
  } else {
    body = renderSubsonicXml(payload, opts)
    contentType = 'application/xml; charset=UTF-8'
  }

  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': contentType, ...baseHeaders },
  })
}

/** 统一错误响应：status="failed" + <error code message/> */
export function subsonicError(
  request: Request | URL,
  code: number,
  message: string,
  opts: Omit<SubsonicRespondOptions, 'status' | 'error'> = {}
): Response {
  return respond(request, null, { ...opts, status: 'failed', error: { code, message } })
}
