import { afterEach, describe, expect, it, vi } from 'vitest'
import { logger } from './logger'

afterEach(() => vi.restoreAllMocks())

describe('logger 错误日志', () => {
  it('记录 Error 的 message、stack 与网络错误码，不再输出空对象', () => {
    const output = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = Object.assign(new Error('腾讯搜索请求超时'), { code: 'ETIMEDOUT' })

    logger.error('搜索失败:', error)

    const line = String(output.mock.calls[0][0])
    const details = JSON.parse(line.slice(line.indexOf('{')))
    expect(details).toEqual({
      name: 'Error', message: '腾讯搜索请求超时', stack: error.stack, code: 'ETIMEDOUT',
    })
    expect(line).toContain('[ERROR] 搜索失败:')
  })

  it('保留普通对象和字符串参数的日志格式', () => {
    const output = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logger.warn('搜索信息', { source: 'tx' }, 'test', null)
    expect(output.mock.calls[0][0]).toContain('[WARN] 搜索信息 {"source":"tx"} test null')
  })
})
