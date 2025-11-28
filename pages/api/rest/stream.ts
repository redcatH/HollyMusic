// pages/api/rest/stream.ts
import fs from 'fs'
import type { NextApiRequest, NextApiResponse } from 'next'
import { pipeline } from 'stream'
import { promisify } from 'util'

const pump = promisify(pipeline)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const testPath = 'D:\\work\\liuyi\\online\\linux\\web\\my-music\\.cache\\audio\\mg-1140461527-320k.mp3'
  try {
    if (!fs.existsSync(testPath)) {
      const xml = `<?xml version="1.0" encoding="UTF-8"?><subsonic-response status="failed"><error code="70" message="File not found"/></subsonic-response>`
      res.setHeader('Content-Type', 'application/xml')
      return res.status(404).send(xml)
    }

    const stat = fs.statSync(testPath)
    const fileSize = stat.size

    // 设置头并禁用 Range（忽略请求里的 Range）
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Content-Length', String(fileSize))
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')

    if (req.method === 'HEAD') {
      // HEAD 仅返回头
      return res.status(200).end()
    }

    // 流式发送整个文件（不启用 range 处理）
    const readStream = fs.createReadStream(testPath)
    res.statusCode = 200
    // 使用 pipeline 更好地处理错误
    await pump(readStream, res)
    // pipeline 完成后，连接会自动结束
  } catch (err) {
    console.error('[stream] error', err)
    const xml = `<?xml version="1.0" encoding="UTF-8"?><subsonic-response status="failed"><error code="0" message="Test file serve failed"/></subsonic-response>`
    res.setHeader('Content-Type', 'application/xml')
    return res.status(500).send(xml)
  }
}