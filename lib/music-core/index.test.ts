import { describe, it, expect, vi, beforeEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * 端到端：在 vm 沙箱中执行合成音源脚本，覆盖
 * - 正常握手（on + send inited）与 musicUrl/lyric 调用
 * - lx.request 网络桥（本地 HTTP server 走真实网络栈，响应跨界转换）
 * - lx.utils（crypto/buffer）跨界字节
 * - currentScriptInfo.rawScript 自校验（反篡改脚本的常见行为）
 * - 恶意脚本：require 探测 / constructor 逃逸，均被无害阻断
 */

/** 启动本地测试 HTTP server，返回关闭函数与端口。 */
async function startTestServer(handler: http.RequestListener): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    port,
    close: () => new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve()))),
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const LXEnvironmentSimulator = require('./index')

const INITED_KW = `send(EVENT_NAMES.inited, { sources: { kw: { type: 'music', actions: ['musicUrl', 'lyric'], qualitys: ['128k', '320k'] } } })`

const NORMAL_SCRIPT = `
const { EVENT_NAMES, on, send } = globalThis.lx
on(EVENT_NAMES.request, ({ source, action, info }) => {
  if (action === 'musicUrl') return Promise.resolve('https://example.com/stream.mp3')
  if (action === 'lyric') return Promise.resolve({ lyric: '[00:00.00]hello', tlyric: null, rlyric: null, lxlyric: null })
  return Promise.reject(new Error('unsupported action: ' + action))
})
${INITED_KW}
`

describe('LXEnvironmentSimulator 沙箱端到端', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('正常脚本：握手、musicUrl、lyric 全链路', async () => {
    const sim = new LXEnvironmentSimulator()
    const info = await sim.executeScript(NORMAL_SCRIPT)
    expect(Object.keys(info.sources)).toEqual(['kw'])

    const url = await sim.getMusicUrl('kw', { songmid: '123', name: '测试' }, '128k')
    expect(url).toBe('https://example.com/stream.mp3')

    const lyric = await sim.getLyric('kw', { songmid: '123' })
    expect(lyric.lyric).toBe('[00:00.00]hello')
  })

  it('lx.request 网络桥：响应对象/JSON body/字节跨界转换', async () => {
    let hitCount = 0
    const server = await startTestServer((_req, res) => {
      hitCount++
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"u":1}')
    })

    try {
      const sim = new LXEnvironmentSimulator()
      await sim.executeScript(`
        const { EVENT_NAMES, on, send, request } = globalThis.lx
        on(EVENT_NAMES.request, () => new Promise((resolve, reject) => {
          request('http://127.0.0.1:${server.port}/v1', {}, (err, resp, body) => {
            if (err) return reject(err)
            resolve('https://mirror/' + resp.statusCode + '/' + body.u + '/' + resp.raw.length + '/' + resp.headers['content-type'])
          })
        }))
        ${INITED_KW}
      `)

      const url = await sim.getMusicUrl('kw', { songmid: 'x' }, '128k')
      expect(url).toBe('https://mirror/200/1/7/application/json')
      expect(hitCount).toBe(1)
    } finally {
      await server.close()
    }
  })

  it('lx.request 错误分支：err 转沙箱 Error', async () => {
    const sim = new LXEnvironmentSimulator()
    await sim.executeScript(`
      const { EVENT_NAMES, on, send, request } = globalThis.lx
      on(EVENT_NAMES.request, () => new Promise((resolve, reject) => {
        // 端口 1 上没有服务，必然连接失败
        request('http://127.0.0.1:1/v1', { timeout: 2000 }, (err) => {
          if (err && err instanceof Error) reject(new Error('got-error:' + err.message))
          else reject(new Error('no-error'))
        })
      }))
      ${INITED_KW}
    `)

    await expect(sim.getMusicUrl('kw', { songmid: 'x' }, '128k')).rejects.toThrow(/got-error:.*(ECONNREFUSED|EADDRNOTAVAIL|HPE_INVALID)/)
  })

  it('lx.utils：md5/buffer/randomBytes 跨界字节', async () => {
    const sim = new LXEnvironmentSimulator()
    await sim.executeScript(`
      const { EVENT_NAMES, on, send, utils } = globalThis.lx
      on(EVENT_NAMES.request, () => {
        const bytes = utils.buffer.from('hello', 'utf8')
        const random = utils.crypto.randomBytes(4)
        return Promise.resolve(utils.crypto.md5('abc') + '|' + bytes.length + '|' + random.length)
      })
      ${INITED_KW}
    `)
    const url = await sim.getMusicUrl('kw', { songmid: 'x' }, '128k')
    expect(url).toBe('900150983cd24fb0d6963f7d28e17f72|5|4')
  })

  it('currentScriptInfo.rawScript 完整可读（反篡改自校验）', async () => {
    const sim = new LXEnvironmentSimulator()
    const script = `
      const { EVENT_NAMES, on, send, currentScriptInfo } = globalThis.lx
      on(EVENT_NAMES.request, () => Promise.resolve(
        currentScriptInfo.rawScript.length > 0 && currentScriptInfo.name === '测试源' ? 'raw-ok' : 'raw-missing'
      ))
      ${INITED_KW}
    `
    // 把头部注释拼进脚本，parseScriptInfo 才能取到 name
    const fullScript = `/*\n * @name 测试源\n * @version 1.0.0\n */\n${script}`
    await sim.executeScript(fullScript)
    await expect(sim.getMusicUrl('kw', { songmid: 'x' }, '128k')).resolves.toBe('raw-ok')
  })

  it('恶意脚本：require 探测直接失败（对齐真实洛雪行为）', async () => {
    const sim = new LXEnvironmentSimulator()
    await expect(
      sim.executeScript(`
        const cp = require('child_process')
        cp.execSync('shutdown /s /t 0')
      `)
    ).rejects.toThrow(/require is not defined/)
    // 宿主进程存活
    expect(process.pid).toBeGreaterThan(0)
  })

  it('恶意脚本：handler 内 constructor 逃逸被阻断而非逃逸', async () => {
    const sim = new LXEnvironmentSimulator()
    await sim.executeScript(`
      const { EVENT_NAMES, on, send } = globalThis.lx
      on(EVENT_NAMES.request, () => {
        let proc
        try {
          proc = ({}).constructor.constructor('return process')()
        } catch (err) {
          throw new Error('escape blocked: ' + err.message)
        }
        if (proc) proc.kill()
        return Promise.resolve('should-not-reach')
      })
      ${INITED_KW}
    `)
    await expect(sim.getMusicUrl('kw', { songmid: 'x' }, '128k')).rejects.toThrow('escape blocked')
    expect(process.pid).toBeGreaterThan(0)
  })

  it('同一实例重载脚本：旧沙箱被清理，状态重建', async () => {
    const sim = new LXEnvironmentSimulator()
    await sim.executeScript(NORMAL_SCRIPT)
    await sim.executeScript(NORMAL_SCRIPT)
    expect(sim.getSupportedSources()).toEqual(['kw'])
    await expect(sim.getMusicUrl('kw', { songmid: 'x' }, '128k')).resolves.toBe('https://example.com/stream.mp3')
  })
})
