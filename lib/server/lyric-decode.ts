/**
 * 歌词 HTML 实体解码。
 *
 * 背景：部分音源接口返回的歌词被 HTML 实体编码（如 &#x660E; → 明、
 * &#26126; → 明、&amp; → &），前端原样展示为乱码。
 *
 * 策略：先做实体特征检测，命中才调用 he.decode——未编码的正常歌词
 * 零开销原样返回（孤立 & 与 LRC 时间/元数据标签不受影响），同时避免
 * he 非严格模式把无分号旧式序列（如 "&copy."）误解码。
 *
 * 仅限服务端使用：不放 lib/utils/lrc.ts（该文件被客户端 useLyrics
 * 引用，避免把 he 打进前端 bundle）。
 */

import he from 'he'

/** 规范实体特征：&#123; / &#x660E; / &name; */
const ENTITY_PATTERN = /[&](#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*;)/

export function decodeLyricEntities(text: string): string {
  if (!text || !ENTITY_PATTERN.test(text)) return text
  return he.decode(text)
}
