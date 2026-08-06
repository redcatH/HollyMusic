import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/hooks/useAuth'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { UsersPanel } from '@/components/admin/UsersPanel'
import { SourcesPanel } from '@/components/admin/SourcesPanel'
import { CachePanel } from '@/components/admin/CachePanel'
import { RecommendPanel } from '@/components/admin/RecommendPanel'
import { RecommendTaskPanel } from '@/components/admin/RecommendTaskPanel'
import { Users, Music, Database, Sparkles, ListTodo } from 'lucide-react'

const TABS = [
  { key: 'users', label: '用户管理', icon: Users },
  { key: 'sources', label: '音源管理', icon: Music },
  { key: 'recommend', label: '推荐管理', icon: Sparkles },
  { key: 'recommend-tasks', label: '推荐任务', icon: ListTodo },
  { key: 'cache', label: '缓存管理', icon: Database },
] as const

type TabKey = (typeof TABS)[number]['key']

function isValidTab(v: string | null): v is TabKey {
  return v === 'users' || v === 'sources' || v === 'recommend' || v === 'recommend-tasks' || v === 'cache'
}

export function AdminPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const authenticated = useAuthStore(s => s.authenticated)
  const currentUsername = useAuthStore(s => s.username)

  const tabRaw = searchParams.get('tab')
  const tab: TabKey = isValidTab(tabRaw) ? tabRaw : 'users'

  // 鉴权：未登录踢登录页，非 admin 踢首页
  useEffect(() => {
    if (authenticated === false) {
      navigate('/login', { replace: true })
    } else if (authenticated === true && currentUsername !== 'admin') {
      navigate('/', { replace: true })
    }
  }, [authenticated, currentUsername, navigate])

  const switchTab = (key: TabKey) => {
    navigate(`/admin?tab=${key}`)
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

      <div>
        {tab === 'users' && <UsersPanel />}
        {tab === 'sources' && <SourcesPanel />}
        {tab === 'recommend' && <RecommendPanel />}
        {tab === 'recommend-tasks' && <RecommendTaskPanel />}
        {tab === 'cache' && <CachePanel />}
      </div>
    </div>
  )
}

export function AdminUsersPage() {
  return <AdminPage />
}

export function AdminSourcesPage() {
  return <AdminPage />
}

export function AdminRecommendPage() {
  return <AdminPage />
}
