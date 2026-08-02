/**
 * lib/server/download-utils.ts 单元测试
 *
 * 目标：在重构下载路由前，锁定这些工具函数的现有行为，
 * 使后续 route.ts 改为依赖它们时有回归安全网。
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
  isValidUrl,
  extractDomain,
  isAllowedDomain,
  getAllowedDomainsFromEnv,
  isValidReferer,
  isValidOrigin,
  sanitizeFilename,
  extractFilenameFromHeader,
  inferExtension,
  getDownloadHeaders,
  buildUpstreamHeaders,
  buildContentDisposition,
  buildFilenameFromMusicInfo,
} from './download-utils'

// ---------------------------------------------------------------------------
// sanitizeFilename — 文件名清洗（最关键，filename 污染修复的核心）
// ---------------------------------------------------------------------------

describe('sanitizeFilename', () => {
  it('移除路径分隔符与危险字符', () => {
    expect(sanitizeFilename('a<b>c:"d/e\\f|g?h*i')).toBe('abcdefghi')
  })

  it('移除控制字符 \\x00-\\x1f', () => {
    // \x00 NULL, \x07 BEL, \x1f US
    expect(sanitizeFilename('song\x00name\x07title\x1f')).toBe('songnametitle')
  })

  it('移除连续两个点（防止路径穿越）', () => {
    // '..' 被移除后为空，走 !cleaned → 'download'
    expect(sanitizeFilename('..')).toBe('download')
    expect(sanitizeFilename('..hidden')).toBe('hidden')
  })

  it('空值或全非法字符回退为 download', () => {
    expect(sanitizeFilename('')).toBe('download')
    expect(sanitizeFilename('<>:"/\\|?*')).toBe('download')
  })

  it('折叠连续的点和空格', () => {
    expect(sanitizeFilename('a...b   c')).toBe('a.b c')
  })

  it('截断超长文件名（默认 200）', () => {
    const long = 'x'.repeat(250)
    const result = sanitizeFilename(long)
    expect(result.length).toBe(200)
  })

  it('尊重自定义 maxLength', () => {
    expect(sanitizeFilename('abcdefghij', 5)).toBe('abcde')
  })

  it('去掉尾部点与空格', () => {
    expect(sanitizeFilename('name.   ')).toBe('name')
    expect(sanitizeFilename('name . .')).toBe('name')
  })

  it('处理报错场景：<em> 万能青年旅店 < 残留 HTML', () => {
    // 上游返回的 name 被污染为 '<em>万能青年旅店<'
    // sanitizeFilename 只负责文件系统安全：移除 <>，留下字面量 'em'
    // HTML 标签语义级清洗应在客户端 buildFilename 完成（见 useDownload 测试）
    const result = sanitizeFilename('<em>万能青年旅店< - 杀死那个石家庄人（翻唱）.mp3')
    expect(result).toBe('em万能青年旅店 - 杀死那个石家庄人（翻唱）.mp3')
    expect(result).not.toContain('<')
    expect(result).not.toContain('>')
  })
})

// ---------------------------------------------------------------------------
// isAllowedDomain — 域名白名单
// ---------------------------------------------------------------------------

describe('isAllowedDomain', () => {
  it('通配符 * 允许所有', () => {
    expect(isAllowedDomain('evil.com', ['*'])).toBe(true)
    expect(isAllowedDomain('music.qq.com', ['*'])).toBe(true)
  })

  it('精确匹配', () => {
    expect(isAllowedDomain('music.qq.com', ['music.qq.com'])).toBe(true)
    expect(isAllowedDomain('api.qq.com', ['music.qq.com'])).toBe(false)
  })

  it('通配符前缀 *.example.com 匹配子域', () => {
    expect(isAllowedDomain('a.b.example.com', ['*.example.com'])).toBe(true)
    // 现实现用 endsWith('.example.com')，裸 'example.com' 不匹配（安全行为）
    expect(isAllowedDomain('example.com', ['*.example.com'])).toBe(false)
    expect(isAllowedDomain('notexample.com', ['*.example.com'])).toBe(false)
  })

  it('不匹配的域名被拒绝', () => {
    expect(isAllowedDomain('evil.com', ['music.qq.com', '*.qq.com'])).toBe(false)
  })

  it('空白名单拒绝所有（非 * 情况）', () => {
    expect(isAllowedDomain('music.qq.com', [])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getAllowedDomainsFromEnv — 环境变量解析
// ---------------------------------------------------------------------------

describe('getAllowedDomainsFromEnv', () => {
  const original = process.env['ALLOWED_DOWNLOAD_DOMAINS']

  afterEach(() => {
    if (original === undefined) delete process.env['ALLOWED_DOWNLOAD_DOMAINS']
    else process.env['ALLOWED_DOWNLOAD_DOMAINS'] = original
  })

  it('未设置时返回空数组', () => {
    delete process.env['ALLOWED_DOWNLOAD_DOMAINS']
    expect(getAllowedDomainsFromEnv()).toEqual([])
  })

  it('单个域名', () => {
    process.env['ALLOWED_DOWNLOAD_DOMAINS'] = 'music.qq.com'
    expect(getAllowedDomainsFromEnv()).toEqual(['music.qq.com'])
  })

  it('逗号分隔多个域名，自动 trim', () => {
    process.env['ALLOWED_DOWNLOAD_DOMAINS'] = ' music.qq.com , *.kw.cn ,  localhost '
    expect(getAllowedDomainsFromEnv()).toEqual(['music.qq.com', '*.kw.cn', 'localhost'])
  })

  it('过滤空字符串', () => {
    process.env['ALLOWED_DOWNLOAD_DOMAINS'] = ' , , , '
    expect(getAllowedDomainsFromEnv()).toEqual([])
  })

  it('支持自定义环境变量名', () => {
    process.env['CUSTOM_DL_DOMAINS'] = 'a.com,b.com'
    expect(getAllowedDomainsFromEnv('CUSTOM_DL_DOMAINS')).toEqual(['a.com', 'b.com'])
    delete process.env['CUSTOM_DL_DOMAINS']
  })
})

// ---------------------------------------------------------------------------
// isValidReferer / isValidOrigin — 请求来源校验
// ---------------------------------------------------------------------------

describe('isValidReferer', () => {
  it('null 返回 false', () => {
    expect(isValidReferer(null, ['https://holly.com'])).toBe(false)
  })

  it('无效 URL 返回 false', () => {
    expect(isValidReferer('not-a-url', ['https://holly.com'])).toBe(false)
  })

  it('hostname 匹配返回 true', () => {
    expect(isValidReferer('https://holly.com/search', ['https://holly.com'])).toBe(true)
    expect(isValidReferer('https://holly.com:3000/x', ['https://holly.com'])).toBe(true)
  })

  it('hostname 不匹配返回 false', () => {
    expect(isValidReferer('https://evil.com', ['https://holly.com'])).toBe(false)
  })
})

describe('isValidOrigin', () => {
  it('null 返回 false', () => {
    expect(isValidOrigin(null, ['https://holly.com'])).toBe(false)
  })

  it('精确匹配', () => {
    expect(isValidOrigin('https://holly.com', ['https://holly.com'])).toBe(true)
    expect(isValidOrigin('https://holly.com', ['https://api.holly.com'])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// URL 工具
// ---------------------------------------------------------------------------

describe('isValidUrl', () => {
  it('合法 URL', () => {
    expect(isValidUrl('https://music.qq.com/song.mp3')).toBe(true)
    expect(isValidUrl('http://localhost:3000/api')).toBe(true)
  })

  it('非法 URL', () => {
    expect(isValidUrl('not-a-url')).toBe(false)
    expect(isValidUrl('')).toBe(false)
  })
})

describe('extractDomain', () => {
  it('提取 hostname', () => {
    expect(extractDomain('https://music.qq.com/path')).toBe('music.qq.com')
    expect(extractDomain('http://localhost:3000')).toBe('localhost')
  })

  it('非法 URL 返回 null', () => {
    expect(extractDomain('not-a-url')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// extractFilenameFromHeader — Content-Disposition 解析
// ---------------------------------------------------------------------------

describe('extractFilenameFromHeader', () => {
  it('null 返回 fallback', () => {
    expect(extractFilenameFromHeader(null)).toBe('download.mp3')
    expect(extractFilenameFromHeader(null, 'fallback.mp3')).toBe('fallback.mp3')
  })

  it('解析 filename*=UTF-8\'\' 编码', () => {
    const encoded = encodeURIComponent('歌曲 - 歌手.mp3')
    expect(extractFilenameFromHeader(`attachment; filename*=UTF-8''${encoded}`)).toBe('歌曲 - 歌手.mp3')
  })

  it('解析 filename="..." 形式', () => {
    expect(extractFilenameFromHeader('attachment; filename="song.mp3"')).toBe('song.mp3')
  })

  it('解析 filename=... 无引号形式', () => {
    expect(extractFilenameFromHeader('attachment; filename=song.mp3')).toBe('song.mp3')
  })

  it('无法匹配时返回 fallback', () => {
    expect(extractFilenameFromHeader('attachment')).toBe('download.mp3')
  })
})

// ---------------------------------------------------------------------------
// inferExtension — 扩展名推断
// ---------------------------------------------------------------------------

describe('inferExtension', () => {
  it('从 Content-Type 推断', () => {
    expect(inferExtension('any', 'audio/mpeg')).toBe('.mp3')
    expect(inferExtension('any', 'audio/flac')).toBe('.flac')
    expect(inferExtension('any', 'audio/mp4')).toBe('.m4a')
    expect(inferExtension('any', 'audio/wav')).toBe('.wav')
  })

  it('Content-Type 带 charset 也能识别', () => {
    expect(inferExtension('any', 'audio/mpeg; charset=binary')).toBe('.mp3')
  })

  it('从 URL 路径推断', () => {
    expect(inferExtension('https://x.com/song.mp3', null)).toBe('.mp3')
    expect(inferExtension('https://x.com/song.flac?token=1', null)).toBe('.flac')
  })

  it('URL 带无效扩展名回退 .mp3', () => {
    expect(inferExtension('https://x.com/song.exe', null)).toBe('.mp3')
  })

  it('无信息时默认 .mp3', () => {
    expect(inferExtension('https://x.com/song', null)).toBe('.mp3')
  })
})

// ---------------------------------------------------------------------------
// getDownloadHeaders — 响应头生成
// ---------------------------------------------------------------------------

describe('getDownloadHeaders', () => {
  it('包含 Content-Type 与 Content-Disposition', () => {
    const h = getDownloadHeaders('song.mp3', 'audio/mpeg')
    expect(h['Content-Type']).toBe('audio/mpeg')
    expect(h['Content-Disposition']).toBe('attachment; filename="song.mp3"')
  })

  it('filename 经 sanitizeFilename 清洗', () => {
    const h = getDownloadHeaders('a<b>c.mp3', 'audio/mpeg')
    expect(h['Content-Disposition']).toBe('attachment; filename="abc.mp3"')
  })

  it('包含安全头 CSP 与 nosniff', () => {
    const h = getDownloadHeaders('x.mp3')
    expect(h['Content-Security-Policy']).toBe("default-src 'none'")
    expect(h['X-Content-Type-Options']).toBe('nosniff')
  })

  it('默认 Content-Type 为 octet-stream', () => {
    const h = getDownloadHeaders('x.mp3')
    expect(h['Content-Type']).toBe('application/octet-stream')
  })
})

// ---------------------------------------------------------------------------
// buildContentDisposition — RFC 6266 / 5987 编码
// ---------------------------------------------------------------------------

describe('buildContentDisposition', () => {
  it('纯 ASCII 文件名用 filename="..."', () => {
    expect(buildContentDisposition('song.mp3')).toBe('attachment; filename="song.mp3"')
  })

  it('含中文的文件名用 filename*=UTF-8\'\'<encoded> + ASCII fallback', () => {
    const result = buildContentDisposition('歌手 - 歌名.mp3')
    // ASCII fallback 用 'download'
    expect(result).toContain('filename="download"')
    // RFC 5987 编码：filename*=UTF-8''<percent-encoded>
    const expectedEncoded = encodeURIComponent('歌手 - 歌名.mp3')
    expect(result).toBe(`attachment; filename="download"; filename*=UTF-8''${expectedEncoded}`)
  })

  it('encode 后的字符串全 ASCII（不会触发 ByteString 错误）', () => {
    const result = buildContentDisposition('万能青年旅店 - 杀死那个石家庄人.mp3')
    // 整个字符串必须 ≤ \x7f
    expect(/^[\x00-\x7f]*$/.test(result)).toBe(true)
  })

  it('混 ASCII + 中文也走 UTF-8 编码分支', () => {
    const result = buildContentDisposition('A & B - 歌名.mp3')
    expect(result).toContain("filename*=UTF-8''")
    expect(result).toContain('filename="download"')
  })
})

// ---------------------------------------------------------------------------
// buildUpstreamHeaders — 构造回源请求头（User-Agent + Referer）
// ---------------------------------------------------------------------------

describe('buildUpstreamHeaders', () => {
  it('普通域名：Referer 使用主域名（最后两段）', () => {
    const h = buildUpstreamHeaders('https://musicapi.haitangw.net/music1/kw.php?type=mp3')
    expect(h['Referer']).toBe('https://haitangw.net')
    expect(h['User-Agent']).toMatch(/Mozilla/)
  })

  it('子域名：归一到主域名', () => {
    const h = buildUpstreamHeaders('https://a.b.example.com/song.mp3')
    expect(h['Referer']).toBe('https://example.com')
  })

  it('两段域名保持原样', () => {
    const h = buildUpstreamHeaders('https://qq.com/song.mp3')
    expect(h['Referer']).toBe('https://qq.com')
  })

  it('IPv4 地址保持原样', () => {
    const h = buildUpstreamHeaders('http://192.168.1.1:8080/song.mp3')
    expect(h['Referer']).toBe('http://192.168.1.1')
  })

  it('localhost 保持原样', () => {
    const h = buildUpstreamHeaders('http://localhost:3000/song.mp3')
    expect(h['Referer']).toBe('http://localhost')
  })

  it('http 协议保留 http', () => {
    const h = buildUpstreamHeaders('http://music.qq.com/song.mp3')
    expect(h['Referer']).toBe('http://qq.com')
  })
})

// ---------------------------------------------------------------------------
// buildFilenameFromMusicInfo — uid 模式后端组装文件名
// ---------------------------------------------------------------------------

describe('buildFilenameFromMusicInfo', () => {
  function makeInfo(name: string, singer: string = '歌手') {
    return {
      name, singer,
      source: 'kw' as const,
      songmid: '1',
      interval: '',
      types: [],
      _types: {} as Record<string, unknown>,
      typeUrl: {},
    }
  }

  it('正常名称原样拼接', () => {
    expect(buildFilenameFromMusicInfo(makeInfo('杀死那个石家庄人', '万能青年旅店')))
      .toBe('万能青年旅店 - 杀死那个石家庄人.mp3')
  })

  it('剥离 <em> 高亮标签（报错 URL 的场景）', () => {
    const mi = makeInfo('杀死那个石家庄人（翻唱）', '<em>万能青年旅店<')
    expect(buildFilenameFromMusicInfo(mi)).toBe('万能青年旅店 - 杀死那个石家庄人（翻唱）.mp3')
  })

  it('剥离 <b>/<strong>/<span> 等其他标签', () => {
    expect(buildFilenameFromMusicInfo(makeInfo('<b>歌名</b>', '<strong>歌手</strong>')))
      .toBe('歌手 - 歌名.mp3')
  })

  it('解码 HTML 实体 &amp; &quot; &#39;', () => {
    expect(buildFilenameFromMusicInfo(makeInfo('A &amp; B', '歌手'))).toBe('歌手 - A & B.mp3')
    expect(buildFilenameFromMusicInfo(makeInfo('A &quot;B&quot;', 'C&#39;s'))).toBe("C's - A \"B\".mp3")
  })

  it('空 singer 用 unknown 兜底', () => {
    expect(buildFilenameFromMusicInfo(makeInfo('歌名', ''))).toBe('unknown - 歌名.mp3')
  })

  it('空 name 用 audio 兜底', () => {
    expect(buildFilenameFromMusicInfo(makeInfo('', '歌手'))).toBe('歌手 - audio.mp3')
  })

  it('flac 音质 → .flac', () => {
    expect(buildFilenameFromMusicInfo(makeInfo('歌名', '歌手'), 'flac')).toBe('歌手 - 歌名.flac')
  })

  it('flac24bit 音质 → .flac', () => {
    expect(buildFilenameFromMusicInfo(makeInfo('歌名', '歌手'), 'flac24bit')).toBe('歌手 - 歌名.flac')
  })

  it('128k/320k 音质 → .mp3', () => {
    expect(buildFilenameFromMusicInfo(makeInfo('歌名', '歌手'), '128k')).toBe('歌手 - 歌名.mp3')
    expect(buildFilenameFromMusicInfo(makeInfo('歌名', '歌手'), '320k')).toBe('歌手 - 歌名.mp3')
  })

  it('默认音质 .mp3', () => {
    expect(buildFilenameFromMusicInfo(makeInfo('歌名', '歌手'))).toBe('歌手 - 歌名.mp3')
  })
})
