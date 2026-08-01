'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/hooks/useAuth'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { UsersPanel } from '@/components/admin/UsersPanel'
import { SourcesPanel } from '@/components/admin/SourcesPanel'
import { CachePanel } from '@/components/admin/CachePanel'
import { Users, Music, Database } from 'lucide-react'

const TABS = [
  { key: 'users', label: '用户管理', icon: Users },
  { key: 'sources', label: '音源管理', icon: Music },
  { key: 'cache', label: '缓存管理', icon: Database },
] as const

type TabKey = (typeof TABS)[number]['key']

function isValidTab(v: string | null): v is TabKey {
  return v === 'users' || v === 'sources' || v === 'cache'
}

/** useSearchParams 必须在 Suspense 内使用，故拆出内容组件 */
function AdminContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const authenticated = useAuthStore(s => s.authenticated)
  const currentUsername = useAuthStore(s => s.username)

  const tabRaw = searchParams?.get('tab') ?? null
  const tab: TabKey = isValidTab(tabRaw) ? tabRaw : 'users'

  // 鉴权：未登录踢登录页，非 admin 踢首页
  useEffect(() => {
    if (authenticated === false) {
      router.replace('/login')
    } else if (authenticated === true && currentUsername !== 'admin') {
      router.replace('/')
    }
  }, [authenticated, currentUsername, router])

  const switchTab = (key: TabKey) => {
    router.push(`/admin?tab=${key}`)
  }

  // 鉴权态未确定时显示骨架
  if (authenticated === null || authenticated === undefined) {
    return <div className="p-6"><LoadingSkeleton count={5} /></div>
  }

  // 非 admin 不渲染内容（useEffect 会重定向）
  if (currentUsername !== 'admin') {
    return <div className="p-6"><LoadingSkeleton count={3} /></div>
  }

  return (
    <div className="p-6">
      {/* Tab 导航 */}
      <div className="mb-6 flex gap-1 border-b border-border">
        {TABS.map(t => {
          const active = tab === t.key
          const Icon = t.icon
          return (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Tab 内容 */}
      <div>
        {tab === 'users' && <UsersPanel />}
        {tab === 'sources' && <SourcesPanel />}
        {tab === 'cache' && <CachePanel />}
      </div>
    </div>
  )
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="p-6"><LoadingSkeleton count={5} /></div>}>
      <AdminContent />
    </Suspense>
  )
}
