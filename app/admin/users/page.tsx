import { redirect } from 'next/navigation'

/** 旧 URL 兼容：自动重定向到 /admin?tab=users */
export default function AdminUsersRedirect() {
  redirect('/admin?tab=users')
}
