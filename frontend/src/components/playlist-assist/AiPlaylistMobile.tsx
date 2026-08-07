/**
 * AI 协助建歌单 - 移动端向导壳
 * 职责：全屏容器 + 顶部栏 + 统一底部导航栏 + 步骤切换动画 + 过渡态覆盖层
 * 不渲染 Step 内部按钮（由 useWizardNav 统一决策）。
 */

import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { AiPlaylistController } from '@@/hooks/useAiPlaylist'
import { StepIndicator } from '@@/components/playlist-assist/StepIndicator'
import { StepInput } from '@@/components/playlist-assist/StepInput'
import { StepCandidates } from '@@/components/playlist-assist/StepCandidates'
import { StepProcessing } from '@@/components/playlist-assist/StepProcessing'
import { StepConfirm } from '@@/components/playlist-assist/StepConfirm'
import { useWizardNav, NavBtnIcon, type NavBtn } from '@@/components/playlist-assist/useWizardNav'

const variants = {
  enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
}

function FooterBtn({ btn, primary }: { btn: NavBtn; primary?: boolean }) {
  return (
    <button
      onClick={btn.onClick}
      disabled={btn.disabled}
      className={`touch-target flex flex-1 items-center justify-center gap-1.5 rounded-2xl px-4 py-3.5 text-base font-semibold transition active:scale-[0.99] disabled:opacity-50 ${
        primary
          ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:opacity-90 disabled:shadow-none'
          : 'border border-border text-muted-foreground hover:bg-accent'
      }`}
    >
      <NavBtnIcon btn={btn} />
      {btn.label}
    </button>
  )
}

export function AiPlaylistMobile({ ai }: { ai: AiPlaylistController }) {
  const navigate = useNavigate()
  const close = () => navigate('/playlists')
  const onView = () => navigate(`/playlists/${ai.createdId}`)
  const nav = useWizardNav(ai, onView)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* 顶部：关闭 + 进度（safe-area-top 避刘海） */}
      <div className="safe-area-top flex h-14 shrink-0 items-center gap-2 border-b border-border px-2">
        <button
          onClick={close}
          className="touch-target flex items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
          aria-label="关闭"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="flex-1 px-1">
          <StepIndicator current={ai.step} />
        </div>
      </div>

      {/* 内容区（高度链：min-h-0 保证子级可滚动；safe-area-bottom 避手势条） */}
      <div className="relative min-h-0 flex-1 overflow-hidden safe-area-bottom">
        <AnimatePresence custom={ai.direction} mode="wait">
          <motion.div
            key={ai.step}
            custom={ai.direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="absolute inset-0 flex flex-col"
          >
            {ai.step === 0 && (
              <StepInput
                prompt={ai.prompt}
                setPrompt={ai.setPrompt}
                targetCount={ai.targetCount}
                setTargetCount={ai.setTargetCount}
                generating={ai.generating}
                generateError={ai.generateError}
                sources={ai.sources}
                sourcesLoading={ai.sourcesLoading}
                selectedSources={ai.selectedSources}
                toggleSource={ai.toggleSource}
              />
            )}
            {ai.step === 1 && ai.generateResult && (
              <StepCandidates
                generateResult={ai.generateResult}
                selectedItems={ai.selectedItems}
                toggleItem={ai.toggleItem}
                playlistName={ai.playlistName}
                setPlaylistName={ai.setPlaylistName}
                mode={ai.mode}
              />
            )}
            {ai.step === 2 && (
              <StepConfirm
                confirmSongs={ai.confirmSongs}
                selectedUids={ai.selectedUids}
                toggleUid={ai.toggleUid}
                processing={ai.processing}
                createError={ai.createError}
                createdId={ai.createdId}
                mode={ai.mode}
              />
            )}
          </motion.div>
        </AnimatePresence>

        {/* 过渡态覆盖层 */}
        {ai.isProcessing && (
          <div className="absolute inset-0 flex flex-col bg-background/95 backdrop-blur-sm">
            <StepProcessing processing={ai.processing} />
          </div>
        )}
      </div>

      {/* 统一底部导航栏 */}
      <div className="flex shrink-0 items-center gap-2 border-t border-border bg-card px-4 py-3">
        {nav.left && <FooterBtn btn={nav.left} />}
        {nav.right && <FooterBtn btn={nav.right} primary />}
      </div>
    </div>
  )
}
