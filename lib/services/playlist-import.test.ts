import { describe, expect, it } from 'vitest'
import { createFallbackMusicInfo, mergeImportedSong, parseNeteaseCsv, parseQqPlaylistInput } from './playlist-import'

describe('网易云 CSV 歌单导入', () => {
  it('解析 QQ 公开歌单链接和数字 ID', () => {
    expect(parseQqPlaylistInput('https://y.qq.com/n/ryqq_v2/playlist/3043596225')).toBe('3043596225')
    expect(parseQqPlaylistInput('3043596225')).toBe('3043596225')
    expect(() => parseQqPlaylistInput('https://example.com/playlist/3043596225')).toThrow()
  })
  it('解析 QQ 公开歌单链接和数字 ID', () => {
    expect(parseQqPlaylistInput('https://y.qq.com/n/ryqq_v2/playlist/3043596225')).toBe('3043596225')
    expect(parseQqPlaylistInput('3043596225')).toBe('3043596225')
    expect(() => parseQqPlaylistInput('https://example.com/playlist/3043596225')).toThrow()
  })
  it('解析 UTF-8 BOM、带逗号的引号字段，并保持行顺序', () => {
    const parsed = parseNeteaseCsv('\uFEFF序号,歌名,歌手,专辑,歌曲ID,时长\n1,"嘿,姑娘",反光镜,释你,25843038,3:48\n2,晴天,周杰伦,叶惠美,186016,4:29')
    expect(parsed.rows).toEqual([
      expect.objectContaining({ index: 1, name: '嘿,姑娘', songId: '25843038', interval: '228' }),
      expect.objectContaining({ index: 2, name: '晴天', songId: '186016' }),
    ])
    expect(parsed.duplicateCount).toBe(0)
  })

  it('按网易云歌曲 ID 去重，并生成可播放的 wy UID 所需元数据', () => {
    const parsed = parseNeteaseCsv('歌名,歌手,专辑,歌曲ID\n晴天,周杰伦,叶惠美,186016\n晴天,周杰伦,叶惠美,186016')
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.duplicateCount).toBe(1)
    const song = createFallbackMusicInfo(parsed.rows[0])
    expect(song.songmid).toBe('186016')
    expect(song.types).toEqual([{ type: '128k', size: '' }])
    expect(song._types['128k']).toBeDefined()
  })

  it('网易详情带音质时优先使用真实音质和封面', () => {
    const row = parseNeteaseCsv('歌名,歌手,歌曲ID\n晴天,周杰伦,186016').rows[0]
    const song = mergeImportedSong(row, {
      source: 'wy', songmid: '186016', name: '晴天', singer: '周杰伦', albumName: '叶惠美', interval: '4:29',
      types: [{ type: '320k', size: '8M' }], _types: { '320k': { size: '8M' } }, typeUrl: {}, img: 'https://example.com/cover.jpg',
    })
    expect(song.importQualityFallback).toBeUndefined()
    expect(song.types).toEqual([{ type: '320k', size: '8M' }])
    expect(song.img).toBe('https://example.com/cover.jpg')
  })
})



