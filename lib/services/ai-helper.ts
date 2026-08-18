/**
 * 公共 AI 调用（OpenAI 兼容 /chat/completions）。
 * recommend-engine / ai-filter / ai-generate 等后端路由共用。
 *
 * - response_format: json_object（调用方约定 AI 返回 JSON）
 * - 思考模型（extraBody 含 reasoning_effort / thinking）不强制 temperature:0
 * - 网络错误 / 429 / 5xx 重试最多 3 次（指数退避 1s/2s/3s）；4xx 直接抛
 * - apiKey 仅内存传入，不持久化
 *
 * 安全不变式：服务端环境变量里的 OPENAI_API_KEY 永远只发往 OPENAI_BASE_URL
 * 配置的地址。自定义 baseUrl 必须搭配用户自己的 key（resolveAICreds 入口校验
 * + callAI 兜底断言双层保证，防止新增调用点漏写校验导致密钥外发）。
 */
import { setTimeout as sleep } from 'node:timers/promises'

/** 服务端环境变量配置的 AI 地址（与 playlist-assist 等处保持一致） */
function envBaseUrl(): string {
  return process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
}

/** URL 规范化（比较用）：去首尾空白与尾部斜杠，规避 v1 与 v1/ 被视为不同地址 */
function normUrl(u: string): string {
  return u.trim().replace(/\/+$/, '')
}

/**
 * 统一凭证解析（各 AI 入口必须经此组合，禁止自行拼接）：
 * - 用户 key + 自定义 baseUrl → 用户自己的 key 发自己指定的地址（允许）
 * - 用户 key + env baseUrl → 允许（用户 key 不是服务端秘密）
 * - env key + env baseUrl → 允许（开箱即用路径）
 * - env key + 自定义 baseUrl → 返回 null（服务端密钥不允许发往自定义地址）
 *   baseUrl 与 env 相同（含尾斜杠差异）视为"未自定义"，按 env 路径处理。
 */
export function resolveAICreds(
  userKey: string,
  userBaseUrl: string,
): { apiKey: string; baseUrl: string } | null {
  const envBase = envBaseUrl()
  const custom =
    userBaseUrl.trim() && normUrl(userBaseUrl) !== normUrl(envBase) ? userBaseUrl.trim() : ''
  if (!userKey.trim() && custom) return null
  return {
    apiKey: userKey.trim() || process.env.OPENAI_API_KEY || '',
    baseUrl: custom || envBase,
  }
}

export interface CallAIOpts {
  apiKey: string
  baseUrl: string
  model: string
  extraBody: Record<string, unknown>
  messages: { role: string; content: string }[]
}

export async function callAI(opts: CallAIOpts): Promise<string> {
  if (!opts.apiKey) throw new Error('缺少 API key（未填写，且服务端未配置 OPENAI_API_KEY）')
  // 兜底断言：即使调用方绕过 resolveAICreds 拼错凭证组合，也在此强制拦截，
  // 保证"服务端密钥只发服务端配置的地址"不可被任何调用点破坏
  if (opts.apiKey === (process.env.OPENAI_API_KEY || '') && normUrl(opts.baseUrl) !== normUrl(envBaseUrl())) {
    throw new Error('安全限制：服务端 API key 不允许发往自定义 baseUrl，自定义地址必须使用你自己的 API key')
  }
  const wantsThinking = 'reasoning_effort' in opts.extraBody || 'thinking' in opts.extraBody
  for (let i = 0; i < 3; i++) {
    let res: Response
    try {
      res = await fetch(`${opts.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model: opts.model,
          messages: opts.messages,
          ...(wantsThinking ? {} : { temperature: 0 }),
          response_format: { type: 'json_object' },
          ...opts.extraBody,
        }),
      })
    } catch (e) {
      if (i < 2) {
        await sleep(1000 * (i + 1))
        continue
      }
      throw e
    }
    const text = await res.text()
    if (res.ok) {
      let d: { choices?: { message?: { content?: string }; finish_reason?: string }[] }
      try {
        d = JSON.parse(text)
      } catch {
        throw new Error('AI 返回非 JSON: ' + text.slice(0, 200))
      }
      const content = d.choices?.[0]?.message?.content || ''
      if (content) return content
      const fr = d.choices?.[0]?.finish_reason
      const hint = fr === 'length' ? 'AI 输出被 max_tokens 截断' : 'AI 返回了空 content'
      throw new Error(`${hint}; 若开了 thinking 请清空 extraBody 或加大 max_tokens。原始: ` + text.slice(0, 200))
    }
    if (res.status === 429 || res.status >= 500) {
      if (i < 2) {
        await sleep(1000 * (i + 1))
        continue
      }
    }
    throw new Error(`AI ${res.status}: ${text.slice(0, 200)}`)
  }
  throw new Error('AI 调用重试耗尽')
}

/** 从 AI 返回文本里提取第一个 JSON 对象（容错：AI 可能前后带文字） */
export function extractJSON(raw: string): unknown {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('AI 未返回 JSON: ' + raw.slice(0, 200))
  try {
    return JSON.parse(m[0])
  } catch {
    throw new Error('AI 返回 JSON 解析失败: ' + raw.slice(0, 200))
  }
}
