import { describe, it, expect } from 'vitest'
import {
  respond,
  subsonicError,
  renderSubsonicXml,
  buildSubsonicJsonBody,
  escapeXml,
  SUBSONIC_VERSION,
  SUBSONIC_XMLNS,
  type SubsonicPayload,
} from './subsonic'

const REQ_BASE = 'http://localhost/rest'

function req(query = ''): Request {
  return new Request(`${REQ_BASE}/ping.view${query}`)
}

describe('escapeXml', () => {
  it('转义五个特殊字符', () => {
    expect(escapeXml(`<a & "b" 'c'>`)).toBe('&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;')
  })
})

describe('renderSubsonicXml — 节点渲染规则', () => {
  it('标量 → 属性（数字/布尔字符串化）', () => {
    const xml = renderSubsonicXml({
      song: { id: 'wy-1', title: '测试', duration: 192, isDir: false },
    })
    expect(xml).toContain('<song id="wy-1" title="测试" duration="192" isDir="false"/>')
  })

  it('属性值自动转义', () => {
    const xml = renderSubsonicXml({ song: { id: 'a', title: 'A&B<C>"D"' } })
    expect(xml).toContain('title="A&amp;B&lt;C&gt;&quot;D&quot;"')
  })

  it('null/undefined 属性整体省略', () => {
    const xml = renderSubsonicXml({
      song: { id: 'a', title: 't', year: undefined, genre: null } as SubsonicPayload,
    })
    expect(xml).toContain('<song id="a" title="t"/>')
    expect(xml).not.toContain('year')
    expect(xml).not.toContain('genre')
  })

  it('嵌套对象 → 子元素，数组 → 同名重复子元素', () => {
    const xml = renderSubsonicXml({
      album: {
        id: 'al-1',
        song: [
          { id: 's1', title: 'a' },
          { id: 's2', title: 'b' },
        ],
      },
    })
    expect(xml).toContain('<album id="al-1"><song id="s1" title="a"/><song id="s2" title="b"/></album>')
  })

  it('标量数组 → 重复文本子元素（allowedUser/versions）', () => {
    const xml = renderSubsonicXml({
      playlist: { id: '1', allowedUser: ['alice', 'bob'] },
    })
    expect(xml).toContain('<playlist id="1"><allowedUser>alice</allowedUser><allowedUser>bob</allowedUser></playlist>')
  })

  it('_text → 元素文本内容（空串输出空标签对，与自闭合区分）', () => {
    const xml = renderSubsonicXml({
      lyrics: {
        artist: { _text: '' },
        title: { _text: '歌名' },
        line: [{ time: 0, _text: '无歌词' }],
      },
    })
    expect(xml).toContain('<lyrics><artist></artist><title>歌名</title><line time="0">无歌词</line></lyrics>')
  })

  it('_text 文本自动转义', () => {
    const xml = renderSubsonicXml({ line: { _text: 'a<b>&c' } })
    expect(xml).toContain('<line>a&lt;b&gt;&amp;c</line>')
  })

  it('空对象 → 自闭合空元素（如 lyricsList/folder）', () => {
    const xml = renderSubsonicXml({ lyricsList: {} })
    expect(xml).toContain('<lyricsList/>')
  })

  it('空数组 → 不输出子元素，容器保留', () => {
    const xml = renderSubsonicXml({ searchResult3: { song: [] } })
    expect(xml).toContain('<searchResult3/>')
  })
})

