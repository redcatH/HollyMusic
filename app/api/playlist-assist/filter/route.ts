/**
 * AI 协助创建歌单 - 过滤候选 API（所有登录用户）
 * POST /api/playlist-assist/filter
 *   { songs: [{uid,name,singer,source,albumName?}], prompt?, count? }
 *
 * 凭证强制服务端环境变量。只读建议（keep/remove + 原因），不写库。
 * 复用 DEFAULT_PROMPT_AI_ADD（选好版本、排除 live/伴奏/粗制）。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import { requireUser, AuthError } from '@/lib/services/user-context'
import { callAI, extractJSON } from '@/lib/services/ai-helper'
import { DEFAULT_PROMPT_SYSTEM, DEFAULT_PROMPT_AI_PLAYLIST_FILTER } from '@/lib/recommend-defaults'
import { getFilterMaxSongs } from '@/lib/search-config'
import { logger } from '@/lib/logger'

interface SongIn {
  uid: string
  name: string | null
  singer: string | null
  source: string
  albumName?: string | null
}

export async function POST(request: NextRequest) {
  try {
    await requireUser(request)

    const apiKey = process.env.OPENAI_API_KEY || ''
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
    if (!apiKey) {
      return createErrorResponse('CONFIG_INVALID', '服务端未配置 OPENAI_API_KEY', 500)
    }

    const body = await request.json().catch(() => ({}))
    const songs: SongIn[] = (
      Array.isArray(body?.songs)
        ? body.songs.filter(
            (s: unknown) =>
              typeof s === 'object' && s !== null && typeof (s as SongIn).uid === 'string',
          )
        : []
    ).slice(0, getFilterMaxSongs()) // 安全上限（AI_PLAYLIST_FILTER_MAX_SONGS，默认1500）：覆盖正常流程最大量，防恶意直接调 API
    const userPrompt =
      typeof body?.prompt === 'string' ? body.prompt.trim().slice(0, 500) : ''
    const count = Math.max(1, Math.min(50, Number(body?.count) || 15))

    if (songs.length === 0) {
      return createErrorResponse('INVALID_PARAMS', '缺少必填字段: songs (非空数组)', 400)
    }

    const lines = songs
      .map((s, i) => `${i + 1}. ${s.name || '-'} | ${s.singer || '-'} | ${s.albumName || '-'}`)
      .join('\n')
    const user = DEFAULT_PROMPT_AI_PLAYLIST_FILTER.replace(/\{\{candidates\}\}/g, lines)
      .replace(/\{\{userPrompt\}\}/g, userPrompt || '（无具体需求，按大众认可的好版本筛）')
      .replace(/\{\{count\}\}/g, String(count))

    const raw = await callAI({
      apiKey,
      baseUrl,
      model,
      extraBody: {},
      messages: [
        { role: 'system', content: DEFAULT_PROMPT_SYSTEM },
        { role: 'user', content: user },
      ],
    })

    const obj = extractJSON(raw) as { suggestions?: unknown }
    const rawSuggestions = Array.isArray(obj.suggestions) ? obj.suggestions : []
    const suggestions = rawSuggestions
      .map((s: unknown) => {
        if (typeof s !== 'object' || s === null) return null
        const o = s as { index?: unknown; action?: unknown; reason?: unknown }
        const idx = Number(o.index) - 1
        if (!Number.isInteger(idx) || idx < 0 || idx >= songs.length) return null
        const act = o.action === 'remove' ? 'remove' : 'keep'
        return {
          uid: songs[idx].uid,
          action: act,
          reason: typeof o.reason === 'string' ? o.reason.slice(0, 50) : '',
        }
      })
      .filter(Boolean) as { uid: string; action: 'keep' | 'remove'; reason: string }[]

    return createSuccessResponse({ suggestions })
  } catch (err) {
    if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
    logger.error('[api/playlist-assist/filter POST] error:', err)
    const msg = err instanceof Error ? err.message : 'AI 过滤失败'
    return createErrorResponse('INTERNAL_ERROR', msg, 500)
  }
}
