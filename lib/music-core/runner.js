/**
 * 音源脚本执行子进程（runner）
 *
 * 由 runner-client.js fork 启动，持有全部 LXEnvironmentSimulator 实例
 * （P0 vm 沙箱），主进程仅通过 IPC 消息交互。脚本崩溃 / 内存耗尽 /
 * 沙箱逃逸的最坏结果就是本进程死亡，由主进程自动重启恢复。
 *
 * 启动形态：
 * - 常驻模式：fork 后进入消息循环（slot 管理）
 * - --validate-only：一次性校验进程，收到首条 validate 消息处理后即退出，
 *   用于管理员上传/订阅脚本前的预校验（不可信代码首跑不碰常驻进程）
 * - --probe：权限 flag 可用性探测，立即退出
 */

'use strict'

const LXEnvironmentSimulator = require('./index')

const VALIDATE_ONLY = process.argv.includes('--validate-only')
const PROBE = process.argv.includes('--probe')

if (PROBE) {
  process.exit(0)
}

/** @type {Map<number, { sim: InstanceType<typeof LXEnvironmentSimulator>, scriptPath: string | null }>} */
const slots = new Map()
let slotSeq = 1

function send(msg) {
  if (process.send) {
    try {
      process.send(msg)
    } catch {}
  }
}

/** 结果中的二进制（Buffer/TypedArray）转 base64 标记，跨平台 IPC 稳定传递。 */
function encodeIpcValue(value) {
  if (value !== null && typeof value === 'object' && typeof value.length === 'number') {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      return { __ipcBytes: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') }
    }
  }
  return value
}

function disposeSlot(slot) {
  try {
    if (slot && typeof slot.sim.dispose === 'function') slot.sim.dispose()
  } catch {}
}

async function handleMessage(msg) {
  switch (msg && msg.t) {
    case 'ping': {
      send({ t: 'pong', reqId: msg.reqId })
      return
    }

    case 'validate': {
      // 仅一次性校验进程处理；常驻进程不接受不可信内容校验
      if (!VALIDATE_ONLY) throw new Error('常驻进程不接受校验请求')
      // 处理完退出（同时清理沙箱定时器）
      let sim = null
      try {
        sim = new LXEnvironmentSimulator()
        const info = await sim.executeScript(msg.content)
        send({ t: 'result', reqId: msg.reqId, ok: true, value: info || null })
      } catch (err) {
        send({
          t: 'result',
          reqId: msg.reqId,
          ok: false,
          error: { message: err && err.message ? err.message : String(err) },
        })
      }
      try {
        if (sim && typeof sim.dispose === 'function') sim.dispose()
      } catch {}
      process.exit(0)
    }

    case 'slot.create': {
      const slotId = slotSeq++
      slots.set(slotId, { sim: new LXEnvironmentSimulator(), scriptPath: null })
      send({ t: 'result', reqId: msg.reqId, ok: true, value: { slotId } })
      return
    }

    case 'slot.load': {
      const slot = slots.get(msg.slotId)
      if (!slot) throw new Error('slot 不存在')
      const info = await slot.sim.loadScript(msg.scriptPath)
      slot.scriptPath = msg.scriptPath
      send({ t: 'result', reqId: msg.reqId, ok: true, value: info || null })
      return
    }

    case 'slot.call': {
      const slot = slots.get(msg.slotId)
      if (!slot) throw new Error('slot 不存在')
      const fn = slot.sim[msg.method]
      if (typeof fn !== 'function') throw new Error(`音源实例不支持方法: ${msg.method}`)
      const result = await fn.apply(slot.sim, msg.args || [])
      send({ t: 'result', reqId: msg.reqId, ok: true, value: encodeIpcValue(result) })
      return
    }

    case 'slot.dispose': {
      const slot = slots.get(msg.slotId)
      if (slot) {
        disposeSlot(slot)
        slots.delete(msg.slotId)
      }
      send({ t: 'result', reqId: msg.reqId, ok: true, value: null })
      return
    }

    case 'shutdown': {
      for (const slot of slots.values()) disposeSlot(slot)
      slots.clear()
      send({ t: 'result', reqId: msg.reqId, ok: true, value: null })
      process.exit(0)
    }

    default:
      return
  }
}

process.on('message', (msg) => {
  handleMessage(msg).catch((err) => {
    send({
      t: 'result',
      reqId: msg && msg.reqId,
      ok: false,
      error: { message: err && err.message ? err.message : String(err) },
    })
  })
})

// 子进程内任何未捕获异常都不应波及主进程；退出后由主进程按重启策略恢复
process.on('uncaughtException', (err) => {
  // stderr 由主进程 stdio:inherit 直达容器日志
  console.error('[runner] uncaught exception，进程将退出:', err && err.message)
  process.exit(1)
})
