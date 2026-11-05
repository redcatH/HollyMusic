import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runSourceTestJob } from './source-test-runner'
import type { MusicInfo } from '@/lib/types/music'

const network = vi.hoisted(() => vi.fn())
vi.mock('@/lib/source-testing/network.cjs', () => ({ publicRequest: network }))

const content = `const {on,send,EVENT_NAMES}=lx;
on(EVENT_NAMES.request,({info})=>'https://example.com/'+info.type+'/'+info.musicInfo.songmid+'/'+typeof require+'/'+typeof process);
send(EVENT_NAMES.inited,{sources:{kw:{type:'music',actions:['musicUrl'],qualitys:['flac','320k']}}});`
const song = { songmid: 'fixture-id' } as MusicInfo

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { vi.unstubAllEnvs() })

describe('本地独立测试进程', () => {
  it('直接启动 Node + VM，初始化不需要额外服务配置', async () => {
    const result = await runSourceTestJob<{ info: unknown }>({ action: 'inspect', content })
    expect(result.info).toMatchObject({ sources: { kw: { qualitys: ['flac', '320k'] } } })
  })
  it('锁定音质和歌曲，脚本不能访问 require/process；播放器 inline 设置不影响测试', async () => {
    vi.stubEnv('SOURCE_RUNNER_MODE', 'inline')
    const result = await runSourceTestJob<{ url: string }>({ action: 'resolve', content, platform: 'kw', quality: 'flac', song })
    expect(result.url).toBe('https://example.com/flac/fixture-id/undefined/undefined')
  })
  it('脚本的 HTTP 请求经过父进程受控转发，响应在 VM 内可用', async () => {
    network.mockResolvedValue({ status: 200, headers: { 'content-type': 'application/json' }, data: Buffer.from('{"ok":true}') })
    const script = content.replace("'https://example.com/'+info.type+'/'+info.musicInfo.songmid+'/'+typeof require+'/'+typeof process", `new Promise((resolve,reject)=>lx.request('https://public.example/api',{method:'POST',form:{id:info.musicInfo.songmid}},(error,response,body)=>error?reject(error):resolve('https://example.com/'+response.statusCode+'/'+body.ok)))`)
    expect(await runSourceTestJob({ action: 'resolve', content: script, platform: 'kw', quality: 'flac', song })).toEqual({ url: 'https://example.com/200/true' })
    expect(network).toHaveBeenCalledWith('https://public.example/api', expect.objectContaining({ method: 'POST', body: 'id=fixture-id' }))
  })
  it('内网访问设置不会从正式播放器继承到测试进程', async () => {
    vi.stubEnv('SOURCE_ALLOW_PRIVATE_NET', 'true')
    const script = content.replace("'https://example.com/'+info.type+'/'+info.musicInfo.songmid+'/'+typeof require+'/'+typeof process", `new Promise(resolve=>lx.request('http://127.0.0.1/private',{},error=>resolve('https://example.com/'+Boolean(error))))`)
    expect(await runSourceTestJob({ action: 'resolve', content: script, platform: 'kw', quality: 'flac', song })).toEqual({ url: 'https://example.com/true' })
    expect(network).not.toHaveBeenCalled()
  })
  it('同步死循环超时后终止实际子进程，随后仍能启动新任务', async () => {
    await expect(runSourceTestJob({ action: 'inspect', content: 'while(true){}' }, undefined, 200)).rejects.toThrow('超时')
    expect(await runSourceTestJob({ action: 'inspect', content })).toHaveProperty('info')
  })
  it('取消挂起调用后回收进程，随后任务正常', async () => {
    const controller = new AbortController()
    const pending = runSourceTestJob({ action: 'resolve', content: content.replace("'https://example.com/'+info.type+'/'+info.musicInfo.songmid+'/'+typeof require+'/'+typeof process", 'new Promise(()=>{})'), platform: 'kw', quality: 'flac', song }, controller.signal)
    const timer = setTimeout(() => controller.abort(), 200)
    try { await expect(pending).rejects.toThrow('取消') } finally { clearTimeout(timer) }
    expect(await runSourceTestJob({ action: 'inspect', content })).toHaveProperty('info')
  })
  it('已取消的任务不执行', async () => {
    await expect(runSourceTestJob({ action: 'inspect', content }, AbortSignal.abort())).rejects.toThrow('取消')
  })
  it('聚合脚本超过四个并发请求时排队，不误判为脚本失败', async () => {
    const pending: Array<() => void> = []
    network.mockImplementation(() => new Promise(resolve => pending.push(() => resolve({ status: 200, headers: {}, data: Buffer.from('{}') }))))
    const script = content.replace("'https://example.com/'+info.type+'/'+info.musicInfo.songmid+'/'+typeof require+'/'+typeof process", `new Promise(resolve=>{ let done=0; for(let i=0;i<5;i++) lx.request('https://public.example/api',{},()=>{if(++done===5)resolve('https://example.com/ok')}) })`)
    const result = runSourceTestJob({ action: 'resolve', content: script, platform: 'kw', quality: 'flac', song })
    for (let i = 0; network.mock.calls.length < 4 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10))
    expect(network).toHaveBeenCalledTimes(4)
    pending[0]()
    for (let i = 0; network.mock.calls.length < 5 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10))
    expect(network).toHaveBeenCalledTimes(5)
    for (const finish of pending.slice(1)) finish()
    await expect(result).resolves.toEqual({ url: 'https://example.com/ok' })
  })
  it('请求总数超限时终止进程，正在等待的网络请求也取消', async () => {
    const signals: AbortSignal[] = []
    network.mockImplementation((_url, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      signals.push(options.signal)
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const script = content.replace("'https://example.com/'+info.type+'/'+info.musicInfo.songmid+'/'+typeof require+'/'+typeof process", `new Promise(()=>{ for(let i=0;i<31;i++) lx.request('https://public.example/api',{},()=>{}) })`)
    await expect(runSourceTestJob({ action: 'resolve', content: script, platform: 'kw', quality: 'flac', song })).rejects.toThrow('请求次数超过限制')
    expect(signals).toHaveLength(4)
    expect(signals.every(signal => signal.aborted)).toBe(true)
  })
})
