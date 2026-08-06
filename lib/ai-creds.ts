/**
 * AI 凭证存储（集中管理，前后端共享类型）。
 *
 * 设计为可替换的存储后端：当前用 localStorage（本机持久化，下次自动回填），
 * 后期可扩展为后台管理员统一存储——届时只需把 load/save 改成调后端 API，
 * 调用方（各面板/弹窗）无需改动。
 *
 * 安全说明：apiKey 存 localStorage 会持久化在浏览器。当前场景为管理员本机 +
 * 已登录 admin 账号，风险可控。换后台存储后可改为 httpOnly cookie / 服务端会话。
 */

export interface AICreds {
  apiKey: string
  baseUrl: string
  model: string
}

const STORAGE_KEY = 'ai-creds'
const DEFAULTS: AICreds = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
}

// ponytail: 存储后端抽象。当前 localStorage，后期换后台时只改这两个函数。
function readStore(): AICreds {
  if (typeof window === 'undefined') return { ...DEFAULTS }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS }
}

function writeStore(c: AICreds): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(c))
  } catch {
    /* ignore */
  }
}

/** 读取 AI 凭证（带默认值合并） */
export function loadAICreds(): AICreds {
  return readStore()
}

/** 保存 AI 凭证（合并写入，避免部分字段丢失） */
export function saveAICreds(c: AICreds): void {
  writeStore({ ...DEFAULTS, ...c })
}
