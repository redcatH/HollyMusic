import fs from 'node:fs/promises'
import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/services/user-context'
import { getAsset } from '@/lib/services/source-test-service'
import { testRouteError } from '@/lib/server/source-test-route'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAdmin(request)
    const asset = await getAsset((await context.params).id, user.id, request.nextUrl.searchParams.get('key') || '')
    const file = await fs.open(asset.file, 'r')
    try {
      const size = (await file.stat()).size
      let start = 0, end = size - 1
      const range = request.headers.get('range')
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range)
        if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
        if (!match[1]) start = Math.max(0, size - Number(match[2]))
        else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      }
      const bytes = new Uint8Array(end - start + 1)
      await file.read(bytes, 0, bytes.length, start)
      const codec = asset.codec.toLowerCase()
      const mime = codec.includes('flac') ? 'audio/flac' : codec.includes('mpeg') ? 'audio/mpeg' : codec.includes('aac') ? 'audio/mp4' : codec.includes('pcm') ? 'audio/wav' : 'application/octet-stream'
      return new Response(bytes, { status: range ? 206 : 200, headers: {
        'Content-Type': mime, 'Content-Length': String(bytes.length), 'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
      } })
    } finally { await file.close() }
  } catch (error) { return testRouteError(error) }
}
