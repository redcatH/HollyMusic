/**
 * 封面 API
 * GET /api/cover/{songId}  → 返回图片二进制
 */

import { NextRequest } from 'next/server'
import { getCoverResponse } from '@/lib/services/cover'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  return getCoverResponse(id)
}
