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
  return fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(10_000) })
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
  docker('restart', id)
  await waitForReady()
  const restarted = (await (await request('/api/auth/me', { headers: { Cookie: cookie } })).json()).data
  assert.equal(restarted.authenticated, true)
  assert.equal(restarted.setupRequired, false)
  assert.equal((await request('/api/setup', options)).status, 409)
  process.stdout.write('Docker setup smoke passed: SPA, health, anonymous API gate, concurrent setup, session, restart, closed setup.\n')
} finally {
  try { docker('rm', '-f', id) } catch { /* 可能尚未成功创建容器 */ }
  try { docker('volume', 'rm', volume) } catch { /* 保留清理异常供 CI 环境统一回收 */ }
}
