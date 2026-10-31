import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseTag, compareTags, changelogSection, validateMetadata, latestCiRun, validatePlatforms } from './release-utils.mjs'

const [command, tag] = process.argv.slice(2)
const { pre } = parseTag(tag)
const repo = process.env.GITHUB_REPOSITORY
assert.match(repo ?? '', /^[\w.-]+\/[\w.-]+$/)
const image = `ghcr.io/${repo.toLowerCase()}`
const run = (file, args) => execFileSync(file, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }).trim()
const git = (...args) => run('git', args)
const gh = (...args) => run('gh', args)
const api = endpoint => JSON.parse(gh('api', `repos/${repo}/${endpoint}`))
const docker = (...args) => run('docker', ['buildx', 'imagetools', ...args])
const output = values => {
  assert.ok(process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''))
}
function inspect(ref, allowMissing = false) {
  const result = spawnSync('docker', ['buildx', 'imagetools', 'inspect', '--raw', ref], { encoding: 'utf8', timeout: 120_000 })
  if (result.status === 0) return JSON.parse(result.stdout)
  // 网络、认证与限流错误不能被当成“不存在”，避免覆盖未知状态的标签。
  if (allowMissing && /manifest unknown|not found|name unknown/i.test(result.stderr ?? '') && !/unauthorized|denied|429|timeout/i.test(result.stderr ?? '')) return null
  throw new Error(`无法检查 ${ref}: ${result.error?.message ?? result.stderr}`)
}
function notesAtTag() {
  const path = `docs/releases/${tag}.md`
  const exists = spawnSync('git', ['cat-file', '-e', `${tag}:${path}`]).status === 0
  if (exists) return git('show', `${tag}:${path}`)
  assert.ok(process.env.RELEASE_MODE === 'recover' && compareTags(tag, 'v0.30.3') <= 0, 'tag 中缺少事先审阅的发布说明')
  const notes = changelogSection(readFileSync('CHANGELOG.md', 'utf8'), tag)
  assert.ok(notes, '该历史版本缺少可恢复的更新日志')
  return notes
}
function validateTag() {
  const sha = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`)
  if (process.env.EXPECTED_SHA) assert.equal(sha, process.env.EXPECTED_SHA, 'tag 在发布过程中发生移动')
  git('merge-base', '--is-ancestor', sha, 'origin/main')
  const notes = notesAtTag()
  if (process.env.RELEASE_MODE !== 'recover' || compareTags(tag, 'v0.30.3') > 0) {
    validateMetadata(tag, JSON.parse(git('show', `${tag}:package.json`)), JSON.parse(git('show', `${tag}:frontend/package.json`)), notes, git('show', `${tag}:CHANGELOG.md`))
  }
  return { sha, notes }
}
function validateImage(manifest, sha) {
  validatePlatforms(manifest)
  if (compareTags(tag, 'v0.30.3') > 0) {
    assert.equal(manifest.annotations?.['org.opencontainers.image.version'], tag, '镜像版本注解与 tag 不一致')
    assert.equal(manifest.annotations?.['org.opencontainers.image.revision'], sha, '镜像来源提交与 tag 不一致')
  }
}
async function waitForCi(sha) {
  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    const result = api(`actions/workflows/ci.yml/runs?event=push&branch=main&head_sha=${sha}&per_page=100`)
    const latest = latestCiRun(result.workflow_runs, sha)
    if (latest?.status === 'completed') {
      assert.equal(latest.conclusion, 'success', `目标提交最新 main CI 未通过：${latest.html_url}`)
      return
    }
    process.stdout.write(`等待 ${sha} 的 main CI 完成。\n`)
    await new Promise(resolve => setTimeout(resolve, 15_000))
  }
  throw new Error('等待 main CI 超时；请在其成功后重新运行发布任务')
}
async function preflight() {
  const { sha } = validateTag()
  if (process.env.RELEASE_MODE === 'recover') validateImage(inspect(`${image}:${tag}`), sha)
  else {
    await waitForCi(sha)
    assert.equal(inspect(`${image}:${tag}`, true), null, '版本镜像已存在；请用 workflow_dispatch 恢复 Release，禁止覆盖历史镜像')
  }
  output({ tag, sha })
}
function publish() {
  const { sha } = validateTag()
  assert.equal(inspect(`${image}:${tag}`, true), null, '版本镜像已存在，拒绝覆盖')
  assert.match(process.env.GITHUB_RUN_ID ?? '', /^\d+$/)
  const sources = ['amd64', 'arm64'].map(arch => `${image}:build-${process.env.GITHUB_RUN_ID}-${arch}`)
  const manifest = JSON.parse(docker('create', '--dry-run', ...sources))
  validatePlatforms(manifest)
  const digests = manifest.manifests.map(item => `${image}@${item.digest}`)
  docker('create', '--annotation', `index:org.opencontainers.image.version=${tag}`, '--annotation', `index:org.opencontainers.image.revision=${sha}`, '--tag', `${image}:${tag}`, ...digests)
  const published = inspect(`${image}:${tag}`)
  validateImage(published, sha)
  const channel = pre.length ? 'preview' : 'latest'
  const current = inspect(`${image}:${channel}`, true)
  let currentTag = current?.annotations?.['org.opencontainers.image.version']
  if (current && !currentTag) {
    // 旧镜像没有 OCI 版本注解：必须用清单内容确认它对应哪个已发布版本。
    const releases = api('releases?per_page=100').filter(item => !item.draft && item.prerelease === Boolean(pre.length))
    for (const release of releases) {
      if (JSON.stringify(inspect(`${image}:${release.tag_name}`, true)) === JSON.stringify(current)) {
        currentTag = release.tag_name
        break
      }
    }
    assert.ok(currentTag, '无法确认现有通道版本；版本镜像已保留，但拒绝盲目覆盖通道')
  }
  const promoted = !current || compareTags(tag, currentTag) > 0
  if (promoted) docker('create', '--tag', `${image}:${channel}`, `${image}:${tag}`)
  process.stdout.write(`${tag}: ${promoted ? `已更新 ${channel}` : `保留较新的 ${channel} (${currentTag})`}\n`)
  output({ promoted })
}
function release() {
  const { sha, notes } = validateTag()
  validateImage(inspect(`${image}:${tag}`), sha)
  const body = `🐳 **Docker 镜像**：\`${image}:${tag}\`\n\n${notes}\n`
  const file = join(process.env.RUNNER_TEMP, 'release-body.md')
  writeFileSync(file, body)
  const existing = spawnSync('gh', ['release', 'view', tag, '--repo', repo, '--json', 'tagName'], { encoding: 'utf8', timeout: 120_000 })
  const latest = !pre.length && process.env.RELEASE_MODE !== 'recover' && process.env.CHANNEL_PROMOTED === 'true'
  const args = ['release', existing.status === 0 ? 'edit' : 'create', tag, '--repo', repo, '--title', tag, '--notes-file', file]
  if (process.env.RELEASE_MODE !== 'recover' || existing.status !== 0) args.push(`--latest=${latest}`)
  if (existing.status !== 0) args.push('--verify-tag')
  if (pre.length) args.push('--prerelease')
  gh(...args)
}

if (command === 'preflight') await preflight()
else if (command === 'publish') publish()
else if (command === 'release') release()
else throw new Error(`未知命令：${command}`)
