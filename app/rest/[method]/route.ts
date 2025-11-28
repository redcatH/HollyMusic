import { NextRequest } from 'next/server'
import { readFileSync, createReadStream, promises as fsPromises } from 'fs'
import { Readable } from 'stream'
import { resolve } from 'path'
import { handlePing } from '@/lib/subsonic-ping'
import { handleSearch } from '@/lib/subsonic-search'
import { decodeMusicInfo } from '@/lib/subsonic-id'
import { formatSubsonicXML, createSubsonicResponse } from '@/lib/subsonic'
import { handleStream } from '@/lib/subsonic-stream'

function normalizeMethod(raw: string | undefined) {
  if (!raw) return ''
  return raw.replace(/\.view$/i, '')
}

/**
 * 将时间字符串转换为秒
 * 支持格式: "03:12" -> 192, "1:30:45" -> 5445, 或直接传入数字
 */
function parseDurationToSeconds(duration: string | number | undefined): number {
  if (!duration) return 180 // 默认 3 分钟

  // 如果已经是数字，直接返回
  if (typeof duration === 'number') return duration

  // 如果是字符串，尝试解析
  if (typeof duration === 'string') {
    const parts = duration.split(':').map(Number)
    
    if (parts.length === 2) {
      // MM:SS 格式
      return parts[0] * 60 + parts[1]
    } else if (parts.length === 3) {
      // HH:MM:SS 格式
      return parts[0] * 3600 + parts[1] * 60 + parts[2]
    } else if (parts.length === 1 && !isNaN(parts[0])) {
      // 单纯数字字符串
      return parts[0]
    }
  }

  return 180 // 默认值
}

function handleCoverArt(): Response {
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

function handleGetLyrics(): Response {
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

function handleGetSong(request: NextRequest): Response {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      const xml = formatSubsonicXML({
        status: 'failed',
        error: { code: 50, message: 'Required parameter missing: id' }
      })
      return createSubsonicResponse(xml)
    }

    // 解析编码的音乐信息
    const musicInfo = decodeMusicInfo(id)
    
    if (!musicInfo) {
      const xml = formatSubsonicXML({
        status: 'failed',
        error: { code: 70, message: 'Song not found' }
      })
      return createSubsonicResponse(xml)
    }

    // 构造歌曲信息
    const durationSeconds = parseDurationToSeconds(musicInfo.duration)
    const songXml = `<?xml version="1.0" encoding="UTF-8"?>
<subsonic-response xmlns="http://subsonic.org/restapi" status="ok" version="1.15.1">
  <song 
    id="${id}"
    parent="${id}"
    title="${musicInfo.name || 'Unknown'}"
    album="${musicInfo.album || 'Unknown'}"
    artist="${musicInfo.singer || 'Unknown'}"
    isDir="false"
    coverArt="${id}"
    created="2024-01-01T00:00:00"
    duration="${durationSeconds}"
    bitRate="320"
    size="10485760"
    suffix="mp3"
    contentType="audio/mpeg"
    isVideo="false"
    path="${musicInfo.singer || 'Unknown'}/${musicInfo.album || 'Unknown'}/${musicInfo.name || 'Unknown'}.mp3"
  />
</subsonic-response>`

    return new Response(songXml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml',
        'Content-Length': String(Buffer.byteLength(songXml)),
        'Cache-Control': 'public, max-age=3600'
      }
    })
  } catch (err) {
    console.error('[getSong] Error:', err)
    const xml = formatSubsonicXML({
      status: 'failed',
      error: { code: 0, message: 'Internal error' }
    })
    return createSubsonicResponse(xml)
  }
}

async function handleMethod(request: NextRequest, method: string) {
  switch (method) {
    case 'ping':
      return handlePing(request)
    case 'search3':
      return handleSearch(request)
    case 'stream':
      return handleStream(request)
    case 'getCoverArt':
      return handleCoverArt()
    case 'getLyrics':
      return handleGetLyrics()
    case 'getSong':
      return handleGetSong(request)
    default: {
      console.log("404 url", method)
      return new Response(null, {
        status: 404
      })
      // 返回 subsonic 风格的 404/未找到响应
      // const xml = formatSubsonicXML({
      //   status: 'failed',
      //   error: { code: 70, message: `Method not found: ${raw}` }
      // })
      // return createSubsonicResponse(xml)
    }
  }
}

async function testStream(request: NextRequest): Promise<Response> {
  const testPath = 'D:\\work\\user\\online\\linux\\web\\my-music\\.cache\\audio\\mg-1140461527-320k.mp3'
  try {
    const stat = await fsPromises.stat(testPath)
    const fileSize = Number(stat.size)
    // 忽略 Range，始终返回整个文件（HTTP 200），并设置 no-cache 策略
    const fullStream = createReadStream(testPath)
    const body = Readable.toWeb(fullStream) as unknown as BodyInit
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(fileSize),
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    })
  } catch (err) {
    console.error('[handleStream] Error serving test file:', err)
    const xml = formatSubsonicXML({ status: 'failed', error: { code: 0, message: 'Test file serve failed' } })
    return createSubsonicResponse(xml)
  }
}

export async function GET(request: NextRequest, context: { params: Promise<Record<string, string> | undefined> }) {
  // In Next 16 params is a Promise — unwrap it before use
  const params = await context.params
  const raw = params?.method
  const method = normalizeMethod(raw)

  // 打印参数日志，便于调试
  console.log('[rest] params:', params, 'raw:', raw, 'method:', method, 'requestUrl:', request.url)

  return handleMethod(request, method)
}

// export async function POST(request: NextRequest, context: { params: Promise<Record<string, string> | undefined> }) {
//   return GET(request, context)
// }

// export async function HEAD(request: NextRequest, context: { params: Promise<Record<string, string> | undefined> }) {
//   const params = await context.params
//   const raw = params?.method
//   const method = normalizeMethod(raw)

//   const response = await handleMethod(request, method, raw)
  
//   // HEAD 请求返回相同的响应头，但 body 为空
//   return new Response(null, {
//     status: response.status,
//     statusText: response.statusText,
//     headers: response.headers
//   })
// }
