// Helpers to encode/decode MusicInfo into a base64url string (no padding).
// This is a lightweight encoded-id strategy (no server-side persistence).

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 将对象转换为稳定的 JSON 字符串（键排序，剔除 undefined 值）
 * 这确保生成的字符串总是有效的 JSON
 */
function stableStringify(value: any): string {
  // 使用 JSON.stringify 但自定义 replacer 来排序键和剔除 undefined
  const sorted = JSON.parse(JSON.stringify(value, (_key: string, val: any) => {
    // 剔除 undefined 值和函数
    if (val === undefined || typeof val === 'function') {
      return undefined
    }
    return val
  }))
  
  // 递归排序所有对象的键
  function sortKeys(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) return obj.map(sortKeys)
    
    const sorted: Record<string, any> = {}
    Object.keys(obj).sort().forEach(key => {
      sorted[key] = sortKeys(obj[key])
    })
    return sorted
  }
  
  const sortedObj = sortKeys(sorted)
  return JSON.stringify(sortedObj)
}

function base64urlEncode(str: string) {
  const b64 = Buffer.from(str, 'utf8').toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(id: string) {
  let b64 = id.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4
  if (pad === 1) return null
  if (pad > 0) b64 = b64 + '='.repeat(4 - pad)
  try {
    return Buffer.from(b64, 'base64').toString('utf8')
  } catch {
    return null
  }
}

export function encodeMusicInfo(info: Record<string, any>): string {
  // 使用稳定的 JSON 序列化（键排序，剔除 undefined）
  const s = stableStringify(info)
  return base64urlEncode(s)
}

export function decodeMusicInfo(id: string): Record<string, any> | undefined {
  if (!id || typeof id !== 'string') {
    console.warn('[decodeMusicInfo] Invalid id: not a string')
    return undefined
  }
  // simple protection against huge payloads
  if (id.length > 4000) {
    console.warn(`[decodeMusicInfo] ID too long: ${id.length} chars`)
    return undefined
  }
  const json = base64urlDecode(id)
  if (!json) {
    console.warn(`[decodeMusicInfo] Failed to decode base64url: ${id.substring(0, 50)}...`)
    return undefined
  }
  try {
    // stableStringify 现在生成有效的 JSON，所以应该总是能成功解析
    const decoded = JSON.parse(json)
    console.debug(`[decodeMusicInfo] Successfully decoded: ${decoded.name} - ${decoded.singer}`)
    return decoded
  } catch (e) {
    // 这不应该发生，因为 stableStringify 现在确保生成有效的 JSON
    // 但为了安全起见仍然保留错误处理
    console.error(`[decodeMusicInfo] Failed to parse JSON: ${e instanceof Error ? e.message : 'unknown error'}`)
    console.error(`[decodeMusicInfo] JSON content: ${json.substring(0, 200)}...`)
    return undefined
  }
}

const subsonic_id_module = { encodeMusicInfo, decodeMusicInfo }
export default subsonic_id_module
