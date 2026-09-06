import { describe, it, expect, vi } from 'vitest'
import { createScriptSandbox } from './sandbox'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('createScriptSandbox', () => {
  it('脚本不可见任何 Node 全局（require/process/Buffer/global/module）', () => {
    const env = createScriptSandbox({})
    const probe = env.runScript(
      `[typeof require, typeof process, typeof Buffer, typeof global, typeof module, typeof __dirname, typeof globalThis].join(',')`,
      'probe.js'
    )
    expect(probe).toBe('undefined,undefined,undefined,undefined,undefined,undefined,object')
  })

  it('constructor.constructor 无法逃逸到宿主 process', () => {
    const env = createScriptSandbox({})
    const result = env.runScript(`
      (() => {
        try {
          const proc = ({}).constructor.constructor('return process')()
          return 'escaped:' + typeof proc
        } catch (err) {
          return 'blocked:' + err.message
        }
      })()
    `)
    expect(String(result)).toMatch(/^blocked:/)
    // 宿主进程自然存活（测试能走到这里即是证明）
    expect(process.pid).toBeGreaterThan(0)
  })

  it('Function 构造的代码同样拿不到 require', () => {
    const env = createScriptSandbox({})
    const result = env.runScript(`
      (() => {
        try {
          Function('return require')()
          return 'escaped'
        } catch (err) {
          return 'blocked:' + err.message
        }
      })()
    `)
    expect(String(result)).toMatch(/^blocked:/)
  })

  it('URL 与 URLSearchParams 可用（全豆要脚本依赖）', () => {
    const env = createScriptSandbox({})
    expect(env.runScript(`new URL('https://a.com/p?x=1&y=2#h').searchParams.get('y')`)).toBe('2')
    expect(env.runScript(`new URL('https://a.com/p?x=1').searchParams.has('x')`)).toBe(true)
    expect(env.runScript(`new URL('x', 'https://a.com/b/').href`)).toBe('https://a.com/b/x')
    expect(env.runScript(`new URL('https://a.com/p').pathname`)).toBe('/p')
    expect(
      env.runScript(`(() => {
        const sp = new URLSearchParams('a=1&b=2')
        sp.set('a', '9'); sp.append('c', '3')
        return sp.toString()
      })()`)
    ).toBe('a=9&b=2&c=3')
    expect(env.runScript(`new URL('https://a.com/p?a=%E4%BD%A0').searchParams.get('a')`)).toBe('你')
  })

  it('TextEncoder/TextDecoder 支持 utf-8 与 gbk（Node full-icu）', () => {
    const env = createScriptSandbox({})
    expect(env.runScript(`new TextDecoder().decode(new TextEncoder().encode('你好'))`)).toBe('你好')
    // '你好' 的 GBK 编码字节
    expect(
      env.runScript(`new TextDecoder('gbk').decode(new Uint8Array([0xC4, 0xE3, 0xBA, 0xC3]))`)
    ).toBe('你好')
  })

  it('atob/btoa 往返', () => {
    const env = createScriptSandbox({})
    expect(env.runScript(`atob(btoa('hello'))`)).toBe('hello')
    expect(env.runScript(`atob('aGk=')`)).toBe('hi')
  })

  it('setTimeout 在沙箱内触发，dispose 后不再触发', async () => {
    const env = createScriptSandbox({})
    const result = await env.runScript(`new Promise(resolve => setTimeout(() => resolve('tick'), 5))`)
    expect(result).toBe('tick')

    const env2 = createScriptSandbox({})
    env2.runScript(`setTimeout(() => { globalThis.__ticked = true }, 10)`)
    env2.dispose()
    await sleep(40)
    expect(env2.runScript('typeof globalThis.__ticked')).toBe('undefined')
  })

  it('同步死循环被超时中断', () => {
    const env = createScriptSandbox({ syncTimeout: 100 })
    expect(() => env.runScript('while (true) {}')).toThrow()
  })

  it('wrapFn：数据往返、异常转沙箱 Error、返回函数再包装', () => {
    const env = createScriptSandbox({})
    env.setGlobal('__fn', env.wrapFn((a: number, b: number) => ({ sum: a + b })))
    expect(env.runScript('__fn(1, 2).sum')).toBe(3)

    env.setGlobal(
      '__throw',
      env.wrapFn(() => {
        throw new Error('boom')
      })
    )
    expect(
      env.runScript(`(() => {
        try { __throw() } catch (err) { return [err instanceof Error, err.message].join('|') }
      })()`)
    ).toBe('true|boom')

    // 'fn' 策略：宿主取消函数返回给脚本时必须重新包装为沙箱域函数
    env.setGlobal(
      '__getCancel',
      env.wrapFn(
        () => () => 'cancelled',
        'fn'
      )
    )
    expect(
      env.runScript(`(() => {
        const cancel = __getCancel()
        return [typeof cancel, cancel(), cancel instanceof Function].join('|')
      })()`)
    ).toBe('function|cancelled|true')
  })

  it('toBytes/toHostValue：字节双向拷贝，对象递归转纯数据', () => {
    const env = createScriptSandbox({})
    const bytes = env.toBytes(Buffer.from('hi'))
    expect(bytes.length).toBe(2)
    const hostBuffer = env.toHostValue(bytes)
    expect(Buffer.isBuffer(hostBuffer)).toBe(true)
    expect(hostBuffer.toString()).toBe('hi')

    env.setGlobal('__echo', env.wrapFn((value: unknown) => value))
    expect(env.runScript(`__echo({ a: 1, list: [1, 'x'] }).list[1]`)).toBe('x')
  })

  it('console 转发到 onLog 且截断', () => {
    const onLog = vi.fn()
    const env = createScriptSandbox({ onLog })
    env.runScript(`console.log('hello', { a: 1 })`)
    expect(onLog).toHaveBeenCalledWith('log', expect.stringContaining('hello'))
    expect(onLog).toHaveBeenCalledWith('log', expect.stringContaining('"a":1'))

    env.runScript(`console.warn('w'); console.error('e')`)
    expect(onLog).toHaveBeenCalledWith('warn', 'w')
    expect(onLog).toHaveBeenCalledWith('error', 'e')
  })
})
