/**
 * AI 协助创建歌单 - 生成候选 API（所有登录用户）
 * POST /api/playlist-assist/generate
 *   { prompt: 需求描述 }
 *
 * 凭证强制用服务端环境变量（OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL），
 * 不接受用户传 key——面向 C 端用户，服务端 key 永不下发前端。
 *
 * 返回 { mode:'songs'|'artists', items:string[], playlistName:string }。不写库。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import { requireUser, AuthError } from '@/lib/services/user-context'
import { callAI, extractJSON } from '@/lib/services/ai-helper'
import {
  DEFAULT_PROMPT_SYSTEM,
  DEFAULT_PROMPT_AI_PLAYLIST_GENERATE,
} from '@/lib/recommend-defaults'
import { logger } from '@/lib/logger'

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
    const userPrompt =
      typeof body?.prompt === 'string' ? body.prompt.trim().slice(0, 500) : ''
    if (!userPrompt) {
      return createErrorResponse('INVALID_PARAMS', '缺少必填字段: prompt (需求描述)', 400)
    }

    const user = DEFAULT_PROMPT_AI_PLAYLIST_GENERATE.replace(/\{\{userPrompt\}\}/g, userPrompt)

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

    const obj = extractJSON(raw) as {
      mode?: unknown
      items?: unknown
      playlistName?: unknown
    }
    const mode = obj.mode === 'artists' ? 'artists' : 'songs'
    const items = (Array.isArray(obj.items) ? obj.items : [])
      .map((s: unknown) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      .slice(0, 15)
    const playlistName =
      typeof obj.playlistName === 'string' && obj.playlistName.trim()
        ? obj.playlistName.trim().slice(0, 24)
        : 'AI 歌单'

    return createSuccessResponse({ mode, items, playlistName })
  } catch (err) {
    if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
    logger.error('[api/playlist-assist/generate POST] error:', err)
    const msg = err instanceof Error ? err.message : 'AI 生成失败'
    return createErrorResponse('INTERNAL_ERROR', msg, 500)
  }
}
