import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { createSubsonicJsonResponse, formatSubsonicJSON, formatSubsonicResponseForRequest, formatSubsonicXmlAsJson, wantsSubsonicJson } from './subsonic'
import { handleGetLicense } from './subsonic-system'

describe('Subsonic JSON 响应', () => {
  it('仅在 f=json 时启用 JSON 格式', () => {
    expect(wantsSubsonicJson(new NextRequest('http://localhost/rest/ping.view?f=json'))).toBe(true)
    expect(wantsSubsonicJson(new NextRequest('http://localhost/rest/ping.view?f=xml'))).toBe(false)
  })

  it('使用协议规定的 subsonic-response 根对象', async () => {
    const response = createSubsonicJsonResponse(formatSubsonicJSON({
      status: 'ok',
      attributes: { serverVersion: 'v1.9.8', openSubsonic: true },
    }))

    expect(response.headers.get('content-type')).toContain('application/json')
    await expect(response.json()).resolves.toEqual({
      'subsonic-response': {
        status: 'ok',
        version: '1.16.1',
        serverVersion: 'v1.9.8',
        openSubsonic: true,
      },
    })
  })

  it('getLicense 按 f=json 返回有效许可证', async () => {
    const response = handleGetLicense(new NextRequest('http://localhost/rest/getLicense.view?f=json'))

    expect(response.headers.get('content-type')).toContain('application/json')
    await expect(response.json()).resolves.toEqual({
      'subsonic-response': {
        status: 'ok',
        version: '1.16.1',
        license: { valid: true },
      },
    })
  })

  it('将 XML 子节点、属性和重复节点转换为 Subsonic JSON', () => {
    const json = formatSubsonicXmlAsJson(
      '<?xml version="1.0"?><subsonic-response xmlns="http://subsonic.org/restapi" status="ok" version="1.16.1"><playlist id="42" public="true"><song id="1"/><song id="2"/></playlist></subsonic-response>',
    )

    expect(JSON.parse(json)).toEqual({
      'subsonic-response': {
        status: 'ok',
        version: '1.16.1',
        playlist: {
          id: 42,
          public: true,
          song: [{ id: 1 }, { id: 2 }],
        },
      },
    })
  })

  it('仅将 f=json 的 XML 响应转换为 JSON，保留非 XML 响应', async () => {
    const request = new NextRequest('http://localhost/rest/getUser.view?f=json')
    const xmlResponse = new Response(
      '<?xml version="1.0"?><subsonic-response status="failed" version="1.16.1"><error code="40" message="Denied"/></subsonic-response>',
      { headers: { 'Content-Type': 'application/xml; charset=UTF-8' } },
    )

    const response = await formatSubsonicResponseForRequest(request, xmlResponse)
    expect(response.headers.get('content-type')).toContain('application/json')
    await expect(response.json()).resolves.toEqual({
      'subsonic-response': {
        status: 'failed',
        version: '1.16.1',
        error: { code: 40, message: 'Denied' },
      },
    })
  })

  it('将传统 getLyrics 的 value 属性转换为客户端预期的字符串字段', () => {
    const json = formatSubsonicXmlAsJson(
      '<subsonic-response xmlns="http://subsonic.org/restapi" status="ok" version="1.16.1"><lyrics artist="Artist" title="Title" value="First line&#10;Second line"/></subsonic-response>',
    )

    expect(JSON.parse(json)).toEqual({
      'subsonic-response': {
        status: 'ok',
        version: '1.16.1',
        lyrics: {
          artist: 'Artist',
          title: 'Title',
          value: 'First line\nSecond line',
        },
      },
    })
  })

  it('将 OpenSubsonic 歌词的单条 structuredLyrics 与 line 保持为数组', () => {
    const json = formatSubsonicXmlAsJson(
      '<subsonic-response xmlns="http://subsonic.org/restapi" status="ok" version="1.16.1"><lyricsList><structuredLyrics lang="zho" displayArtist="Artist" displayTitle="Title" synced="true"><line start="1000">First line</line></structuredLyrics></lyricsList></subsonic-response>',
    )

    expect(JSON.parse(json)).toEqual({
      'subsonic-response': {
        status: 'ok',
        version: '1.16.1',
        lyricsList: {
          structuredLyrics: [
            {
              lang: 'zho',
              displayArtist: 'Artist',
              displayTitle: 'Title',
              synced: true,
              line: [{ start: 1000, value: 'First line' }],
            },
          ],
        },
      },
    })
  })

  it('将无时间轴 OpenSubsonic 歌词行转换为带 value 的对象', () => {
    const json = formatSubsonicXmlAsJson(
      '<subsonic-response xmlns="http://subsonic.org/restapi" status="ok" version="1.16.1"><lyricsList><structuredLyrics lang="zho" synced="false"><line>Plain lyric</line></structuredLyrics></lyricsList></subsonic-response>',
    )

    expect(JSON.parse(json)).toEqual({
      'subsonic-response': {
        status: 'ok',
        version: '1.16.1',
        lyricsList: {
          structuredLyrics: [{
            lang: 'zho',
            synced: false,
            line: [{ value: 'Plain lyric' }],
          }],
        },
      },
    })
  })
})
