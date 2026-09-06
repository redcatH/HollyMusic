/**
 * 音源运行器客户端（主进程侧）
 *
 * 把 LXEnvironmentSimulator（P0 vm 沙箱）整体托管到独立子进程：
 * - 崩溃 / 内存耗尽 / 心跳失联 → 自动重启并恢复全部已加载音源
 * - 重启风暴 → 熔断（快速失败 + 人工介入提示），主服务不受影响
 * - 上传/订阅预校验走一次性子进程，不可信代码首跑不碰常驻进程
 * - SOURCE_RUNNER_MODE=inline 逃生舱：回退主进程直连（等价 P0 行为）
 *
 * 外层超时由 music-source-manager 既有逻辑承担（musicUrl 单源 15s /
 * 总 45s，歌词/封面 5s），本层只做心跳失联检测，不重复造调用超时。
 */

'use strict'

const { spawn } = require('child_process')
const path = require('path')

// Next/vitest 环境用项目 logger；裸 Node（冒烟脚本）回退 console
let loggerApi = null
try {
  loggerApi = require('../logger').logger
} catch {
  loggerApi = null
}
const log = {
  debug: (...args) => (loggerApi ? loggerApi.debug(...args) : console.log('[runner-client]', ...args)),
  info: (...args) => (loggerApi ? loggerApi.info(...args) : console.log('[runner-client]', ...args)),
  warn: (...args) => (loggerApi ? loggerApi.warn(...args) : console.warn('[runner-client]', ...args)),
  error: (...args) => (loggerApi ? loggerApi.error(...args) : console.error('[runner-client]', ...args)),
}

/**
 * runner.js 路径。延迟求值并掺入环境变量读取，防止打包器（Turbopack）
 * 把 path.join(__dirname, 'runner.js') 常量折叠后当作可解析的 import
 * 去 fork —— 子进程路径是运行时文件系统路径，不是 bundle 内模块。
 */
let cachedRunnerPath = null
function getRunnerPath() {
  if (!cachedRunnerPath) {
    cachedRunnerPath = path.join(__dirname, process.env.LX_RUNNER_FILE || 'runner.js')
  }
  return cachedRunnerPath
}

const DEFAULT_OPTIONS = {
  /** 子进程老生代内存上限（MB），超限子进程 OOM 退出并自动重启 */
  maxOldSpaceMb: 256,
  heartbeatIntervalMs: 10_000,
  /** 连续未收到 pong 的次数上限（×心跳间隔 ≈ 失联判定窗口） */
  heartbeatMissLimit: 3,
  /** 崩溃重启计数窗口（毫秒） */
  restartWindowMs: 5 * 60_000,
  /** 窗口内允许的最大重启次数，超过即熔断 */
  restartMaxInWindow: 5,
  backoffBaseMs: 1_000,
  backoffMaxMs: 60_000,
  /** permission 加固下子进程允许读取的目录（默认项目根目录，测试可追加） */
  permissionAllowReadDirs: null,
}

