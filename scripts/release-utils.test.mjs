import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTag, compareTags, changelogSection, validateMetadata, latestCiRun, validatePlatforms, pushReleaseIndex } from './release-utils.mjs'

test('reject unsafe, ambiguous and non-semver release inputs', () => {
  for (const tag of ['v01.2.3', 'v1.2', 'v1.2.3+build', 'v1.2.3-beta.01', '../v1.2.3', 'v1.2.3\nx=y', '$(whoami)', '--help']) assert.throws(() => parseTag(tag))
  assert.equal(parseTag('v1.2.3-rc.10').version, '1.2.3-rc.10')
})
test('channel ordering never treats lexical or preview ordering as numeric ordering', () => {
  const sorted = ['v0.9.0', 'v0.10.0-beta.2', 'v0.10.0-beta.10', 'v0.10.0-rc.1', 'v0.10.0', 'v1.0.0']
  for (let i = 1; i < sorted.length; i++) {
    assert.equal(compareTags(sorted[i], sorted[i - 1]), 1)
    assert.equal(compareTags(sorted[i - 1], sorted[i]), -1)
  }
  assert.equal(compareTags('v1.0.0', 'v1.0.0'), 0)
})
test('release metadata must agree before publishing, preserving manual history', () => {
  const notes = '## v1.2.3（2026-10-31）\n\n### 修复\n\n- 修复发布流程与版本一致性。'
  const old = '## [v1.2.2] - 2026-10-30\n\n手工升级指导不能丢失。'
  const changelog = `# 更新日志\n\n${notes}\n\n${old}\n`
  assert.equal(changelogSection(changelog, 'v1.2.2'), old)
  validateMetadata('v1.2.3', { version: '1.2.3' }, { version: '1.2.3' }, notes, changelog)
  assert.throws(() => validateMetadata('v1.2.3', { version: '1.2.2' }, { version: '1.2.3' }, notes, changelog))
  assert.throws(() => validateMetadata('v1.2.3', { version: '1.2.3' }, { version: '1.2.3' }, `${notes}changed`, changelog))
})
test('a PR check or an older successful run cannot substitute for latest main CI', () => {
  const run = { id: 1, path: '.github/workflows/ci.yml', head_sha: 'abc', head_branch: 'main', event: 'push', conclusion: 'success' }
  const failed = { ...run, id: 2, conclusion: 'failure' }
  assert.equal(latestCiRun([run, failed, { ...run, id: 3, event: 'pull_request' }, { ...run, id: 4, head_sha: 'other' }], 'abc'), failed)
  assert.equal(latestCiRun([run], 'unknown'), undefined)
})
test('single architecture, duplicate architectures and invalid digests block release', () => {
  const item = architecture => ({ platform: { os: 'linux', architecture }, digest: `sha256:${'a'.repeat(64)}` })
  validatePlatforms({ manifests: [item('arm64'), item('amd64')] })
  assert.throws(() => validatePlatforms({ manifests: [item('amd64')] }))
  assert.throws(() => validatePlatforms({ manifests: [item('amd64'), item('amd64')] }))
  assert.throws(() => validatePlatforms({ manifests: [item('arm64'), { ...item('amd64'), digest: 'latest' }] }))
})

const dockerManifest = {
  mediaType: 'application/vnd.docker.distribution.manifest.list.v2+json',
  manifests: ['amd64', 'arm64'].map(architecture => ({
    mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
    platform: { os: 'linux', architecture }, digest: `sha256:${'a'.repeat(64)}`, size: 4081,
  })),
}
const revision = 'a'.repeat(40)
const credentials = { username: 'maintainer', token: 'test-token' }

test('Docker schema2 sources publish an annotated OCI index without changing verified descriptors', async () => {
  const requests = []
  await pushReleaseIndex('owner/music', 'v1.2.3', revision, dockerManifest, credentials, async (url, options) => {
    requests.push({ url, options })
    return requests.length === 1 ? Response.json({ token: 'registry-token' }) : new Response(null, { status: 201 })
  })
  assert.match(requests[0].url, /scope=repository:owner\/music:pull,push$/)
  const { url, options } = requests[1]
  assert.equal(url, 'https://ghcr.io/v2/owner/music/manifests/v1.2.3')
  assert.equal(options.method, 'PUT')
  assert.equal(options.headers['Content-Type'], 'application/vnd.oci.image.index.v1+json')
  assert.equal(options.headers.Authorization, 'Bearer registry-token')
  const index = JSON.parse(options.body)
  assert.deepEqual(index.manifests, dockerManifest.manifests)
  assert.equal(index.annotations['org.opencontainers.image.version'], 'v1.2.3')
  assert.equal(index.annotations['org.opencontainers.image.revision'], revision)
  assert.equal(index.mediaType, options.headers['Content-Type'])
})

test('invalid platforms and registry failures stop publication', async () => {
  let calls = 0
  const unauthorized = async () => { calls++; return new Response(null, { status: 401 }) }
  await assert.rejects(pushReleaseIndex('owner/music', 'v1.2.3', revision, { manifests: [] }, credentials, unauthorized))
  assert.equal(calls, 0)
  await assert.rejects(pushReleaseIndex('owner/music', 'v1.2.3', revision, dockerManifest, credentials, unauthorized), /HTTP 401/)
  assert.equal(calls, 1)
  const failedPush = async () => ++calls === 2 ? Response.json({ token: 'registry-token' }) : new Response(null, { status: 403 })
  await assert.rejects(pushReleaseIndex('owner/music', 'v1.2.3', revision, dockerManifest, credentials, failedPush), /HTTP 403/)
})
