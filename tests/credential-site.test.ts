import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/site-domain-alias', () => ({
  buildDomainAliasIndex: vi.fn(() => new Map()),
  fetchSupportingDomains: vi.fn(async () => ({})),
  findSiteIdsByDomain: vi.fn(() => []),
  loadCustomDomainAliases: vi.fn(async () => []),
  normalizeDomain: vi.fn((value: string) => value),
}))

vi.mock('../services/site-manage', () => ({
  loadStoredSites: vi.fn(async () => []),
}))

vi.mock('../services/site-icon', () => ({
  loadSupportingForIcons: vi.fn(async () => ({})),
  matchSupportingDomain: vi.fn(() => ''),
}))

vi.mock('../services/site-icon-pack', () => ({
  normalizeHost: vi.fn((value: string) => {
    try {
      return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname
    } catch {
      return ''
    }
  }),
}))

import {
  createCredentialSiteBatchResolver,
  resolveCredentialSiteFill,
} from '../services/credential-site'
import { fetchSupportingDomains } from '../services/site-domain-alias'
import { loadStoredSites } from '../services/site-manage'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('凭据站点内网分类', () => {
  it('单站点内网地址归入内网分组', async () => {
    await expect(resolveCredentialSiteFill('http://192.168.1.10:5000', '家庭 NAS')).resolves.toEqual({
      category: 'intranet',
      name: '家庭 NAS',
      isPt: false,
    })
    expect(fetchSupportingDomains).not.toHaveBeenCalled()
    expect(loadStoredSites).not.toHaveBeenCalled()
  })

  it('批量分类同时识别内网和公网自定义站点', async () => {
    const resolve = createCredentialSiteBatchResolver()
    const result = await resolve([
      { domain: 'https://nas.local/login', name: 'NAS' },
      { domain: 'https://example.com/login', name: 'Example' },
    ])

    expect(result).toEqual([
      { category: 'intranet', name: 'NAS', isPt: false },
      { category: 'custom', name: 'Example', isPt: false },
    ])
  })
})
