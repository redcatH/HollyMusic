import { afterEach, describe, expect, it, vi } from 'vitest'
import { deflateSync } from 'zlib'
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

  it('酷我旧歌词接口无结果时，使用加密歌曲 ID 接口并还原普通 LRC', async () => {
    const plainLyric = '[00:01.000]<1,2>native lyric'
    const key = Buffer.from('yeelion')
    const encrypted = Buffer.from(plainLyric)
    for (let index = 0; index < encrypted.length; index++) encrypted[index] ^= key[index % key.length]
    const raw = Buffer.concat([
      Buffer.from('tp=content\r\n\r\n'),
      deflateSync(Buffer.from(encrypted.toString('base64'))),
    ])
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: null })))
      .mockResolvedValueOnce(new Response(raw))
    vi.stubGlobal('fetch', fetch)

    await expect(fetchNativeLyric({ ...baseMusicInfo, source: 'kw', songmid: '306518865' })).resolves.toEqual({
      lyric: '[00:01.000]native lyric',
      tlyric: null,
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(String(fetch.mock.calls[1][0])).toContain('newlyric.kuwo.cn/newlyric.lrc?')
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
