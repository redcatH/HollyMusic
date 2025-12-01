import { NextRequest } from 'next/server'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { formatSubsonicXML, createSubsonicResponse } from './subsonic'
import { type AuthResult } from './auth'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function handleCoverArt(request: NextRequest, authRes: AuthResult): Response {
  try {
    // 固定路径读取 PNG 文件，例如从 public 目录或本地路径
    const coverPath = resolve(process.cwd(), 'public/icons/OIP-C.png')
    const buffer = readFileSync(coverPath)
    
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(buffer.length),
        'Cache-Control': 'public, max-age=86400'
      }
    })
  } catch (err) {
    console.error('[getCoverArt] Error reading cover art:', err)
    // 返回 Subsonic 风格的错误
    const xml = formatSubsonicXML({
      status: 'failed',
      error: { code: 70, message: 'Cover art not found' }
    })
    return createSubsonicResponse(xml)
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function handleGetLyrics(request: NextRequest, authRes: AuthResult): Response {
  // 返回固定的歌词 XML
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<subsonic-response xmlns="http://subsonic.org/restapi" status="ok" version="1.15.1">
  <lyrics>
    <artist>示例歌手</artist>
    <title>示例歌曲</title>
    <line time="0">歌词第一行</line>
    <line time="3000">歌词第二行</line>
    <line time="6000">歌词第三行</line>
    <line time="9000">歌词第四行</line>
  </lyrics>
</subsonic-response>`
  
  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml',
      'Content-Length': String(Buffer.byteLength(xml)),
      'Cache-Control': 'public, max-age=86400'
    }
  })
}
