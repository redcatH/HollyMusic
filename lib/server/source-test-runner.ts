import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { publicRequest } from '@/lib/source-testing/network.cjs'
import { UPSTREAM_USER_AGENT } from '@/lib/server/download-utils'
import type { MusicInfo, QualityType, SourceType } from '@/lib/types/music'

// Reuse the playback runner's permission flags and environment whitelist, without its shared slots.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SourceRunnerClient, buildChildEnv } = require('../music-core/runner-client') as {
  SourceRunnerClient: new (options: { maxOldSpaceMb: number; permissionAllowReadDirs: string[] }) => { resolveExecArgv(): Promise<string[]> }
  buildChildEnv(): NodeJS.ProcessEnv
}

export type SourceTestJob =
  | { action: 'inspect'; content: string }
  | { action: 'resolve'; content: string; platform: SourceType; quality: QualityType; song: MusicInfo }
  | { action: 'analyze'; audio: string }

interface RunnerState { active: number; flags?: Promise<string[]>; children: Set<ChildProcessWithoutNullStreams>; exitHookBound?: boolean }
const globals = globalThis as typeof globalThis & { localSourceTestRunner?: RunnerState }
const state = globals.localSourceTestRunner ??= { active: 0, children: new Set() }
if (!state.exitHookBound) {
  state.exitHookBound = true
  process.once('exit', () => { for (const child of state.children) child.kill('SIGKILL') })
}
const MAX_INPUT_BYTES = 96 * 1024 * 1024
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

async function executionFlags(): Promise<string[]> {
  if (!state.flags) {
    const resolver = new SourceRunnerClient({
      maxOldSpaceMb: 384,
      permissionAllowReadDirs: [path.resolve(process.cwd(), 'lib'), path.resolve(process.cwd(), 'node_modules')],
    })
    state.flags = resolver.resolveExecArgv().catch((error: unknown) => { state.flags = undefined; throw error })
  }
  return state.flags
}

/** Every operation gets its own process and VM, including when playback is configured as inline. */
export async function runSourceTestJob<T>(job: SourceTestJob, signal?: AbortSignal, timeoutMs?: number): Promise<T> {
  if (signal?.aborted) throw new Error('测试已取消')
  if (state.active >= 2) throw new Error('本地测试正在执行，请稍后重试')
  const input = JSON.stringify(job)
  if (Buffer.byteLength(input) > MAX_INPUT_BYTES) throw new Error('测试输入超过大小限制')
  state.active++
  try {
    const flags = await executionFlags()
    if (signal?.aborted) throw new Error('测试已取消')
    const childEnv = buildChildEnv()
    // A legacy playback setting must never relax test networking or choose main-process execution.
    delete childEnv.SOURCE_ALLOW_PRIVATE_NET
    delete childEnv.SOURCE_RUNNER_MODE
    return await new Promise<T>((resolve, reject) => {
      const child = spawn(process.execPath, [...flags, path.resolve(process.cwd(), 'lib/source-testing/child.cjs')], {
        env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      })
      state.children.add(child)
      // Consume diagnostics without retaining script data or exposing it in logs.
      child.stderr.resume()
      const network = new AbortController()
      let settled = false
      let output = ''
      let outputBytes = 0
      let requests = 0
      let inFlight = 0
      const waitingRequests: Array<() => void> = []
      let outcome: { value: T } | { error: Error } | undefined
      const finish = (error?: Error, value?: T) => {
        if (settled) return
        settled = true
        outcome = error ? { error } : { value: value as T }
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        network.abort()
        while (waitingRequests.length) waitingRequests.shift()!()
        child.stdin.destroy()
        child.kill('SIGKILL')
      }
      const abort = () => finish(new Error('测试已取消'))
      const timer = setTimeout(() => finish(new Error('测试执行超时')), timeoutMs ?? (job.action === 'analyze' ? 30000 : 25000))
      signal?.addEventListener('abort', abort, { once: true })
      child.on('error', () => finish(new Error('无法启动本地测试子进程')))
      child.on('close', () => {
        state.children.delete(child)
        if (!settled) finish(new Error('测试子进程异常退出'))
        if (outcome && 'value' in outcome) resolve(outcome.value)
        else reject(outcome && 'error' in outcome ? outcome.error : new Error('测试子进程异常退出'))
      })
      child.stdin.on('error', () => { if (!settled) finish(new Error('测试进程通信中断')) })

      const send = (id: number, response: Record<string, unknown>) => {
        if (!settled) child.stdin.write(JSON.stringify({ type: 'response', id, ...response }) + '\n')
      }
      const request = async (message: Record<string, unknown>) => {
        if (!Number.isSafeInteger(message.id) || typeof message.url !== 'string' || message.url.length > 8192) {
          finish(new Error('脚本请求格式无效'))
          return
        }
        if (++requests > 30) {
          finish(new Error('脚本请求次数超过限制'))
          return
        }
        if (inFlight >= 4) await new Promise<void>(resume => waitingRequests.push(resume))
        if (settled) return
        inFlight++
        const id = message.id as number
        try {
          const options = message.options && typeof message.options === 'object' ? message.options as Record<string, unknown> : {}
          const method = String(options.method || 'GET').toUpperCase()
          const headers = options.headers && typeof options.headers === 'object' ? { ...options.headers as Record<string, string> } : {}
          if (!Object.keys(headers).some(key => key.toLowerCase() === 'user-agent')) headers['User-Agent'] = UPSTREAM_USER_AGENT
          let body = options.body
          if (options.form || options.formData) {
            body = new URLSearchParams((options.form || options.formData) as Record<string, string>).toString()
            headers['content-type'] = 'application/x-www-form-urlencoded'
          } else if (body && typeof body === 'object') {
            body = JSON.stringify(body)
            headers['content-type'] = 'application/json'
          }
          if (!['GET', 'POST', 'HEAD'].includes(method) || (body && Buffer.byteLength(String(body)) > 512 * 1024)) {
            send(id, { error: '请求方法或请求体不受支持' })
            return
          }
          const response = await publicRequest(message.url, {
            method, body, headers, signal: network.signal, timeout: 10000,
          }) as { status: number; headers: Record<string, unknown>; data: Buffer }
          send(id, { status: response.status, headers: response.headers, data: response.data.toString('base64') })
        } catch {
          send(id, { error: '请求失败或被网络策略阻止' })
        } finally { inFlight--; waitingRequests.shift()?.() }
      }

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        if (settled) return
        outputBytes += Buffer.byteLength(chunk)
        if (outputBytes > MAX_OUTPUT_BYTES) { finish(new Error('测试输出超过限制')); return }
        output += chunk
        let index: number
        while (!settled && (index = output.indexOf('\n')) >= 0) {
          const line = output.slice(0, index)
          output = output.slice(index + 1)
          let message: Record<string, unknown>
          try {
            const parsed: unknown = JSON.parse(line)
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid response')
            message = parsed as Record<string, unknown>
          } catch { finish(new Error('测试响应无效')); return }
          if (message.type === 'result' && message.value !== undefined) finish(undefined, message.value as T)
          else if (message.type === 'error') finish(new Error('脚本初始化、取链或音频解析失败'))
          else if (message.type === 'request') void request(message)
          else finish(new Error('测试响应无效'))
        }
      })
      child.stdin.write(input + '\n')
      if (signal?.aborted) abort()
    })
  } finally { state.active-- }
}
