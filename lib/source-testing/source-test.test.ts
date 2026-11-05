import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { parseTestSamples, type AudioFacts } from './types'

const require = createRequire(import.meta.url)
const { isPublicAddress, publicRequest } = require('./network.cjs')
const dns = require('node:dns/promises')
const http = require('node:http')
const { EventEmitter } = require('node:events')

afterEach(() => vi.restoreAllMocks())

describe('受控公网请求', () => {
  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.100.100.200', '192.168.1.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fe80::1', 'fc00::1', '2002:7f00:1::', '2001::1'])('拒绝 %s', ip => expect(isPublicAddress(ip)).toBe(false))
  it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111'])('允许公网 %s', ip => expect(isPublicAddress(ip)).toBe(true))
  it('DNS 包含任意私网答案时，在建立连接前拒绝', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }])
    const request = vi.spyOn(http, 'request')
    await expect(publicRequest('http://test.example')).rejects.toThrow('内网')
    expect(request).not.toHaveBeenCalled()
  })
  it('连接使用已校验的 IP，超过字节限制时中断响应', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const destroyed = vi.fn()
    vi.spyOn(http, 'request').mockImplementation((_url: unknown, options: { lookup: (...args: unknown[]) => void }, callback: (res: unknown) => void) => {
      options.lookup('test.example', { all: true }, (_error: unknown, answers: unknown) => expect(answers).toEqual([{ address: '93.184.216.34', family: 4 }]))
      const req = Object.assign(new EventEmitter(), { write: vi.fn(), destroy: vi.fn(), end: () => {
        const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: {}, destroy: destroyed })
        callback(res); queueMicrotask(() => { res.emit('data', Buffer.alloc(20)); req.emit('close') })
      } })
      return req
    })
    const partial = await publicRequest('http://test.example', { maxBytes: 10, partial: true })
    expect(partial.data).toHaveLength(10)
    expect(partial.complete).toBe(false)
    expect(destroyed).toHaveBeenCalled()
    await expect(publicRequest('http://test.example', { maxBytes: 10 })).rejects.toThrow('大小')
  })
  it('重定向到内网时拒绝，不再发送第二次请求', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const request = vi.spyOn(http, 'request').mockImplementation((_url: unknown, _options: unknown, callback: (res: unknown) => void) => {
      const req = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: () => { callback({ statusCode: 302, headers: { location: 'http://127.0.0.1/private' }, destroy: vi.fn() }); queueMicrotask(() => req.emit('close')) } })
      return req
    })
    await expect(publicRequest('http://test.example')).rejects.toThrow('内网')
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe('测试歌曲', () => {
  it('保留平台所需标识，剔除播放地址和未知字段', () => {
    const samples = parseTestSamples({ kg: { source: 'kg', songmid: 'abc', hash: 'abc', albumAudioId: 123, name: '歌曲', singer: '歌手', interval: '04:00', _types: { flac: { hash: 'flac-hash' } }, typeUrl: { flac: 'http://private' }, unexpected: true } })
    expect(samples.kg).toMatchObject({ hash: 'abc', albumAudioId: '123', _types: { flac: { hash: 'flac-hash' } }, typeUrl: {} })
    expect(samples.kg).not.toHaveProperty('unexpected')
  })
  it('拒绝平台与歌曲来源不匹配', () => expect(() => parseTestSamples({ tx: { source: 'wy' } })).toThrow())
  it('兼容酷狗搜索返回的数值歌曲 ID，保存为字符串并保留 hash', () => {
    expect(parseTestSamples({ kg: { source: 'kg', songmid: 380744532, hash: 'fixture-hash', name: '歌曲', singer: '歌手', interval: '03:36', _types: { flac: {} } } }).kg).toMatchObject({ songmid: '380744532', hash: 'fixture-hash' })
  })
})

// Low-level protocol fixtures; production process limits are covered by source-test-runner.test.ts.
function executeFixture(job: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['lib/source-testing/child.cjs'], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] })
    const timeout = setTimeout(() => { child.kill(); reject(new Error('fixture timeout')) }, 3000)
    let text = ''
    child.stdout.on('data', chunk => {
      text += chunk
      const line = text.split('\n')[0]
      if (text.includes('\n')) { clearTimeout(timeout); child.kill(); resolve(JSON.parse(line)) }
    })
    child.on('error', reject)
    child.on('exit', () => clearTimeout(timeout))
    child.stdin.write(JSON.stringify(job) + '\n')
  })
}

