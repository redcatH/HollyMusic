import { describe, expect, it } from 'vitest'
import { normalizeStructuredLyricText } from './lyric-normalize'

describe('normalizeStructuredLyricText', () => {
  it('将音源序列化的无时间轴结构化歌词还原为纯文本', () => {
    const normalized = normalizeStructuredLyricText(JSON.stringify([
      {
        lang: 'zh',
        synced: false,
        line: [
          { text: '[!text]你是我永远的痛' },
          { text: '深藏在心底的秘密' },
        ],
      },
    ]))

    expect(normalized).toBe('你是我永远的痛\n深藏在心底的秘密')
  })

  it('保留结构化歌词的毫秒时间轴并转换为 LRC', () => {
    const normalized = normalizeStructuredLyricText(JSON.stringify([
      {
        kind: 'main',
        synced: true,
        line: [{ start: 62_340, value: '带时间轴的一行' }],
      },
    ]))

    expect(normalized).toBe('[01:02.340]带时间轴的一行')
  })

  it('不改变普通歌词', () => {
    expect(normalizeStructuredLyricText('[00:01.00]普通歌词')).toBe('[00:01.00]普通歌词')
  })

  it('移除仅供 LX 前端识别的纯文本标记', () => {
    expect(normalizeStructuredLyricText('[!text]普通歌词')).toBe('普通歌词')
  })
})
