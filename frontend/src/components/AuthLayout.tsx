import type { ReactNode } from 'react'
import { Music2, Heart, ListMusic, Headphones } from 'lucide-react'
import { AppearanceButton } from './AppearanceSettings'

/** 登录与首次设置共享品牌、配色、插画和响应式布局。 */
export function AuthLayout({ title, description, footer, children }: {
  title: string
  description: string
  footer: string
  children: ReactNode
}) {
  return (
    <div className="app-atmosphere login-page safe-form-page flex min-h-dvh flex-col px-5 py-5 sm:px-10 sm:py-7">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between">
        <div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Music2 className="h-5 w-5" /></span><span className="text-base font-bold tracking-tight">Holly Music</span></div>
        <AppearanceButton compact />
      </header>
      <main className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-10 py-9 md:grid-cols-[1.1fr_1fr] md:gap-14 md:py-12">
        <section className="hidden min-w-0 md:block">
          <div className="login-record-scene" aria-hidden="true">
            <div className="login-record"><span className="login-record-label"><Music2 className="h-9 w-9" /></span></div>
            <div className="login-sleeve"><Music2 className="h-7 w-7 opacity-70" /><span className="text-xs font-medium tracking-[0.25em]">HOLLY<br />COLLECTION</span><div className="login-wave">{[18, 32, 52, 36, 68, 45, 60, 28, 42, 20].map((height, i) => <span key={i} style={{ height }} />)}</div></div>
          </div>
          <p className="mb-4 text-xs font-medium tracking-[0.22em] text-primary">属于你的音乐时光</p>
          <h2 className="text-4xl font-semibold leading-[1.4] tracking-tight lg:text-5xl">让喜欢的音乐，<br />一直在身边。</h2>
          <p className="mt-5 max-w-sm text-sm leading-7 text-muted-foreground">发现新的旋律，收藏熟悉的声音。<br />从这里，回到自己的音乐世界。</p>
          <div className="mt-7 flex flex-wrap gap-5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Headphones className="h-4 w-4 text-primary" /> 多源聆听</span>
            <span className="flex items-center gap-1.5"><Heart className="h-4 w-4 text-primary" /> 随心收藏</span>
            <span className="flex items-center gap-1.5"><ListMusic className="h-4 w-4 text-primary" /> 专属歌单</span>
          </div>
        </section>
        <section className="login-form-card mx-auto w-full max-w-md rounded-3xl border border-border/60 bg-card/90 p-6 sm:p-9">
          <span className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Headphones className="h-6 w-6" /></span>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mb-8 mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
          {children}
          <p className="mt-7 border-t border-border/50 pt-5 text-center text-xs leading-relaxed text-muted-foreground">{footer}</p>
        </section>
      </main>
      <p className="text-center text-xs tracking-wide text-muted-foreground/80">Holly Music · 把时间交给音乐</p>
    </div>
  )
}
