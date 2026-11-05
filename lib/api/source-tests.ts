import { apiDelete, apiGet, apiPost, apiPut } from './client'
import type { SourceTestDraft, TestSamples } from '@/lib/source-testing/types'
import type { SourceConfig } from '@/lib/types/music'

const BASE = 'admin/source-tests'
export const loadTestSamples = (): Promise<TestSamples> => apiGet(`${BASE}/samples`)
export const saveTestSamples = (samples: TestSamples): Promise<TestSamples> => apiPut(`${BASE}/samples`, samples)
export const listSourceTests = (): Promise<{ list: SourceTestDraft[]; pending: SourceTestDraft[] }> => apiGet(BASE)
export const getSourceTest = (id: string): Promise<SourceTestDraft> => apiGet(`${BASE}/${id}`)
export const createSourceTest = (sourcePath: string): Promise<SourceTestDraft> => apiPost(BASE, { sourcePath, preview: true })
export const startSourceTest = (sourcePath: string, hash: string, mode: 'quick' | 'full', keys?: string[]): Promise<SourceTestDraft> => apiPost(BASE, { action: 'run', sourcePath, hash, mode, keys })
export const runSourceTest = (id: string, mode: 'quick' | 'full', keys?: string[]): Promise<SourceTestDraft> => apiPost(`${BASE}/${id}`, { action: 'run', mode, keys })
export const cancelSourceTest = (id: string): Promise<{ ok: true }> => apiPost(`${BASE}/${id}`, { action: 'cancel' })
export const discardSourceTest = (id: string): Promise<{ ok: true }> => apiDelete(`${BASE}/${id}`)
export const commitSourceTest = (id: string, pt: string[], enabled: boolean): Promise<SourceConfig> => apiPost(`${BASE}/${id}`, { action: 'commit', pt, enabled })
