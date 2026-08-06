/**
 * 向导统一导航决策 hook —— 两个壳（Desktop/Mobile）共享
 * 根据 ai controller 的当前状态算出 { left?, right? } 按钮，壳各自渲染样式。
 * 消除「按钮逻辑散落各 Step」的根因。
 */

import { useCallback, useMemo } from 'react'
import { ChevronLeft, Loader2, Sparkles, Search, Check, ExternalLink, RotateCw } from 'lucide-react'
import type { AiPlaylistController } from '@@/hooks/useAiPlaylist'

export interface NavBtn {
  label: string
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  icon?: 'back' | 'sparkles' | 'search' | 'check' | 'view' | 'retry'
  variant?: 'primary' | 'ghost'
}

export interface WizardNav {
  left?: NavBtn
  right?: NavBtn
}

export function useWizardNav(
  ai: AiPlaylistController,
  onView: () => void,
): WizardNav {
  const back = useCallback(() => ai.goBack(), [ai])

  return useMemo<WizardNav>(() => {
    // 成功态：只显示「查看歌单」
    if (ai.createdId !== null) {
      return {
        right: { label: '查看歌单', onClick: onView, icon: 'view', variant: 'primary' },
      }
    }

    // 过渡态（搜索/过滤中/出错）
    if (ai.isProcessing) {
      const isError = ai.processing?.phase === 'error'
      return {
        left: { label: '返回修改候选', onClick: back, icon: 'back', variant: 'ghost' },
        ...(isError
          ? { right: { label: '重试', onClick: ai.runProcess, icon: 'retry', variant: 'primary' } }
          : {}),
      }
    }

    // 3 个步骤
    switch (ai.step) {
      case 0:
        return {
          right: {
            label: ai.generating ? 'AI 生成中…' : '开始生成',
            onClick: ai.runGenerate,
            disabled: ai.generating || !ai.prompt.trim() || ai.sources.length === 0,
            loading: ai.generating,
            icon: 'sparkles',
            variant: 'primary',
          },
        }
      case 1: {
        const count = ai.selectedItems.size
        return {
          left: { label: '上一步', onClick: back, icon: 'back', variant: 'ghost' },
          right: {
            label: `搜索这 ${count} 个`,
            onClick: ai.runProcess,
            disabled: count === 0,
            icon: 'search',
            variant: 'primary',
          },
        }
      }
      case 2: {
        const count = ai.selectedUids.size
        const isAdd = ai.mode === 'add'
        return {
          left: { label: '上一步', onClick: back, icon: 'back', variant: 'ghost', disabled: ai.creating },
          right: {
            label: ai.creating ? (isAdd ? '加入中…' : '创建中…') : isAdd ? `加入此歌单(${count})` : `创建歌单(${count})`,
            onClick: ai.createPlaylistAndSongs,
            disabled: ai.creating || count === 0,
            loading: ai.creating,
            icon: 'check',
            variant: 'primary',
          },
        }
      }
      default:
        return {}
    }
  }, [ai, back, onView])
}

/** 按钮图标渲染 */
export function NavBtnIcon({ btn }: { btn: NavBtn }) {
  if (btn.loading) return <Loader2 className="h-4 w-4 animate-spin" />
  switch (btn.icon) {
    case 'back':
      return <ChevronLeft className="h-4 w-4" />
    case 'sparkles':
      return <Sparkles className="h-4 w-4" />
    case 'search':
      return <Search className="h-4 w-4" />
    case 'check':
      return <Check className="h-4 w-4" />
    case 'view':
      return <ExternalLink className="h-4 w-4" />
    case 'retry':
      return <RotateCw className="h-4 w-4" />
    default:
      return null
  }
}
