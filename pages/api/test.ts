import type { NextApiRequest, NextApiResponse } from 'next'

// Simple Pages API Route using Node's res to set headers with original casing
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const body = Buffer.from('test-body')

    // Use Node-style setHeader/writeHead to keep header casing when possible
    res.statusCode = 200
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Content-Length', String(body.length))
    res.setHeader('X-Custom-Header', 'KeepCaseTest')

    // End response with body
    res.end(body)
  } catch (err) {
    // Fallback JSON error
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'internal' }))
  }
}
