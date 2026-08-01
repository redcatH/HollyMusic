import { redirect } from 'next/navigation'

/** 旧 URL 兼容：自动重定向到 /admin?tab=sources */
export default function AdminSourcesRedirect() {
  redirect('/admin?tab=sources')
}
