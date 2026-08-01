import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'

/**
 * 根级 loading 兜底（Suspense fallback）。
 *
 * Next.js app-router 导航时，目标路由的 RSC payload 尚未返回前会显示此组件，
 * 让导航立即切换而非卡在旧页面。各路由可覆盖更贴合内容的 loading.tsx。
 */
export default function Loading() {
  return (
    <div className="p-6">
      <div className="mb-4 h-8 w-48 animate-pulse rounded bg-muted" />
      <LoadingSkeleton count={10} />
    </div>
  )
}
