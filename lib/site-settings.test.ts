import { describe, expect, it } from 'vitest'
import { DEFAULT_SITE_SETTINGS, parseSiteSettings, SiteSettingsError } from './site-settings'

describe('公开站点设置契约', () => {
  it('默认品牌、去除空白、空简介与字段白名单', () => {
    expect(DEFAULT_SITE_SETTINGS).toEqual({ name: 'Holly Music', description: '把时间交给音乐' })
    expect(parseSiteSettings({ name: '  我的音乐  ', description: '   ', secret: 'private' })).toEqual({ name: '我的音乐', description: '' })
    expect(parseSiteSettings({ name: '<script> & "音乐"', description: '纯文本' }).name).toBe('<script> & "音乐"')
  })
  it.each([
    null, [], {}, { name: '', description: '' }, { name: '   ', description: '' },
    { name: 'a'.repeat(101), description: '' }, { name: '站点', description: 'a'.repeat(201) },
    { name: '站\n点', description: '' }, { name: '站点', description: '\u0000' },
    { name: 123, description: '' }, { name: '站点', description: null },
  ])('拒绝无效设置 %j', value => {
    expect(() => parseSiteSettings(value)).toThrow(SiteSettingsError)
  })
})
