import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 集成测试：真实 fork 子进程，覆盖 runner/runner-client 全链路
 * - 正常加载与调用（IPC 往返）
 * - 子进程被 kill：pending 全部拒绝、退避重启、slot 自动恢复
 * - 崩溃风暴（沙箱 interval 死循环卡死子进程 → 心跳失联）→ 熔断
 * - 一次性校验进程：正常脚本 / require 攻击脚本
 * - SOURCE_RUNNER_MODE=inline 逃生舱
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SourceRunnerClient } = require('./runner-client')

/** 正常音源脚本：quality 传 'hang' 时永不返回（用于制造 pending 调用） */
const NORMAL_SCRIPT = `
const { EVENT_NAMES, on, send } = globalThis.lx
on(EVENT_NAMES.request, ({ action, info }) => {
  if (action === 'musicUrl') {
    if (info && info.type === 'hang') return new Promise(() => {})
    return Promise.resolve('https://example.com/stream.mp3')
  }
  if (action === 'lyric') return Promise.resolve({ lyric: 'lyric-ok', tlyric: null })
  return Promise.reject(new Error('unsupported action'))
})
send(EVENT_NAMES.inited, { sources: { kw: { type: 'music', actions: ['musicUrl', 'lyric'], qualitys: ['128k', '320k'] } } })
`

/** 崩溃风暴脚本：握手通过后沙箱 interval 同步死循环，卡死子进程事件循环（心跳失联路径） */
const CRASH_LOOP_SCRIPT = `
const { EVENT_NAMES, on, send } = globalThis.lx
on(EVENT_NAMES.request, () => Promise.resolve('https://x'))
send(EVENT_NAMES.inited, { sources: { kw: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } } })
setInterval(() => { while (true) {} }, 1)
`

function writeTempScript(content: string): string {
  const file = path.join(os.tmpdir(), `lx-runner-test-${Date.now()}-${Math.random().toString(36).slice(2)}.js`)
  fs.writeFileSync(file, content, 'utf-8')
  return file
}

async function waitFor(cond: () => boolean, timeoutMs = 15_000, label = 'condition'): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor 超时: ${label}`)
    await new Promise(r => setTimeout(r, 50))
  }
}

const MUSIC_INFO = { songmid: 'test-song', name: '测试', singer: '测试' } as never

describe('SourceRunnerClient 子进程集成', () => {
  const clients: Array<{ shutdown: () => void }> = []

  function createClient(options?: Record<string, unknown>) {
    // 临时脚本写在 os.tmpdir()，permission 加固下需把它加入子进程可读白名单
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = new SourceRunnerClient({
      permissionAllowReadDirs: [process.cwd(), os.tmpdir()],
      ...options,
    } as any)
    clients.push(client)
    return client
  }

  afterEach(async () => {
    for (const c of clients.splice(0)) c.shutdown()
    delete process.env.SOURCE_RUNNER_MODE
  })

  it(
    '正常链路：子进程加载音源脚本并经 IPC 调用',
    { timeout: 30_000 },
    async () => {
      const script = writeTempScript(NORMAL_SCRIPT)
      const runner = createClient()
      expect(runner.mode).toBe('process')

      const slot = await runner.acquireSlot()
      const sourceInfo = (await slot.loadScript(script)) as { sources: Record<string, unknown> }
      expect(Object.keys(sourceInfo.sources)).toEqual(['kw'])

      await expect(slot.getMusicUrl('kw', MUSIC_INFO, '128k')).resolves.toBe('https://example.com/stream.mp3')
      const lyric = (await slot.getLyric('kw', MUSIC_INFO)) as { lyric: string }
      expect(lyric.lyric).toBe('lyric-ok')
    }
  )

  it(
    '子进程被 kill：pending 拒绝、主进程存活、重启后 slot 自动恢复',
    { timeout: 30_000 },
    async () => {
      const script = writeTempScript(NORMAL_SCRIPT)
      const runner = createClient({ backoffBaseMs: 50 })

      const slot = await runner.acquireSlot()
      await slot.loadScript(script)

      // 制造一个 pending 调用（handler 永不返回）
      const pendingResult = slot.getMusicUrl('kw', MUSIC_INFO, 'hang').catch(err => err.message)
      await new Promise(r => setTimeout(r, 100))

      // 模拟子进程被外部杀死
      runner.child.kill('SIGKILL')

      await expect(pendingResult).resolves.toMatch(/音源子进程退出/)
      expect(process.pid).toBeGreaterThan(0)

      // 退避重启 + slot 恢复
      await waitFor(() => runner.state === 'running', 15_000, 'runner 重启')
      await expect(slot.getMusicUrl('kw', MUSIC_INFO, '128k')).resolves.toBe('https://example.com/stream.mp3')
    }
  )

  it(
    '崩溃风暴（interval 死循环卡死子进程）触发心跳失联与熔断',
    { timeout: 60_000 },
    async () => {
      const script = writeTempScript(CRASH_LOOP_SCRIPT)
      const runner = createClient({
        heartbeatIntervalMs: 150,
        heartbeatMissLimit: 3,
        backoffBaseMs: 20,
        backoffMaxMs: 100,
        restartWindowMs: 10_000,
        restartMaxInWindow: 3,
      })

      const slot = await runner.acquireSlot()
      await slot.loadScript(script)

      await waitFor(() => runner.state === 'tripped', 50_000, '熔断')

      // 熔断后新调用快速失败，主进程存活
      await expect(runner.acquireSlot()).rejects.toThrow(/熔断/)
      expect(process.pid).toBeGreaterThan(0)
    }
  )

  it(
    '一次性校验进程：正常脚本通过，require 攻击脚本错误透传',
    { timeout: 30_000 },
    async () => {
      const runner = createClient()

      const ok = await runner.validateScript(NORMAL_SCRIPT)
      expect(ok.ok).toBe(true)
      expect((ok.sourceInfo as { sources: Record<string, unknown> }).sources.kw).toBeTruthy()

      const bad = await runner.validateScript('require("child_process").execSync("echo pwned")')
      expect(bad.ok).toBe(false)
      expect(bad.error).toMatch(/require is not defined/)
    }
  )

  it(
    'SOURCE_RUNNER_MODE=inline 逃生舱：主进程直连（等价 P0）',
    { timeout: 30_000 },
    async () => {
      process.env.SOURCE_RUNNER_MODE = 'inline'
      const script = writeTempScript(NORMAL_SCRIPT)
      const runner = createClient()

      expect(runner.mode).toBe('inline')
      const slot = await runner.acquireSlot()
      const sourceInfo = (await slot.loadScript(script)) as { sources: Record<string, unknown> }
      expect(Object.keys(sourceInfo.sources)).toEqual(['kw'])
      await expect(slot.getMusicUrl('kw', MUSIC_INFO, '128k')).resolves.toBe('https://example.com/stream.mp3')
    }
  )
})
