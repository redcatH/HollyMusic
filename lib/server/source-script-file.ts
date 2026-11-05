import fs from 'node:fs/promises'
import path from 'node:path'

/** Runtime scripts are mounted data, not build assets. Keep dynamic file reads behind this boundary. */
export async function readSourceScriptFile(filePath: string): Promise<string> {
  return (await readSourceScriptBytes(filePath)).toString('utf8')
}

/** 下载保留磁盘上的原始字节，包括 BOM。 */
export async function readSourceScriptBytes(filePath: string): Promise<Buffer> {
  const real = await fs.realpath(filePath)
  const root = path.resolve(process.cwd(), 'custom-sources') + path.sep
  if (!real.startsWith(root)) throw new Error('音源脚本必须位于 custom-sources 目录')
  const handle = await fs.open(real, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error('音源脚本必须为不超过 5MB 的文件')
    return await handle.readFile()
  } finally { await handle.close() }
}
