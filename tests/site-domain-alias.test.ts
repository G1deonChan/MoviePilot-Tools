import { describe, expect, it } from 'vitest'
import type { SiteDomainAlias, SiteSupportingInfo } from '../core/types'
import {
  buildDomainAliasIndex,
  domainsMatch,
  findSiteIdsByDomain,
  normalizeDomain,
} from '../services/site-domain-alias'

const supporting: Record<string, SiteSupportingInfo> = {
  'hhanclub.net': { id: 21, name: '憨憨', domain: 'hhanclub.net', url: 'https://hhanclub.net/' },
  'hhan.club': { id: 21, name: '憨憨', domain: 'hhan.club', url: 'https://hhanclub.net/' },
  'cspt.cc': { id: 'cspt', name: '财神', domain: 'cspt.cc', url: 'https://cspt.cc/' },
  'cspt.top': { id: 'cspt', name: '财神', domain: 'cspt.top', url: 'https://cspt.cc/' },
}

const customAliases: SiteDomainAlias[] = [{ siteId: '21', domain: 'hhanclub.top' }]

describe('站点多域名映射', () => {
  it('规范化完整地址、端口、路径和 www 前缀', () => {
    expect(normalizeDomain(' https://www.HHANCLUB.TOP:8443/login.php?next=1 ')).toBe('hhanclub.top')
    expect(normalizeDomain('login.hhanclub.top:8443/path')).toBe('login.hhanclub.top')
  })

  it('按 supporting 相同站点 ID 聚合不同根域名', () => {
    const index = buildDomainAliasIndex(supporting)
    expect(findSiteIdsByDomain(index, 'hhanclub.net')).toEqual(['21'])
    expect(findSiteIdsByDomain(index, 'hhan.club')).toEqual(['21'])
    expect(findSiteIdsByDomain(index, 'cspt.top')).toEqual(['cspt'])
  })

  it('将自定义备用域名安全绑定到指定站点 ID', () => {
    const index = buildDomainAliasIndex(supporting, customAliases)
    expect(findSiteIdsByDomain(index, 'hhanclub.top')).toEqual(['21'])
    expect(findSiteIdsByDomain(index, 'login.hhanclub.top')).toEqual(['21'])
  })

  it('保留父子域名匹配，不将不同根域名直接视为相同', () => {
    expect(domainsMatch('pt.example.com', 'example.com')).toBe(true)
    expect(domainsMatch('hhanclub.net', 'hhanclub.top')).toBe(false)
  })
})