class SourceRunnerClient {
  /**
   * @param {Partial<typeof DEFAULT_OPTIONS>} [options]
   */
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    /** @type {import('child_process').ChildProcess | null} */
    this.child = null
    this.startPromise = null
    /** @type {Map<number, { resolve: (v: unknown) => void, reject: (e: Error) => void, label: string }>} */
    this.pending = new Map()
    /** 逻辑 slot（重启后重映射）：logicalKey → { scriptPath, liveSlotId } */
    this.slotRegistry = new Map()
    this.slotSeq = 1
    this.reqSeq = 1
    this.heartbeatTimer = null
    this.heartbeatMisses = 0
    this.restartHistory = []
    this.restartAttempt = 0
    this.restartTimer = null
    /** idle | starting | running | restarting | tripped | stopped */
    this.state = 'idle'
    this.closing = false
    /** null = 未探测；数组 = 探测结果（空数组表示不支持 permission flag） */
    this.permissionFlags = null
    this.exitHooksBound = false
  }

  get mode() {
    return String(process.env.SOURCE_RUNNER_MODE || 'process').toLowerCase() === 'inline'
      ? 'inline'
      : 'process'
  }

  // ------------------------------------------------------------------
  // 对外 API
  // ------------------------------------------------------------------

  /**
   * 获取一个音源 slot 代理（接口与 LXEnvironmentSimulator 的使用面对齐：
   * loadScript / getMusicUrl / getLyric / getPic / dispose）。
   */
  async acquireSlot() {
    if (this.mode === 'inline') return createInlineSlot()

    if (this.state === 'tripped') {
      throw new Error('音源运行器已熔断（连续崩溃），请检查音源脚本后重启服务')
    }
    await this.ensureStarted()

    const logicalKey = `slot-${this.slotSeq++}`
    const { slotId } = await this.request('slot.create', {})
    this.slotRegistry.set(logicalKey, { scriptPath: null, liveSlotId: slotId })

    const self = this
    return {
      loadScript: async function loadScript(scriptPath) {
        const info = await self.request('slot.load', {
          slotId: self.liveSlotIdOf(logicalKey),
          scriptPath,
        })
        const entry = self.slotRegistry.get(logicalKey)
        if (entry) entry.scriptPath = scriptPath
        return info
      },
      getMusicUrl: (source, musicInfo, quality) =>
        self
          .request('slot.call', {
            slotId: self.liveSlotIdOf(logicalKey),
            method: 'getMusicUrl',
            args: [source, musicInfo, quality],
          })
          .then(decodeIpcValue),
      getLyric: (source, musicInfo) =>
        self
          .request('slot.call', {
            slotId: self.liveSlotIdOf(logicalKey),
            method: 'getLyric',
            args: [source, musicInfo],
          })
          .then(decodeIpcValue),
      getPic: (...args) =>
        self
          .request('slot.call', {
            slotId: self.liveSlotIdOf(logicalKey),
            method: 'getPic',
            args,
          })
          .then(decodeIpcValue),
      dispose: async () => {
        const entry = self.slotRegistry.get(logicalKey)
        self.slotRegistry.delete(logicalKey)
        if (!entry) return
        try {
          await self.request('slot.dispose', { slotId: entry.liveSlotId })
        } catch {
          // 进程可能已重启/关闭，slot 不存在属预期
        }
      },
    }
  }

  /**
   * 在一次性子进程中预校验脚本内容（不可信代码首跑隔离）。
   * @param {string} scriptContent
   * @param {number} [timeoutMs]
   * @returns {Promise<{ ok: boolean, sourceInfo?: unknown, error?: string }>}
   */
  async validateScript(scriptContent, timeoutMs = 15_000) {
    if (this.mode === 'inline') return validateInline(scriptContent)

    const flags = await this.resolveExecArgv()
    // 不用 child_process.fork：打包器会尝试把 fork() 的模块路径当作
    // import 解析（Turbopack 连非常量参数也分析）。spawn + 'ipc' stdio
    // 与 fork 等价（同样建立 IPC channel，process.send/on('message') 可用）
    const child = spawn(process.execPath, [getRunnerPath(), '--validate-only'], {
      execArgv: flags,
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    })

    return new Promise((resolve) => {
      let settled = false
      const finish = (result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          if (child.connected) child.kill()
        } catch {}
        resolve(result)
      }
      const timer = setTimeout(() => {
        finish({ ok: false, error: `脚本校验超时（${Math.round(timeoutMs / 1000)}s）` })
        try {
          child.kill('SIGKILL')
        } catch {}
      }, timeoutMs)

      child.on('message', (msg) => {
        if (msg && msg.t === 'result') {
          if (msg.ok) finish({ ok: true, sourceInfo: msg.value })
          else finish({ ok: false, error: msg.error && msg.error.message ? msg.error.message : '校验失败' })
        }
      })
      child.on('exit', () => {
        finish({ ok: false, error: '校验进程异常退出' })
      })
      child.on('error', (err) => {
        finish({ ok: false, error: `校验进程启动失败: ${err.message}` })
      })

      try {
        child.send({ t: 'validate', reqId: 1, content: scriptContent })
      } catch (err) {
        finish({ ok: false, error: `校验消息发送失败: ${err.message}` })
      }
    })
  }

  /** 优雅关闭（SIGTERM/SIGINT/进程退出钩子调用）。 */
  shutdown() {
    if (this.closing) return
    this.closing = true
    this.state = 'stopped'
    this.stopHeartbeat()
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.rejectAllPending(new Error('音源运行器已关闭'))
    if (this.child) {
      try {
        this.child.send({ t: 'shutdown' })
      } catch {}
      try {
        this.child.kill('SIGTERM')
      } catch {}
      // 兜底强杀（unref 不阻塞主进程退出）
      const child = this.child
      const killer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {}
      }, 3_000)
      if (typeof killer.unref === 'function') killer.unref()
      this.child = null
    }
  }

  // ------------------------------------------------------------------
  // 启动与生命周期
  // ------------------------------------------------------------------

  async ensureStarted() {
    if (this.child && (this.state === 'running' || this.state === 'starting')) return this.startPromise
    if (this.state === 'tripped') throw new Error('音源运行器已熔断')
    if (this.state === 'restarting') {
      // 上层多源回退与总超时可兜住短暂不可用
      throw new Error('音源运行器正在重启，请稍后重试')
    }
    if (!this.startPromise) {
      this.startPromise = this.start().finally(() => {
        this.startPromise = null
      })
    }
    return this.startPromise
  }

  async start() {
    this.state = 'starting'
    try {
      await this.startInner()
    } catch (err) {
      // 启动阶段失败时复位状态，允许下次调用重试
      if (this.state === 'starting') this.state = 'idle'
      throw err
    }
  }

  async startInner() {
    const flags = await this.resolveExecArgv()
    await new Promise((resolve, reject) => {
      // spawn + 'ipc' 等价 fork（见 validateScript 内注释）
      const child = spawn(process.execPath, [getRunnerPath()], {
        execArgv: flags,
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      })
      this.child = child
      let spawnError = null

      child.on('error', (err) => {
        spawnError = err
      })
      child.on('message', (msg) => this.handleMessage(msg))
      child.on('exit', (code, signal) => this.handleExit(code, signal))

      // fork 返回即认为 channel 建立（首条消息由系统缓冲）；
      // error 事件用 setImmediate 窗口捕获同步 spawn 失败
      setImmediate(() => (spawnError ? reject(spawnError) : resolve()))
    })

    this.restartAttempt = 0
    this.startHeartbeat()
    this.bindExitHooks()

    // 重启后恢复已注册的音源 slot；恢复完成前 state 保持 starting，
    // 对外调用会被拒绝（上层多源回退兜住），避免撞上半初始化的 slot
    if (this.slotRegistry.size > 0) {
      await this.restoreSlots()
    }
    this.state = 'running'
    log.info(
      `音源运行器子进程已启动（permission=${this.permissionFlags && this.permissionFlags.length > 0 ? 'on' : 'off'}）`
    )
  }

  /** 崩溃重启后按注册表恢复 slot（重新 create + load）。 */
  async restoreSlots() {
    for (const [logicalKey, entry] of this.slotRegistry) {
      if (!entry.scriptPath) continue
      try {
        const { slotId } = await this.rawRequest('slot.create', {})
        entry.liveSlotId = slotId
        await this.rawRequest('slot.load', { slotId, scriptPath: entry.scriptPath })
        log.info(`音源 slot 已恢复: ${path.basename(entry.scriptPath)}`)
      } catch (err) {
        log.error(
          `音源 slot 恢复失败: ${entry.scriptPath ? path.basename(entry.scriptPath) : logicalKey}`,
          err instanceof Error ? err.message : err
        )
      }
    }
  }

  handleMessage(msg) {
    if (!msg) return
    if (msg.t === 'pong') {
      this.heartbeatMisses = 0
      return
    }
    if (msg.t === 'result') {
      const entry = this.pending.get(msg.reqId)
      if (!entry) return
      this.pending.delete(msg.reqId)
      if (msg.ok) entry.resolve(msg.value)
      else entry.reject(new Error(msg.error && msg.error.message ? msg.error.message : '未知错误'))
    }
  }

  handleExit(code, signal) {
    this.child = null
    this.stopHeartbeat()
    this.rejectAllPending(new Error(`音源子进程退出（code=${code} signal=${signal}）`))

    if (this.closing || this.state === 'stopped') return

    this.scheduleRestart()
  }

  scheduleRestart() {
    const now = Date.now()
    this.restartHistory = this.restartHistory.filter((t) => now - t < this.options.restartWindowMs)
    this.restartHistory.push(now)

    if (this.restartHistory.length > this.options.restartMaxInWindow) {
      this.state = 'tripped'
      this.trippedAt = now
      log.error(
        `音源运行器熔断：${this.options.restartWindowMs / 1000}s 内重启超过 ` +
          `${this.options.restartMaxInWindow} 次。音源不可用，请排查音源脚本后重启服务`
      )
      return
    }

    this.state = 'restarting'
    const delay = Math.min(
      this.options.backoffBaseMs * Math.pow(2, this.restartAttempt),
      this.options.backoffMaxMs
    )
    this.restartAttempt++
    log.warn(`音源子进程异常退出，${delay}ms 后自动重启（第 ${this.restartAttempt} 次）`)

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.state = 'idle'
      this.ensureStarted().catch((err) => {
        log.error('音源运行器重启失败:', err instanceof Error ? err.message : err)
      })
    }, delay)
  }

  // ------------------------------------------------------------------
  // 心跳
  // ------------------------------------------------------------------

  startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatMisses = 0
    this.heartbeatTimer = setInterval(() => {
      if (!this.child) return
      this.heartbeatMisses++
      if (this.heartbeatMisses >= this.options.heartbeatMissLimit) {
        log.warn('音源子进程心跳失联，强制结束并重启')
        try {
          this.child.kill('SIGKILL')
        } catch {}
        return
      }
      try {
        this.child.send({ t: 'ping', reqId: 0 })
      } catch {}
    }, this.options.heartbeatIntervalMs)
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // ------------------------------------------------------------------
  // IPC 请求
  // ------------------------------------------------------------------

  liveSlotIdOf(logicalKey) {
    const entry = this.slotRegistry.get(logicalKey)
    if (!entry) throw new Error('音源 slot 已释放')
    return entry.liveSlotId
  }

  request(type, payload) {
    if (!this.child || this.state !== 'running') {
      return Promise.reject(new Error('音源运行器不可用'))
    }
    return this.rawRequest(type, payload)
  }

  /** 内部 IPC 请求（不检查对外状态，供启动/恢复流程使用）。 */
  rawRequest(type, payload) {
    if (!this.child) {
      return Promise.reject(new Error('音源运行器不可用'))
    }
    const reqId = this.reqSeq++
    const label = type
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject, label })
      try {
        this.child.send({ t: type, reqId, ...payload })
      } catch (err) {
        this.pending.delete(reqId)
        reject(new Error(`IPC 发送失败: ${err.message}`))
      }
    })
  }

  rejectAllPending(err) {
    for (const entry of this.pending.values()) entry.reject(err)
    this.pending.clear()
  }

  // ------------------------------------------------------------------
  // 权限 flag 探测
  // ------------------------------------------------------------------

  /**
   * 尝试 --experimental-permission（默认拒绝 child_process / 文件写入），
   * 探测失败自动回退（Node 20 实验性；最坏只是少一层兜底）。
   */
  async resolveExecArgv() {
    const base = [`--max-old-space-size=${this.options.maxOldSpaceMb}`]
    if (this.permissionFlags === null) {
      this.permissionFlags = await probePermissionFlags(this.allowReadDirs())
      if (this.permissionFlags.length > 0) {
        log.info('音源子进程 permission 加固已启用（child_process/文件写入默认拒绝）')
      } else {
        log.info('当前 Node 不支持 permission flag，音源子进程以普通隔离模式运行')
      }
    }
    return [...base, ...this.permissionFlags]
  }

  allowReadDirs() {
    return this.options.permissionAllowReadDirs && this.options.permissionAllowReadDirs.length > 0
      ? this.options.permissionAllowReadDirs
      : [process.cwd()]
  }

  bindExitHooks() {
    if (this.exitHooksBound) return
    this.exitHooksBound = true
    for (const hook of ['SIGTERM', 'SIGINT', 'exit']) {
      process.on(hook, () => this.shutdown())
    }
  }
}

