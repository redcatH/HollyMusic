/**
 * API 响应工具
 * 统一 API 响应格式
 */

import { NextResponse } from 'next/server'
import type { ApiResponse, ApiError } from './types/music'

/**
 * 创建成功响应
 */
export function createSuccessResponse<T>(data: T, status: number = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json(
    {
      success: true,
      data,
    },
    { status }
  )
}

/**
 * 创建错误响应
 */
export function createErrorResponse(
  code: string,
  message: string,
  status: number = 400,
  details?: unknown
): NextResponse<ApiResponse> {
  const error: ApiError = {
    code,
    message,
  }

  if (details !== undefined) {
    error.details = details
  }

  return NextResponse.json(
    {
      success: false,
      error,
    },
    { status }
  )
}

/**
 * 错误码常量
 */
export const ErrorCodes = {
  // 通用错误
  INVALID_PARAMS: 'INVALID_PARAMS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  
  // 配置相关
  CONFIG_INVALID: 'CONFIG_INVALID',
  CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',
  
  // 音源相关
  SOURCE_NOT_FOUND: 'SOURCE_NOT_FOUND',
  SOURCE_NOT_SUPPORTED: 'SOURCE_NOT_SUPPORTED',
  SOURCE_INIT_FAILED: 'SOURCE_INIT_FAILED',
  ALL_SOURCES_FAILED: 'ALL_SOURCES_FAILED',
  
  // 搜索相关
  SEARCH_FAILED: 'SEARCH_FAILED',
  SEARCH_TIMEOUT: 'SEARCH_TIMEOUT',
  
  // 播放相关
  URL_NOT_FOUND: 'URL_NOT_FOUND',
  URL_FETCH_FAILED: 'URL_FETCH_FAILED',
  QUALITY_NOT_SUPPORTED: 'QUALITY_NOT_SUPPORTED',
}
