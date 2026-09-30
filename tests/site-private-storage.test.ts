import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrivateStoreV1 } from '../core/storage-contracts'
import type { Site } from '../core/types'

let privateStore: PrivateStoreV1 = { schema: 1 }
const apiGet = vi.fn()

vi.mock('../core/private-vault', () => ({
  getPrivateStore: vi.fn(async () => structuredClone(privateStore)),
  updatePrivateStore: vi.fn(async (mutator: (draft: PrivateStoreV1) => void) => {
    const draft = structuredClone(privateStore)
    mutator(draft)
    privateStore = draft
    return structuredClone(privateStore)
  }),
}))

vi.mock('../core/http', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    put: vi.fn(),
    post: vi.fn(),
    del: vi.fn(),
  },
  unwrapApiData: (data: unknown) => {
    if (data && typeof data === 'object' && 'data' in (data as Record<string, unknown>)) {
      return (data as { data: unknown }).data
    }
    return data
  },
  readApiMessage: (data: unknown) => {
    if (!data || typeof data !== 'object') return ''
    const root = data as Record<string, unknown>
    const message = root.message_i18n ?? root.message ?? root.detail
    return typeof message === 'string' ? message.trim() : ''
  },
}))

import { fetchSites, loadStoredSites } from '../services/site-manage'

const site: Site = {
  id: 1,
  name: 'Example',
  domain: 'example.com',
  url: 'https://example.com',
  cookie: 'session=private-cookie',
  rss: 'https://example.com/rss',
  apikey: 'private-api-key',
  token: 'private-token',
}

describe('站点管理 Private Vault 存储', () => {
  beforeEach(() => {
    privateStore = { schema: 1 }
    apiGet.mockReset()
  })

  it('API 返回的 apikey、cookie、rss、url、domain 整体存入 Private Store', async () => {
    apiGet.mockResolvedValue({ ok: true, data: [site] })
    await expect(fetchSites()).resolves.toEqual([site])
    expect(privateStore.sites).toEqual([site])
    const text = JSON.stringify(privateStore.sites)
    expect(text).toContain('private-api-key')
    expect(text).toContain('private-cookie')
    expect(text).toContain('https://example.com/rss')
    expect(text).toContain('https://example.com')
    expect(text).toContain('example.com')
  })

  it('兼容 v3 包装响应中的 data 站点数组', async () => {
    apiGet.mockResolvedValue({ ok: true, data: { success: true, data: [site] } })
    await expect(fetchSites()).resolves.toEqual([site])
    expect(privateStore.sites).toEqual([site])
  })

  it('接口失败时只从 Private Store 加载站点配置', async () => {
    privateStore.sites = [site]
    apiGet.mockResolvedValue({ ok: false, data: null })
    await expect(fetchSites()).resolves.toEqual([site])
    await expect(loadStoredSites()).resolves.toEqual([site])
  })
})
