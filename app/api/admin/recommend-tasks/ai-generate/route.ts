/**
 * AI 协助生成名单 API（仅管理员）
 * POST /api/admin/recommend-tasks/ai-generate
 *   { taskType: 'artists'|'songs', prompt, apiKey, baseUrl?, model?, extraBody? }
 *
 * 返回 { items: string[] }（歌手名或歌曲名）。不写库。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import { requireAdmin, AuthError, ForbiddenError } from '@/lib/services/user-context'
import { callAI, extractJSON, resolveAICreds } from '@/lib/services/ai-helper'
import {
  DEFAULT_PROMPT_SYSTEM,
  DEFAULT_PROMPT_AI_GENERATE_ARTISTS,
  DEFAULT_PROMPT_AI_GENERATE_SONGS,
} from '@/lib/recommend-defaults'
import { logger } from '@/lib/logger'

function guard(err: unknown) {
  if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
  if (err instanceof ForbiddenError) return createErrorResponse('FORBIDDEN', err.message, 403)
  return null
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request)
    const body = await request.json().catch(() => ({}))
    const taskType = body?.taskType === 'songs' ? 'songs' : 'artists'
    const userPrompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
    const userBaseUrl = typeof body?.baseUrl === 'string' ? body.baseUrl.trim() : ''
    const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : process.env.OPENAI_MODEL || 'gpt-4o-mini'
    const extraBody = body?.extraBody && typeof body.extraBody === 'object' && !Array.isArray(body.extraBody) ? body.extraBody : {}

    if (!userPrompt) {
      return createErrorResponse('INVALID_PARAMS', '缺少必填字段: prompt (需求描述)', 400)
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

    const tpl = taskType === 'songs' ? DEFAULT_PROMPT_AI_GENERATE_SONGS : DEFAULT_PROMPT_AI_GENERATE_ARTISTS
    const user = tpl.replace(/\{\{userPrompt\}\}/g, userPrompt)

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

    const obj = extractJSON(raw) as { items?: unknown }
    const items = (Array.isArray(obj.items) ? obj.items : [])
      .map((s: unknown) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)

    return createSuccessResponse({ items })
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/recommend-tasks/ai-generate POST] error:', err)
    const msg = err instanceof Error ? err.message : 'AI 生成名单失败'
    return createErrorResponse('INTERNAL_ERROR', msg, 500)
  }
}
