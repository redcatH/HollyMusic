import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateMetadata } from './release-utils.mjs'

const root = JSON.parse(readFileSync('package.json', 'utf8'))
const frontend = JSON.parse(readFileSync('frontend/package.json', 'utf8'))
const tag = `v${root.version}`
validateMetadata(tag, root, frontend, readFileSync(`docs/releases/${tag}.md`, 'utf8'), readFileSync('CHANGELOG.md', 'utf8'))
assert.equal(root.packageManager, frontend.packageManager, '前后端 packageManager 必须一致')
for (const name of ['react', 'react-dom']) assert.equal(root.dependencies[name], frontend.dependencies[name], `${name} 版本必须一致`)
for (const name of ['@types/react', '@types/react-dom', 'vitest', 'vite']) assert.equal(root.devDependencies[name], frontend.devDependencies[name], `${name} 版本必须一致`)
assert.equal(root.dependencies.next, root.devDependencies['eslint-config-next'], 'Next 与 ESLint 配置必须同步')
const managerVersion = root.packageManager.match(/^pnpm@([\d.]+)/)[1]
const dockerfile = readFileSync('Dockerfile', 'utf8')
assert.ok(dockerfile.includes(`npm install -g pnpm@${managerVersion}`), 'Docker 中的 pnpm 版本必须匹配 packageManager')
const nodeVersion = readFileSync('.node-version', 'utf8').trim()
assert.equal(root.engines.node, `>=${nodeVersion} <${Number(nodeVersion) + 1}`)
assert.deepEqual(root.engines, frontend.engines)
assert.equal(root.engines.pnpm, managerVersion)
assert.ok([...dockerfile.matchAll(/^FROM node:(\d+)-/gm)].every(match => match[1] === nodeVersion), 'Docker Node 主版本必须一致')
process.stdout.write(`发布元数据与工具链一致：${tag}\n`)
