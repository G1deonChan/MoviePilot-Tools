import { beforeEach, describe, expect, it, vi } from 'vitest'

const values = new Map<string, unknown>()

vi.mock('../core/storage', () => ({
  STORAGE_KEYS: {
    WEB_EMBED_FEATURES: 'virtual:webEmbed',
    OCR_LOCAL_ENABLED: 'virtual:ocr.localEnabled',
    LAST_VIEW: 'virtual:navigation.lastView',
  },
  storageGet: vi.fn(async (key: string) => structuredClone(values.get(key) ?? null)),
  storageSet: vi.fn(async (key: string, value: unknown) => { values.set(key, structuredClone(value)) }),
}))

import {
  DEFAULT_WEB_EMBED_FEATURES,
  getWebEmbedFeaturesConfig,
  saveWebEmbedFeaturesConfig,
} from '../core/web-embed-features'

describe('WEB 嵌入页面保持设置', () => {
  beforeEach(() => values.clear())

  it('默认关闭，不改变原有站点管理启动行为', async () => {
    expect((await getWebEmbedFeaturesConfig()).pageKeepEnabled).toBe(false)
  })

  it('开启时保存页面保持配置', async () => {
    await saveWebEmbedFeaturesConfig({ ...DEFAULT_WEB_EMBED_FEATURES, pageKeepEnabled: true })
    expect((values.get('virtual:webEmbed') as { pageKeepEnabled?: boolean }).pageKeepEnabled).toBe(true)
  })

  it('关闭时将最后页面重置为站点管理', async () => {
    values.set('virtual:navigation.lastView', 'settings')
    await saveWebEmbedFeaturesConfig({ ...DEFAULT_WEB_EMBED_FEATURES, pageKeepEnabled: false })
    expect(values.get('virtual:navigation.lastView')).toBe('sites')
  })
})
