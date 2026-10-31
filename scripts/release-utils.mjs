import assert from 'node:assert/strict'

// Docker 标签不允许 '+'；发布版本限制为可同时用于 Git、文件名和镜像的 SemVer。
export function parseTag(tag) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(tag)
  assert.ok(match && tag.length <= 128, `无效发布 tag：${tag}`)
  const pre = match[4]?.split('.') ?? []
  assert.ok(pre.every(part => !/^0\d+$/.test(part)), '预发布数字标识不能带前导零')
  return { version: tag.slice(1), core: match.slice(1, 4).map(BigInt), pre }
}

export function compareTags(left, right) {
  const a = parseTag(left), b = parseTag(right)
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1
  }
  if (!a.pre.length || !b.pre.length) return Math.sign(b.pre.length) - Math.sign(a.pre.length)
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === undefined) return -1
    if (b.pre[i] === undefined) return 1
    if (a.pre[i] === b.pre[i]) continue
    const an = /^\d+$/.test(a.pre[i]), bn = /^\d+$/.test(b.pre[i])
    if (an && bn) return BigInt(a.pre[i]) > BigInt(b.pre[i]) ? 1 : -1
    if (an !== bn) return an ? -1 : 1
    return a.pre[i] > b.pre[i] ? 1 : -1
  }
  return 0
}

export function changelogSection(changelog, tag) {
  parseTag(tag)
  const sections = changelog.match(/^## .*(?:\r?\n(?!## ).*)*/gm) ?? []
  return sections.find(section => new RegExp(`^## \\[?${tag.replaceAll('.', '\\.')}\\]?(?:[（ \\n])`).test(section))?.trim()
}

export function validateMetadata(tag, root, frontend, notes, changelog) {
  const { version, pre } = parseTag(tag)
  assert.equal(root.version, version, '根 package.json 与 tag 不一致')
  assert.equal(frontend.version, version, 'frontend/package.json 与 tag 不一致')
  assert.ok(notes.trim().length > 30, '发布说明为空或过短')
  assert.ok(notes.trim().startsWith(`## ${tag}（`), '发布说明标题与 tag 不一致')
  if (!pre.length) assert.equal(changelogSection(changelog, tag), notes.trim(), 'CHANGELOG 与发布说明不一致')
}

export function latestCiRun(runs, sha) {
  return runs.filter(run => run.head_sha === sha && run.event === 'push' && run.head_branch === 'main' && run.path === '.github/workflows/ci.yml')
    .sort((a, b) => b.id - a.id)[0]
}

export function validatePlatforms(manifest) {
  assert.deepEqual(manifest.manifests?.map(item => `${item.platform.os}/${item.platform.architecture}`).sort(), ['linux/amd64', 'linux/arm64'], '镜像必须恰好包含 amd64 和 arm64')
  for (const item of manifest.manifests) assert.match(item.digest, /^sha256:[0-9a-f]{64}$/)
}
