/**
 * 公共 AI 调用（OpenAI 兼容 /chat/completions）。
 * recommend-engine / ai-filter / ai-generate 等后端路由共用。
 *
 * - response_format: json_object（调用方约定 AI 返回 JSON）
 * - 思考模型（extraBody 含 reasoning_effort / thinking）不强制 temperature:0
 * - 网络错误 / 429 / 5xx 重试最多 3 次（指数退避 1s/2s/3s）；4xx 直接抛
 * - apiKey 仅内存传入，不持久化
 */
import { setTimeout as sleep } from 'node:timers/promises'

export interface CallAIOpts {
  apiKey: string
  baseUrl: string
  model: string
  extraBody: Record<string, unknown>
  messages: { role: string; content: string }[]
}

export async function callAI(opts: CallAIOpts): Promise<string> {
  if (!opts.apiKey) throw new Error('缺少 API key（未填写，且服务端未配置 OPENAI_API_KEY）')
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