describe('测试子进程与 VM', () => {
  const script = `const {on,send,EVENT_NAMES}=lx; on(EVENT_NAMES.request, ({info}) => 'https://example.com/'+info.type); send(EVENT_NAMES.inited,{sources:{kw:{type:'music',actions:['musicUrl'],qualitys:['flac']}}})`
  it('初始化和指定音质调用经过真实 VM，输出结构化结果', async () => {
    const result = await executeFixture({ action: 'resolve', content: script, platform: 'kw', quality: 'flac', song: { songmid: '1' } })
    expect(result).toEqual({ type: 'result', value: { url: 'https://example.com/flac' } })
  })
  it('脚本不能直接访问 Node require', async () => {
    expect(await executeFixture({ action: 'inspect', content: 'require("node:fs")' })).toMatchObject({ type: 'error' })
  })
  it('音频分析解析实际 PCM 数据，而不是文件后缀', async () => {
    const wav = Buffer.alloc(44 + 8000 * 2)
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28)
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
    const result = await executeFixture({ action: 'analyze', audio: wav.toString('base64') })
    expect(result).toMatchObject({ type: 'result', value: { duration: 1, sampleRate: 8000, bitsPerSample: 16 } })
  })
})

const mocks = vi.hoisted(() => ({ db: { sourceTestDraft: { findFirst: vi.fn(), update: vi.fn() } }, commit: vi.fn(), samples: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: mocks.db }))
vi.mock('@/lib/services/source-manager-service', () => ({ commitTestedSource: mocks.commit, readConfig: vi.fn(), SOURCE_MANAGER_CONSTANTS: { MAX_SCRIPT_SIZE: 5242880 } }))
vi.mock('@/lib/services/system-settings', () => ({ getSystemSetting: mocks.samples }))
const { assessAudio, commitDraft, loadDraft } = await import('@/lib/services/source-test-service')

describe('结果判定与提交', () => {
  const facts: AudioFacts = { codec: 'FLAC', duration: 240, sampleRate: 44100, bitsPerSample: 16, bitrate: 800000, channels: 2, lossless: true }
  beforeEach(() => { vi.clearAllMocks() })
  it('30 秒片段、伪 FLAC 和 16 bit 冒充 24 bit 均标记需确认', () => {
    expect(assessAudio({ ...facts, duration: 30 }, 240, 'flac', true).message).toContain('试听')
    expect(assessAudio({ ...facts, codec: 'MPEG', lossless: false }, 240, 'flac', true).message).toContain('不是 FLAC')
    expect(assessAudio(facts, 240, 'flac24bit', true).message).toContain('24 bit')
  })
  it('未知时长不标记完整版，快速检查不声称下载完成', () => {
    expect(assessAudio({ ...facts, duration: null }, 240, 'flac', true).status).toBe('warning')
    expect(assessAudio(facts, 240, 'flac', false).message).toContain('尚未完整下载')
  })
  it('跨用户查询使用数据库 ownerId 过滤', async () => {
    mocks.db.sourceTestDraft.findFirst.mockResolvedValue(null)
    await expect(loadDraft('00000000-0000-0000-0000-000000000000', 7)).rejects.toMatchObject({ status: 404 })
    expect(mocks.db.sourceTestDraft.findFirst).toHaveBeenCalledWith({ where: { id: '00000000-0000-0000-0000-000000000000', ownerId: 7 } })
  })
  it('未经音频测试不能启用，平台为空也不能启用', async () => {
    const state = { id: '00000000-0000-0000-0000-000000000000', status: 'ready', capabilities: { kw: ['flac'] }, results: [], expiresAt: new Date(Date.now() + 60000).toISOString() }
    mocks.db.sourceTestDraft.findFirst.mockResolvedValue({ stateJson: JSON.stringify(state), privateJson: '{}', content: '', expiresAt: new Date(Date.now() + 60000) })
    await expect(commitDraft(state.id, 7, { pt: ['kw'], enabled: true })).rejects.toThrow('先完成音频测试')
    await expect(commitDraft(state.id, 7, { pt: [], enabled: true })).rejects.toThrow('启用平台')
    expect(mocks.commit).not.toHaveBeenCalled()
  })
})
