import { getPublicStore, updatePublicStore } from '../core/store-repository'
import type { SiteDomainAlias, SiteSupportingInfo } from '../core/types'
import { fetchSupportingSites } from './site-supporting'

export interface DomainAliasIndex {
  aliasesBySiteId: Map<string, string[]>
  siteIdsByDomain: Map<string, string[]>
}

export async function fetchSupportingDomains(force = false): Promise<Record<string, SiteSupportingInfo>> {
  return fetchSupportingSites(force)
}

function normalizeSiteId(value: string | number | undefined): string {
  return value == null ? '' : String(value).trim()
}

export function normalizeDomain(value: string): string {
  const input = value.trim()
  if (!input) return ''
  try {
    const source = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`
    return new URL(source).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return input
      .toLowerCase()
      .replace(/^[a-z][a-z\d+.-]*:\/\//i, '')
      .replace(/^www\./, '')
      .split(/[/?#:]/, 1)[0]
      .trim()
  }
}

function addDomain(index: DomainAliasIndex, siteId: string, domain: string) {
  const normalized = normalizeDomain(domain)
  if (!siteId || !normalized) return

  const aliases = index.aliasesBySiteId.get(siteId) || []
  if (!aliases.includes(normalized)) {
    aliases.push(normalized)
    index.aliasesBySiteId.set(siteId, aliases)
  }

  const siteIds = index.siteIdsByDomain.get(normalized) || []
  if (!siteIds.includes(siteId)) {
    siteIds.push(siteId)
    index.siteIdsByDomain.set(normalized, siteIds)
  }
}

export function buildDomainAliasIndex(
  supporting: Record<string, SiteSupportingInfo>,
  customAliases: SiteDomainAlias[] = [],
): DomainAliasIndex {
  const index: DomainAliasIndex = {
    aliasesBySiteId: new Map(),
    siteIdsByDomain: new Map(),
  }

  for (const [key, site] of Object.entries(supporting)) {
    const siteId = normalizeSiteId(site.id)
    if (!siteId) continue
    addDomain(index, siteId, key)
    addDomain(index, siteId, site.domain)
    addDomain(index, siteId, site.url || '')
  }

  for (const alias of customAliases) addDomain(index, normalizeSiteId(alias.siteId), alias.domain)
  return index
}

export function findSiteIdsByDomain(index: DomainAliasIndex, host: string): string[] {
  const normalized = normalizeDomain(host)
  if (!normalized) return []
  const exact = index.siteIdsByDomain.get(normalized)
  if (exact?.length) return [...exact]

  const matched = new Set<string>()
  for (const [domain, siteIds] of index.siteIdsByDomain) {
    if (normalized.endsWith(`.${domain}`) || domain.endsWith(`.${normalized}`)) {
      siteIds.forEach((siteId) => matched.add(siteId))
    }
  }
  return [...matched]
}

export function domainsMatch(host: string, domain: string): boolean {
  const normalizedHost = normalizeDomain(host)
  const normalizedDomain = normalizeDomain(domain)
  return Boolean(
    normalizedHost &&
      normalizedDomain &&
      (normalizedHost === normalizedDomain ||
        normalizedHost.endsWith(`.${normalizedDomain}`) ||
        normalizedDomain.endsWith(`.${normalizedHost}`)),
  )
}

export async function loadCustomDomainAliases(): Promise<SiteDomainAlias[]> {
  const store = await getPublicStore()
  const source = store.sites?.domainAliases
  if (!Array.isArray(source)) return []

  const unique = new Map<string, SiteDomainAlias>()
  for (const item of source) {
    const siteId = normalizeSiteId(item?.siteId)
    const domain = normalizeDomain(item?.domain || '')
    if (siteId && domain) unique.set(domain, { siteId, domain, createdAt: item.createdAt })
  }
  return [...unique.values()]
}

export async function saveCustomDomainAliases(aliases: SiteDomainAlias[]): Promise<void> {
  const unique = new Map<string, SiteDomainAlias>()
  for (const alias of aliases) {
    const siteId = normalizeSiteId(alias.siteId)
    const domain = normalizeDomain(alias.domain)
    if (siteId && domain) unique.set(domain, { siteId, domain, createdAt: alias.createdAt })
  }

  await updatePublicStore((store) => ({
    ...store,
    sites: {
      ...store.sites,
      domainAliases: [...unique.values()],
    },
  }))
}

export async function addCustomDomainAlias(siteId: string | number, domain: string): Promise<SiteDomainAlias> {
  const normalizedSiteId = normalizeSiteId(siteId)
  const normalizedDomain = normalizeDomain(domain)
  if (!normalizedSiteId || !normalizedDomain) throw new Error('请输入有效的备用域名')

  const aliases = await loadCustomDomainAliases()
  const existing = aliases.find((alias) => alias.domain === normalizedDomain)
  if (existing && existing.siteId !== normalizedSiteId) {
    throw new Error(`备用域名已绑定到其他站点：${existing.domain}`)
  }

  const next = existing || { siteId: normalizedSiteId, domain: normalizedDomain, createdAt: new Date().toISOString() }
  await saveCustomDomainAliases([...aliases.filter((alias) => alias.domain !== normalizedDomain), next])
  return next
}

export async function removeCustomDomainAlias(domain: string): Promise<void> {
  const normalizedDomain = normalizeDomain(domain)
  const aliases = await loadCustomDomainAliases()
  await saveCustomDomainAliases(aliases.filter((alias) => alias.domain !== normalizedDomain))
}

/**
 * 主域名切换成功后，同步交换本地备用域名关联。
 * 新主域名从备用列表移除，原主域名保留为该站点的备用域名。
 */
export async function swapPrimaryDomainAlias(
  siteId: string | number,
  primaryDomain: string,
  nextPrimaryDomain: string,
): Promise<void> {
  const normalizedSiteId = normalizeSiteId(siteId)
  const previous = normalizeDomain(primaryDomain)
  const next = normalizeDomain(nextPrimaryDomain)
  if (!normalizedSiteId || !previous || !next || previous === next) {
    throw new Error('主域名切换参数无效')
  }

  const aliases = await loadCustomDomainAliases()
  const nextAlias = aliases.find((alias) => alias.domain === next)
  if (nextAlias && nextAlias.siteId !== normalizedSiteId) {
    throw new Error(`备用域名已绑定到其他站点：${next}`)
  }

  const previousAlias = aliases.find((alias) => alias.domain === previous)
  if (previousAlias && previousAlias.siteId !== normalizedSiteId) {
    throw new Error(`原主域名已绑定到其他站点：${previous}`)
  }

  const retained = aliases.filter((alias) => alias.domain !== next)
  if (!previousAlias) {
    retained.push({
      siteId: normalizedSiteId,
      domain: previous,
      createdAt: new Date().toISOString(),
    })
  }
  await saveCustomDomainAliases(retained)
}
