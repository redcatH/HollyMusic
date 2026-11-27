import type { PluginManifest, PluginSelection } from './platform-plugins'

export interface PluginTestResult { ok: boolean; count?: number; sampleId?: string; message?: string; testedAt: string }
export interface PluginRevisionView { id: string; manifest: PluginManifest; tests: Record<string, PluginTestResult> }
export interface PluginBindingView extends PluginSelection { revisionId: string | null }
export interface PluginChangeView extends PluginSelection { before: string | null; after: string | null }
export interface PluginImportResult {
  revision: PluginRevisionView
  activeCount: number
  conflicts: PluginSelection[]
}
export type PluginDeletionScope = 'revision' | 'package'
export interface PluginDeletionView {
  name: string
  version?: string
  revisionCount: number
}
export interface PluginAdminView {
  revisions: PluginRevisionView[]
  bindings: PluginBindingView[]
  changes: Array<{ id: string; createdAt: string; changes: PluginChangeView[]; deletion?: PluginDeletionView }>
}