describe('renderSubsonicXml — 信封', () => {
  it('默认 ok + 统一版本号 + xmlns', () => {
    const xml = renderSubsonicXml(null)
    expect(xml).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>\n<subsonic-response xmlns="${SUBSONIC_XMLNS}" status="ok" version="${SUBSONIC_VERSION}"></subsonic-response>`
    )
  })

  it('rootAttrs 追加到根元素（ping 的 serverVersion/openSubsonic）', () => {
    const xml = renderSubsonicXml(null, { rootAttrs: { serverVersion: 'v1.9.8', openSubsonic: true } })
    expect(xml).toContain(`version="${SUBSONIC_VERSION}" serverVersion="v1.9.8" openSubsonic="true"`)
  })

  it('错误信封：status=failed + <error code message/>，message 转义', () => {
    const xml = renderSubsonicXml(null, { status: 'failed', error: { code: 70, message: 'Not <found>' } })
    expect(xml).toContain('status="failed"')
    expect(xml).toContain('<error code="70" message="Not &lt;found&gt;"/>')
  })
})

describe('buildSubsonicJsonBody', () => {
  it('subsonic-response 包裹 + 属性平级 + 原生类型', () => {
    const body = buildSubsonicJsonBody({
      song: { id: 'wy-1', duration: 192, isDir: false },
    }) as { 'subsonic-response': Record<string, unknown> }
    expect(body['subsonic-response'].status).toBe('ok')
    expect(body['subsonic-response'].version).toBe(SUBSONIC_VERSION)
    expect(body['subsonic-response'].song).toEqual({ id: 'wy-1', duration: 192, isDir: false })
  })

  it('_text 映射为 value 键（Subsonic JSON 规范）', () => {
    const body = buildSubsonicJsonBody({
      lyrics: { title: { _text: 't' }, line: [{ time: 0, _text: 'x' }] },
    }) as { 'subsonic-response': { lyrics: unknown } }
    expect(body['subsonic-response'].lyrics).toEqual({
      title: { value: 't' },
      line: [{ time: 0, value: 'x' }],
    })
  })

  it('rootAttrs 进信封；error 时忽略 payload；null 字段省略', () => {
    const body = buildSubsonicJsonBody(
      { song: { id: 'a', year: null } as SubsonicPayload },
      { rootAttrs: { openSubsonic: true }, status: 'failed', error: { code: 40, message: 'nope' } }
    ) as { 'subsonic-response': Record<string, unknown> }
    expect(body['subsonic-response'].openSubsonic).toBe(true)
    expect(body['subsonic-response'].error).toEqual({ code: 40, message: 'nope' })
    // 错误信封不携带 payload（Subsonic 协议行为）
    expect(body['subsonic-response'].song).toBeUndefined()

    const ok = buildSubsonicJsonBody({ song: { id: 'a', year: null } as SubsonicPayload }) as {
      'subsonic-response': { song: unknown }
    }
    expect(ok['subsonic-response'].song).toEqual({ id: 'a' })
  })
})

describe('respond — 格式分发', () => {
  const payload: SubsonicPayload = { scanStatus: { scanning: false, count: 10000 } }

  it('默认（无 f 参数）输出 XML', async () => {
    const res = respond(req(), payload)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/xml; charset=UTF-8')
    const text = await res.text()
    expect(text).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(text).toContain('<scanStatus scanning="false" count="10000"/>')
  })

  it('f=xml 显式指定', async () => {
    const res = respond(req('?f=xml'), null)
    expect(res.headers.get('Content-Type')).toBe('application/xml; charset=UTF-8')
  })

  it('f=json 输出 JSON 信封', async () => {
    const res = respond(req('?f=json'), payload)
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=UTF-8')
    const body = JSON.parse(await res.text())
    expect(body['subsonic-response'].scanStatus).toEqual({ scanning: false, count: 10000 })
  })

  it('f=jsonp + 合法 callback → callback(json);', async () => {
    const res = respond(req('?f=jsonp&callback=cb99'), payload)
    expect(res.headers.get('Content-Type')).toBe('text/javascript; charset=UTF-8')
    const text = await res.text()
    expect(text.startsWith('cb99(')).toBe(true)
    expect(text.endsWith(');')).toBe(true)
    expect(JSON.parse(text.slice(5, -2))['subsonic-response'].status).toBe('ok')
  })

  it('f=jsonp 缺 callback 或非法 callback → 回退纯 JSON（防注入）', async () => {
    const missing = respond(req('?f=jsonp'), payload)
    expect(await missing.text()).toBe(JSON.stringify(buildSubsonicJsonBody(payload)))

    const evil = respond(req('?f=jsonp&callback=alert(1)//x'), payload)
    const evilText = await evil.text()
    expect(evilText.startsWith('alert')).toBe(false)
    expect(() => JSON.parse(evilText)).not.toThrow()
  })

  it('opts.headers 透传（Cache-Control 等）', () => {
    const res = respond(req(), null, { headers: { 'Cache-Control': 'public, max-age=3600' } })
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600')
    expect(res.headers.get('Content-Type')).toBe('application/xml; charset=UTF-8')
  })

  it('接受 URL 实例（不经 Request）', async () => {
    const res = respond(new URL(`${REQ_BASE}/ping.view?f=json`), null)
    const body = JSON.parse(await res.text())
    expect(body['subsonic-response'].status).toBe('ok')
  })
})

describe('subsonicError', () => {
  it('输出 failed 信封，f=json 时同样生效', async () => {
    const res = subsonicError(req('?f=json'), 70, 'Method not found: xyz')
    expect(res.status).toBe(200)
    const body = JSON.parse(await res.text())
    expect(body['subsonic-response'].status).toBe('failed')
    expect(body['subsonic-response'].error).toEqual({ code: 70, message: 'Method not found: xyz' })
  })

  it('XML 错误信封', async () => {
    const res = subsonicError(req(), 10, 'Missing id')
    expect(await res.text()).toContain('<error code="10" message="Missing id"/>')
  })
})
