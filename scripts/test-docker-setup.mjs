import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

// CI 使用实际镜像验证 nginx SPA、Next proxy、迁移、首次设置与容器重启。
const image = process.argv[2] || 'hollymusic:setup-test'
const id = `holly-setup-${randomBytes(5).toString('hex')}`
const volume = `${id}-data`
const password = randomBytes(18).toString('base64url')
let baseUrl
function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }).trim()
}
async function request(path, options) {
  // AbortSignal.timeout 的计时器不会保持事件循环；Node 20 在容器刚启动、
  // fetch 尚无活动 socket 时可能提前以 13 退出。显式计时器确保超时可靠触发。
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('Request timed out')), 10_000)
  try {
    return await fetch(`${baseUrl}${path}`, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}
async function waitForReady() {
  for (let i = 0; i < 90; i++) {
    try { if ((await request('/api/auth/me')).ok) return } catch { /* 容器仍在启动 */ }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error('Container did not become ready')
}
try {
  docker('volume', 'create', volume)
  docker('run', '-d', '--name', id, '-p', '127.0.0.1::3000',
    '-e', `AUTH_SECRET=${randomBytes(32).toString('hex')}`, '-e', 'REQUIRE_AUTH=false',
    '-e', 'DATABASE_URL=file:./prisma/data/music.db',
    '--mount', `type=volume,src=${volume},dst=/app/prisma/prisma/data`, image)
  baseUrl = `http://${docker('port', id, '3000/tcp')}`
  await waitForReady()
  process.stdout.write('Docker ready; checking first-run setup.\n')
  assert.equal((await request('/api/health')).status, 200)
  assert.equal((await request('/setup')).status, 200)
  assert.equal((await (await request('/api/auth/me')).json()).data.setupRequired, true)
  assert.equal((await request('/rest/createPlaylist.view?u=intruder&name=bad')).status, 428)
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: baseUrl }, body: JSON.stringify({ password, confirmPassword: password }) }
  const results = await Promise.all([request('/api/setup', options), request('/api/setup', options)])
  assert.deepEqual(results.map(response => response.status).sort(), [201, 409])
  const successful = results.find(response => response.status === 201)
  const cookie = successful.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const me = (await (await request('/api/auth/me', { headers: { Cookie: cookie } })).json()).data
  assert.equal(me.authenticated, true)
  assert.equal(me.username, 'admin')
  assert.equal(me.mustChangePassword, false)
  assert.equal(me.setupRequired, false)
  assert.ok(!docker('logs', id).includes(password), 'Password must not appear in logs')
  // Exercise the packaged native runner through the real upload API, without importing a source.
  const form = new FormData()
  form.append('file', new Blob([`const {on,send,EVENT_NAMES}=lx;
on(EVENT_NAMES.request,()=> 'https://example.com/test.flac');
send(EVENT_NAMES.inited,{sources:{kw:{type:'music',actions:['musicUrl'],qualitys:['flac']}}});`]), 'smoke.js')
  const uploaded = await request('/api/admin/sources/upload', {
    method: 'POST', headers: { Cookie: cookie, Origin: baseUrl }, body: form,
  })
  const candidate = await uploaded.json()
  assert.equal(uploaded.status, 201, JSON.stringify(candidate))
  assert.equal(candidate.data.kind, 'upload')
  assert.deepEqual(candidate.data.capabilities.kw, ['flac'])
  const draftPath = `/api/admin/source-tests/${candidate.data.id}`
  // Dynamic parser imports and their transitive dependencies must also exist in standalone.
  const facts = JSON.parse(docker('exec', id, 'node', '-e', `
    const {spawn}=require('node:child_process');
    const wav=Buffer.alloc(44+8000*2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8);
    wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
    wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28);
    wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34);
    wav.write('data',36); wav.writeUInt32LE(wav.length-44,40);
    const child=spawn(process.execPath, ['--permission','--allow-fs-read=/app/lib',
      '--allow-fs-read=/app/node_modules','/app/lib/source-testing/child.cjs']);
    let output='',diagnostics='';
    const timer=setTimeout(()=>child.kill('SIGKILL'),30000);
    child.stdout.setEncoding('utf8').on('data',chunk=>output+=chunk);
    child.stderr.setEncoding('utf8').on('data',chunk=>diagnostics+=chunk);
    child.on('error',error=>{clearTimeout(timer); throw error});
    child.on('close',code=>{
      clearTimeout(timer);
      if(code!==0) throw new Error(diagnostics+' '+output);
      process.stdout.write(output);
    });
    child.stdin.write(JSON.stringify({action:'analyze',audio:wav.toString('base64')})+'\\n');
  `))
  assert.equal(facts.type, 'result')
  assert.equal(facts.value.bitsPerSample, 16)
  assert.equal(facts.value.sampleRate, 8000)
  assert.equal(facts.value.duration, 1)
  docker('restart', id)
  // Docker 重启可能重新分配随机宿主端口；会话 cookie 本身不绑定端口。
  baseUrl = `http://${docker('port', id, '3000/tcp')}`
  options.headers.Origin = baseUrl
  await waitForReady()
  process.stdout.write('Docker restarted; checking persisted session.\n')
  const restarted = (await (await request('/api/auth/me', { headers: { Cookie: cookie } })).json()).data
  assert.equal(restarted.authenticated, true)
  assert.equal(restarted.setupRequired, false)
  const savedDraft = await (await request(draftPath, { headers: { Cookie: cookie } })).json()
  assert.equal(savedDraft.data.status, 'ready')
  assert.equal((await request(draftPath, { method: 'DELETE', headers: { Cookie: cookie, Origin: baseUrl } })).status, 200)
  assert.equal((await request('/api/setup', options)).status, 409)
  process.stdout.write('Docker setup smoke passed: SPA, health, anonymous API gate, concurrent setup, session, native source testing, audio parser, persisted draft, restart, closed setup.\n')
} catch (error) {
  try { process.stderr.write(`Docker setup smoke failed; container logs:\n${docker('logs', id)}\n`) } catch { /* 容器可能尚未创建 */ }
  throw error
} finally {
  try { docker('rm', '-f', id) } catch { /* 可能尚未成功创建容器 */ }
  try { docker('volume', 'rm', volume) } catch { /* 保留清理异常供 CI 环境统一回收 */ }
}
