/** 音频磁盘缓存旁的歌词边车文件工具。 */

import path from 'path'

/** `song.mp3` → `song.lrc`，与音频处于同一目录。 */
export function getLyricSidecarPath(audioFilePath: string): string {
  const parsed = path.parse(audioFilePath)
  return path.join(parsed.dir, `${parsed.name}.lrc`)
}

/** `song.mp3` → `song.tlyric.lrc`，存储可选翻译歌词。 */
export function getTranslationLyricSidecarPath(audioFilePath: string): string {
  const parsed = path.parse(audioFilePath)
  return path.join(parsed.dir, `${parsed.name}.tlyric.lrc`)
}

/** 供孤儿扫描跳过仍由音频缓存记录关联的歌词边车文件。 */
export function isLyricSidecarPath(filePath: string): boolean {
  return filePath.endsWith('.lrc')
}
