import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSourceScriptFile } from './source-script-file'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'holly-script-boundary-'))
  await fs.mkdir(path.join(root, 'custom-sources'))
  vi.spyOn(process, 'cwd').mockReturnValue(root)
})
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }) })
describe('运行时脚本读取边界', () => {
  it('保留脚本内容及 BOM，不修改已经测试的字节', async () => {
    const file = path.join(root, 'custom-sources', 'fixture.js')
    await fs.writeFile(file, '\ufeff// trusted fixture')
    expect(await readSourceScriptFile(file)).toBe('\ufeff// trusted fixture')
  })
  it('不能读取音源目录之外的文件', async () => {
    const file = path.join(root, 'private.js'); await fs.writeFile(file, '// private fixture')
    await expect(readSourceScriptFile(file)).rejects.toThrow('custom-sources')
  })
  it('在分配文件内容前拒绝超过上限的脚本', async () => {
    const file = path.join(root, 'custom-sources', 'large.js')
    const handle = await fs.open(file, 'w'); await handle.truncate(5 * 1024 * 1024 + 1); await handle.close()
    await expect(readSourceScriptFile(file)).rejects.toThrow('5MB')
  })
})