/**
 * 探测 permission flag 可用性：能以 flag 启动 runner --probe 即视为支持。
 * Node 20/22 为 --experimental-permission，Node 23+ 起稳定为 --permission，
 * 按序尝试；都不支持则回退空数组（普通进程隔离）。
 * @returns {Promise<string[]>}
 */
function probePermissionFlags(extraDirs) {
  const readFlag = `--allow-fs-read=${extraDirs.join(',')}`
  const candidates = [
    ['--experimental-permission', readFlag],
    ['--permission', readFlag],
  ]

  const tryProbe = (flags) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [...flags, getRunnerPath(), "--probe"], { stdio: "ignore" })
      child.on('error', () => resolve([]))
      child.on('exit', (code) => resolve(code === 0 ? flags : []))
    })

  return tryProbe(candidates[0]).then((result) => (result.length > 0 ? result : tryProbe(candidates[1])))
}

// ------------------------------------------------------------------
// inline 逃生舱（等价 P0：主进程直连 vm 沙箱）
// ------------------------------------------------------------------

function createInlineSlot() {
  const LXEnvironmentSimulator = require('./index')
  const sim = new LXEnvironmentSimulator()
  return {
    loadScript: (scriptPath) => sim.loadScript(scriptPath),
    getMusicUrl: (source, musicInfo, quality) => sim.getMusicUrl(source, musicInfo, quality),
    getLyric: (source, musicInfo) => sim.getLyric(source, musicInfo),
    getPic: (...args) => sim.getPic(...args),
    dispose: () => {
      try {
        if (typeof sim.dispose === 'function') sim.dispose()
      } catch {}
    },
  }
}

async function validateInline(scriptContent) {
  let sim = null
  try {
    const LXEnvironmentSimulator = require('./index')
    sim = new LXEnvironmentSimulator()
    const info = await sim.executeScript(scriptContent)
    return { ok: true, sourceInfo: sim.sourceInfo }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    try {
      if (sim && typeof sim.dispose === 'function') sim.dispose()
    } catch {}
  }
}

/** 解码 IPC 结果中的 base64 字节标记。 */
function decodeIpcValue(value) {
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof value.__ipcBytes === 'string' &&
    !Array.isArray(value)
  ) {
    return Buffer.from(value.__ipcBytes, 'base64')
  }
  return value
}

let sharedClient = null

/** 共享单例（音源管理器与预校验共用一个常驻 runner）。 */
function getSourceRunner() {
  if (!sharedClient) sharedClient = new SourceRunnerClient()
  return sharedClient
}

module.exports = { SourceRunnerClient, getSourceRunner }
