'use client'

/**
 * 根级错误兜底（React Error Boundary）。
 *
 * 当客户端导航的目标路由段渲染抛错时，若无 error.tsx 兜底，
 * Next.js app-router 会降级为整页刷新（hard recovery）以尝试用服务端渲染恢复——
 * 这会卸载 PlayerBar、销毁 Howler，导致播放中断。
 * 此组件接管错误，提供「重试」按钮（调用 reset 重渲染该路由段），避免 hard recovery。
 */

import { useEffect } from 'react'
import { AlertCircle, RotateCcw } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app/error] 路由渲染出错:', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6">
      <AlertCircle className="h-12 w-12 text-destructive" />
      <div className="text-center">
        <h2 className="text-lg font-semibold">页面加载出错</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {error.message || '发生未知错误'}
        </p>
        {error.digest && (
          <p className="mt-1 font-mono text-xs text-muted-foreground/60">
            {error.digest}
          </p>
        )}
      </div>
      <button
        onClick={reset}
        className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        <RotateCcw className="h-4 w-4" /> 重试
      </button>
    </div>
  )
}
