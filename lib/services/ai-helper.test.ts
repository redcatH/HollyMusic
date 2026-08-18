/**
 * lib/services/ai-helper.ts 单元测试
 *
 * 安全不变式回归守卫：服务端 env key 永远只发往 env baseUrl。
 * - resolveAICreds 入口校验：非法组合（env key + 自定义地址）返回 null
 * - callAI 兜底断言：绕过 resolveAICreds 直接拼错组合时强制拦截（不发网络请求）
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveAICreds, callAI } from './ai-helper'

const ENV = {
  OPENAI_API_KEY: 'sk-env-secret',
  OPENAI_BASE_URL: 'https://gw.example.com/v1',
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('resolveAICreds（凭证组合校验）', () => {
  it('都为空 → env key + env baseUrl（开箱即用路径）', () => {
    vi.stubEnv('OPENAI_API_KEY', ENV.OPENAI_API_KEY)
    vi.stubEnv('OPENAI_BASE_URL', ENV.OPENAI_BASE_URL)
    expect(resolveAICreds('', '')).toEqual({ apiKey: ENV.OPENAI_API_KEY, baseUrl: ENV.OPENAI_BASE_URL })
  })

  it('用户 key + 自定义 baseUrl → 用户自己的组合（允许）', () => {
    vi.stubEnv('OPENAI_API_KEY', ENV.OPENAI_API_KEY)
    vi.stubEnv('OPENAI_BASE_URL', ENV.OPENAI_BASE_URL)
    expect(resolveAICreds('sk-user', 'https://my-ai.example.com/v1')).toEqual({
      apiKey: 'sk-user',
      baseUrl: 'https://my-ai.example.com/v1',
    })
  })

  it('用户 key + 未传 baseUrl → 用户 key 发 env 地址（允许）', () => {
    vi.stubEnv('OPENAI_API_KEY', ENV.OPENAI_API_KEY)
    vi.stubEnv('OPENAI_BASE_URL', ENV.OPENAI_BASE_URL)
    expect(resolveAICreds('sk-user', '')).toEqual({ apiKey: 'sk-user', baseUrl: ENV.OPENAI_BASE_URL })
  })

  it('无 key + 自定义 baseUrl → null（服务端密钥不允许发往自定义地址）', () => {
    vi.stubEnv('OPENAI_API_KEY', ENV.OPENAI_API_KEY)
    vi.stubEnv('OPENAI_BASE_URL', ENV.OPENAI_BASE_URL)
    expect(resolveAICreds('', 'https://evil.example.com/v1')).toBeNull()
  })

  it('无 key + baseUrl 等于 env 地址（含尾斜杠差异）→ 视为未自定义，走 env 路径', () => {
    vi.stubEnv('OPENAI_API_KEY', ENV.OPENAI_API_KEY)
    vi.stubEnv('OPENAI_BASE_URL', ENV.OPENAI_BASE_URL)
    expect(resolveAICreds('', ENV.OPENAI_BASE_URL + '/')).toEqual({
      apiKey: ENV.OPENAI_API_KEY,
      baseUrl: ENV.OPENAI_BASE_URL,
    })
  })

  it('env 未配 OPENAI_BASE_URL 时，默认 openai.com 地址视为未自定义', () => {
    vi.stubEnv('OPENAI_API_KEY', ENV.OPENAI_API_KEY)
    vi.stubEnv('OPENAI_BASE_URL', '')
    expect(resolveAICreds('', 'https://api.openai.com/v1')).toEqual({
      apiKey: ENV.OPENAI_API_KEY,
      baseUrl: 'https://api.openai.com/v1',
    })
    expect(resolveAICreds('', 'https://evil.example.com/v1')).toBeNull()
  })
})

describe('callAI（兜底断言）', () => {
  it('env key + 自定义 baseUrl → 立即抛安全限制，不发网络请求', async () => {
    vi.stubEnv('OPENAI_API_KEY', ENV.OPENAI_API_KEY)
    vi.stubEnv('OPENAI_BASE_URL', ENV.OPENAI_BASE_URL)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      callAI({
        apiKey: ENV.OPENAI_API_KEY,
        baseUrl: 'https://evil.example.com/v1',
        model: 'gpt-4o-mini',
        extraBody: {},
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow('安全限制')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('env key + env baseUrl（含尾斜杠变体）→ 通过断言正常发起请求', async () => {
    vi.stubEnv('OPENAI_API_KEY', ENV.OPENAI_API_KEY)
    vi.stubEnv('OPENAI_BASE_URL', ENV.OPENAI_BASE_URL)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: '{"items":[]}' } }] })),
    })
    vi.stubGlobal('fetch', fetchMock)
    const out = await callAI({
      apiKey: ENV.OPENAI_API_KEY,
      baseUrl: ENV.OPENAI_BASE_URL + '/',
      model: 'gpt-4o-mini',
      extraBody: {},
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(out).toBe('{"items":[]}')
    expect(fetchMock).toHaveBeenCalledOnce()
    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toContain('gw.example.com')
  })

  it('用户 key + 自定义 baseUrl → 不受断言影响', async () => {
    vi.stubEnv('OPENAI_API_KEY', ENV.OPENAI_API_KEY)
    vi.stubEnv('OPENAI_BASE_URL', ENV.OPENAI_BASE_URL)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })),
    })
    vi.stubGlobal('fetch', fetchMock)
    const out = await callAI({
      apiKey: 'sk-user',
      baseUrl: 'https://my-ai.example.com/v1',
      model: 'gpt-4o-mini',
      extraBody: {},
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(out).toBe('ok')
  })
})
