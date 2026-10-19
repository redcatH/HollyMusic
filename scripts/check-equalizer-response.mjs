/** 原生 Chromium 音频验收；测试生产模块，无额外依赖。 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

if (typeof WebSocket === 'undefined') throw new Error('原生音频验证脚本需要 Node.js 22+（内置 WebSocket）。')

const chrome = process.env.CHROME_BIN || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'chromium')
const directory = mkdtempSync(join(tmpdir(), 'holly-eq-response-'))
try {
  const modules = ['equalizer', 'audio-param-smoother', 'equalizer-automation'].map(name => {
    const code = ts.transpileModule(readFileSync(fileURLToPath(new URL(`../lib/client/${name}.ts`, import.meta.url)), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText
    return `modules['./${name}'] = {}; ((exports, require) => { ${code} })(modules['./${name}'], id => modules[id]);`
  }).join('\n')
  const checks = readFileSync(new URL('./equalizer-browser-checks.js', import.meta.url), 'utf8')
  const page = join(directory, 'test.html')
  writeFileSync(page, `<!doctype html><body><script>const modules = {};\n${modules}\n${checks}</script>`)

  // CDP awaitPromise 等待实际渲染完成，不用虚拟时钟跳过 OfflineAudioContext。
  const profile = join(directory, 'profile')
  const child = spawn(chrome, ['--headless', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', pathToFileURL(page).href], { stdio: 'ignore', windowsHide: true })
  let exited = false
  const closed = new Promise(resolve => child.once('close', () => { exited = true; resolve() }))
  const waitForExit = async milliseconds => {
    let timer
    try {
      await Promise.race([closed, new Promise(resolve => { timer = setTimeout(resolve, milliseconds) })])
    } finally { clearTimeout(timer) }
  }
  let launchError
  child.on('error', error => { launchError = error })
  let socket
  try {
    const portFile = join(profile, 'DevToolsActivePort')
    for (let i = 0; !existsSync(portFile) && i < 100; i++) {
      if (launchError) throw launchError
      if (child.exitCode !== null) throw new Error(`浏览器提前退出：${child.exitCode}`)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!existsSync(portFile)) throw new Error('浏览器启动超时，请检查 CHROME_BIN。')
    const port = readFileSync(portFile, 'utf8').split('\n')[0]
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(10000) })).json()
    const target = pages.find(p => p.url === pathToFileURL(page).href)
    if (!target) throw new Error('未找到音频测试页面。')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('浏览器调试连接超时')), 10000)
      socket.onopen = () => { clearTimeout(timeout); resolve() }
      socket.onerror = error => { clearTimeout(timeout); reject(error) }
    })
    let id = 0
    const evaluate = expression => new Promise((resolve, reject) => {
      const request = ++id
      const timeout = setTimeout(() => {
        socket.removeEventListener('message', listener)
        reject(new Error('浏览器音频测试超时'))
      }, 60000)
      const listener = event => {
        const result = JSON.parse(event.data)
        if (result.id !== request) return
        socket.removeEventListener('message', listener)
        clearTimeout(timeout)
        if (result.error || result.result?.exceptionDetails) reject(new Error(JSON.stringify(result)))
        else resolve(result.result.result.value)
      }
      socket.addEventListener('message', listener)
      socket.send(JSON.stringify({ id: request, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    })
    for (let i = 0; i < 100; i++) {
      if (await evaluate('typeof window.testResult !== "undefined"')) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    const report = await evaluate('window.testResult')
    if (!report) throw new Error('音频测试未返回结果。')
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.passed) process.exitCode = 1
  } finally {
    // 先让浏览器自行结束后台任务及 profile 写入。直接杀主进程可能留下
    // 仍在写目录的子进程，Linux CI 会在删除临时目录时触发 ENOTEMPTY。
    if (!exited && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ id: 0, method: 'Browser.close' }))
      await waitForExit(10000)
    }
    if (!exited && !launchError) {
      child.kill('SIGTERM')
      await waitForExit(5000)
      if (!exited) {
        child.kill('SIGKILL')
        await waitForExit(5000)
      }
      if (!exited) throw new Error('测试浏览器未能退出。')
    }
    socket?.close()
  }
} finally {
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
