import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { parseTag, compareTags } from './release-utils.mjs'

const tag = `v${(process.argv[2] ?? '').replace(/^v/, '')}`
const { version, pre } = parseTag(tag)
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
assert.equal(git('status', '--porcelain'), '', '请先提交或暂存到其他工作区，发布准备要求干净工作区')
assert.equal(spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`]).status, 1, 'tag 已存在；禁止重写已发布版本')
const root = JSON.parse(readFileSync('package.json', 'utf8'))
const frontend = JSON.parse(readFileSync('frontend/package.json', 'utf8'))
assert.ok(compareTags(tag, `v${root.version}`) > 0, '版本必须递增')
const tags = git('tag', '--merged', 'HEAD').split('\n').filter(value => /^v\d+\.\d+\.\d+$/.test(value)).sort(compareTags)
const previous = tags.at(-1)
assert.ok(previous, '需要上一正式版 tag；请先 git fetch origin --tags')
assert.ok(compareTags(tag, previous) > 0, '版本必须高于已有正式版')
const cliff = process.env.GIT_CLIFF_BIN || 'git-cliff'
assert.match(execFileSync(cliff, ['--version'], { encoding: 'utf8' }), /\b2\.14\.2\b/, '请安装 git-cliff 2.14.2')
// 排除预发布的分段边界，但保留其提交；当前目标 tag 尚未存在。
const previews = git('tag', '--merged', 'HEAD').split('\n').filter(value => /^v\d+\.\d+\.\d+-/.test(value))
const ignored = previews.length ? `^(?:${previews.map(value => value.replaceAll('.', '\\.')).join('|')})$` : '^$'
const output = execFileSync(cliff, [`${previous}..HEAD`, '--config', 'cliff.toml', '--tag', tag, '--ignore-tags', ignored, '--strip', 'header'], { encoding: 'utf8' }).trim()
assert.ok(output.startsWith(`## ${tag}（`), 'git-cliff 未生成目标版本说明')
assert.equal((output.match(/^## /gm) ?? []).length, 1, '发布说明不应混入中间预发布分节')
const notesPath = `docs/releases/${tag}.md`
assert.ok(!existsSync(notesPath), '发布说明已存在')
const changelog = readFileSync('CHANGELOG.md', 'utf8')
const firstSection = changelog.search(/^## /m)
assert.ok(firstSection >= 0, 'CHANGELOG 缺少历史版本')
mkdirSync('docs/releases', { recursive: true })
writeFileSync(notesPath, `${output}\n`)
if (!pre.length) writeFileSync('CHANGELOG.md', `${changelog.slice(0, firstSection)}${output}\n\n${changelog.slice(firstSection)}`)
for (const [path, pkg] of [['package.json', root], ['frontend/package.json', frontend]]) {
  pkg.version = version
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`)
}
process.stdout.write(`已准备 ${tag}；请审阅 ${notesPath}，通过 PR 合并并等待 main 的 CI 成功后，再给该提交打 tag。\n`)
