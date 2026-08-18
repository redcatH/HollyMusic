/**
 * AI 辅助筛选 API（仅管理员）
 * POST /api/admin/recommend/ai-filter
 *   { action: 'add'|'remove', songs: [{uid,name,singer,source,albumName?}], prompt, apiKey, baseUrl?, model?, extraBody? }
 *
 * 只读建议：不写库。用户确认后前端再调 addRecommended / removeRecommendedBatch。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import { requireAdmin, AuthError, ForbiddenError } from '@/lib/services/user-context'
import { callAI, extractJSON, resolveAICreds } from '@/lib/services/ai-helper'
import { DEFAULT_PROMPT_SYSTEM, DEFAULT_PROMPT_AI_ADD, DEFAULT_PROMPT_AI_REMOVE } from '@/lib/recommend-defaults'
import { logger } from '@/lib/logger'

function guard(err: unknown) {
  if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
  if (err instanceof ForbiddenError) return createErrorResponse('FORBIDDEN', err.message, 403)
  return null
}

interface SongIn {
  uid: string
  name: string | null
  singer: string | null
  source: string
  albumName?: string | null
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request)
    const body = await request.json().catch(() => ({}))
    const action = body?.action === 'remove' ? 'remove' : 'add'
    const songs: SongIn[] = Array.isArray(body?.songs)
      ? body.songs.filter((s: unknown) => typeof s === 'object' && s !== null && typeof (s as SongIn).uid === 'string')
      : []
    const userPrompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
    const userBaseUrl = typeof body?.baseUrl === 'string' ? body.baseUrl.trim() : ''
    const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : process.env.OPENAI_MODEL || 'gpt-4o-mini'
    const extraBody = body?.extraBody && typeof body.extraBody === 'object' && !Array.isArray(body.extraBody) ? body.extraBody : {}

    if (songs.length === 0) {
      return createErrorResponse('INVALID_PARAMS', '缺少必填字段: songs (非空数组)', 400)
    }

    // 安全不变式：env key 只发 env baseUrl，自定义 baseUrl 必须搭配用户自己的 key
    const creds = resolveAICreds(apiKey, userBaseUrl)
    if (!creds) {
      return createErrorResponse(
        'INVALID_PARAMS',
        '使用自定义 baseUrl 时必须同时填写你自己的 API key（服务端密钥不允许发往自定义地址），或清空 baseUrl 使用服务端配置',
        400,
      )
    }

    const lines = songs
      .map((s, i) => `${i + 1}. ${s.name || '-'} | ${s.singer || '-'} | ${s.albumName || '-'}`)
      .join('\n')
    const tpl = action === 'remove' ? DEFAULT_PROMPT_AI_REMOVE : DEFAULT_PROMPT_AI_ADD
    const user = tpl.replace(/\{\{candidates\}\}/g, lines).replace(/\{\{userPrompt\}\}/g, userPrompt || '（无）')

    const raw = await callAI({
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      model,
      extraBody,
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
        return { uid: songs[idx].uid, action: act, reason: typeof o.reason === 'string' ? o.reason.slice(0, 50) : '' }
      })
      .filter(Boolean) as { uid: string; action: 'keep' | 'remove'; reason: string }[]

    return createSuccessResponse({ suggestions })
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/recommend/ai-filter POST] error:', err)
    const msg = err instanceof Error ? err.message : 'AI 辅助筛选失败'
    return createErrorResponse('INTERNAL_ERROR', msg, 500)
  }
}
