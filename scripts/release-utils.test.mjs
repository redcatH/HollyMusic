import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTag, compareTags, changelogSection, validateMetadata, latestCiRun, validatePlatforms } from './release-utils.mjs'

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
