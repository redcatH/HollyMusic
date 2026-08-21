import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchNativeLyric, parseKuwoLyricsPayload } from './music-lyric'
import type { MusicInfo } from '@/lib/types/music'

const baseMusicInfo: Omit<MusicInfo, 'source' | 'songmid'> = {
  name: '测试歌曲',
  singer: '测试歌手',
  interval: '03:00',
  types: [],
  _types: {},
  typeUrl: {},
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseKuwoLyricsPayload', () => {
  it('将酷我按歌曲 ID 返回的歌词转换为带毫秒时间轴的 LRC', () => {
    expect(parseKuwoLyricsPayload({
      data: {
        lrclist: [
          { time: '0.0', lineLyric: '歌曲信息' },
          { time: '12.628', lineLyric: '第一句歌词' },
        ],
      },
    })).toBe('[00:00.000]歌曲信息\n[00:12.628]第一句歌词')
  })

  it('在响应无有效歌词行时返回 null', () => {
    expect(parseKuwoLyricsPayload({ data: { lrclist: [] } })).toBeNull()
  })
})

describe('fetchNativeLyric', () => {
  it('解析 QQ 音乐 Base64 的原文与翻译，并保持 LRC 时间轴', async () => {
    const lyric = '[00:01.000]原文'
    const translation = '[00:01.000]翻译'
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      lyric: Buffer.from(lyric).toString('base64'),
      trans: Buffer.from(translation).toString('base64'),
    })))
    vi.stubGlobal('fetch', fetch)

    await expect(fetchNativeLyric({ ...baseMusicInfo, source: 'tx', songmid: '001test' })).resolves.toEqual({
      lyric,
      tlyric: translation,
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('使用咪咕歌曲随搜索结果保存的 lrcUrl，不按歌名重新搜索', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('[00:02.000]精确歌词'))
    vi.stubGlobal('fetch', fetch)

    await expect(fetchNativeLyric({
      ...baseMusicInfo,
      source: 'mg',
      songmid: '123',
      lrcUrl: 'https://lyrics.example.test/exact.lrc',
    })).resolves.toEqual({ lyric: '[00:02.000]精确歌词', tlyric: null })
    expect(fetch.mock.calls[0][0]).toBe('https://lyrics.example.test/exact.lrc')
  })

  it('酷狗候选不匹配歌曲与歌手时不下载第一条搜索结果', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ id: 'wrong', accesskey: 'wrong', song: '另一首歌', singer: '另一位歌手' }],
    })))
    vi.stubGlobal('fetch', fetch)

    await expect(fetchNativeLyric({
      ...baseMusicInfo,
      source: 'kg',
      songmid: '123',
      hash: 'song-hash',
    })).resolves.toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
