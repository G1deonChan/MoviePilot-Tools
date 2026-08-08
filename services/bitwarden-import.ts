import type { PtCredential, TotpSite } from '../core/types'
import type { CredentialSiteFill } from './credential-site'
import { parseOtpauthUri } from './totp'

interface BitwardenUri {
  uri?: unknown
}

interface BitwardenLogin {
  username?: unknown
  password?: unknown
  totp?: unknown
  uris?: unknown
}

interface BitwardenItem {
  type?: unknown
  name?: unknown
  creationDate?: unknown
  revisionDate?: unknown
  login?: unknown
}

interface BitwardenExport {
  encrypted?: unknown
  items?: unknown
}

interface ImportCandidate {
  name: string
  domain: string
  username: string
  password: string
  createdAt: string
  updatedAt: string
  hasValidRevisionDate: boolean
}

interface TotpCandidate {
  name: string
  domain: string
  uri: string
  createdAt: string
  updatedAt: string
  hasValidRevisionDate: boolean
}

export interface BitwardenTotpImportStats {
  eligible: number
  added: number
  updated: number
  keptExisting: number
  duplicateIncoming: number
  skippedInvalid: number
}

export interface BitwardenImportStats {
  total: number
  eligible: number
  added: number
  updated: number
  keptExisting: number
  duplicateIncoming: number
  skippedNonLogin: number
  skippedMissingLogin: number
  skippedMissingUsername: number
  skippedMissingPassword: number
  skippedMissingWebUri: number
}

export interface BitwardenImportDetail {
  name: string
  domain?: string
  maskedUsername?: string
  reason: string
}

export interface BitwardenImportResult {
  credentials: PtCredential[]
  totpSites: TotpSite[]
  stats: BitwardenImportStats
  totpStats: BitwardenTotpImportStats
  details: {
    duplicates: BitwardenImportDetail[]
    skipped: BitwardenImportDetail[]
    totpDuplicates: BitwardenImportDetail[]
    totpSkipped: BitwardenImportDetail[]
  }
}

export type ResolveCredentialSites = (
  inputs: Array<{ domain: string; name: string }>,
) => Promise<CredentialSiteFill[]>

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function validIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase()
}

function displayName(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '未命名凭据'
}

function credentialDetailName(value?: string): string {
  return value?.trim() || '未命名凭据'
}

export function maskCredentialUsername(value: string): string {
  const username = value.trim().toLowerCase()
  if (!username) return ''
  const at = username.indexOf('@')
  if (at > 0) {
    const local = username.slice(0, at)
    const domain = username.slice(at)
    return `${local.slice(0, Math.min(2, local.length))}${local.length > 2 ? '***' : '*'}${domain}`
  }
  if (username.length <= 2) return `${username[0] || ''}*`
  return `${username.slice(0, 2)}***${username.slice(-1)}`
}

export function normalizeCredentialOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.username = ''
    url.password = ''
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

export function credentialConflictKey(domain: string, username: string): string {
  try {
    const url = new URL(domain)
    const host = url.host.toLowerCase().replace(/^www\./, '')
    return `${host}::${normalizeUsername(username)}`
  } catch {
    return `${domain.trim().toLowerCase().replace(/^https?:\/\/(?:www\.)?/i, '')}::${normalizeUsername(username)}`
  }
}

function selectOrigin(uris: unknown): string | null {
  if (!Array.isArray(uris)) return null
  const candidates = uris
    .map((entry) => asRecord(entry as BitwardenUri)?.uri)
    .filter((value): value is string => typeof value === 'string')
    .map(normalizeCredentialOrigin)
    .filter((value): value is string => Boolean(value))
  const unique = [...new Set(candidates)]
  unique.sort((left, right) => {
    const a = new URL(left)
    const b = new URL(right)
    const protocolScore = Number(b.protocol === 'https:') - Number(a.protocol === 'https:')
    if (protocolScore) return protocolScore
    const wwwScore = Number(a.hostname.startsWith('www.')) - Number(b.hostname.startsWith('www.'))
    return wwwScore || left.localeCompare(right)
  })
  return unique[0] || null
}

function parseCandidates(text: string): {
  candidates: ImportCandidate[]
  totpCandidates: TotpCandidate[]
  stats: BitwardenImportStats
  skipped: BitwardenImportDetail[]
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('Bitwarden JSON 无法解析')
  }
  const root = asRecord(parsed) as BitwardenExport | null
  if (!root || typeof root.encrypted !== 'boolean' || !Array.isArray(root.items)) {
    throw new Error('不是有效的 Bitwarden JSON 导出文件')
  }
  if (root.encrypted) throw new Error('暂不支持 Bitwarden 加密 JSON，请导出未加密 JSON')

  const stats: BitwardenImportStats = {
    total: root.items.length,
    eligible: 0,
    added: 0,
    updated: 0,
    keptExisting: 0,
    duplicateIncoming: 0,
    skippedNonLogin: 0,
    skippedMissingLogin: 0,
    skippedMissingUsername: 0,
    skippedMissingPassword: 0,
    skippedMissingWebUri: 0,
  }
  const candidates: ImportCandidate[] = []
  const totpCandidates: TotpCandidate[] = []
  const skipped: BitwardenImportDetail[] = []
  const now = new Date().toISOString()

  for (const raw of root.items) {
    const item = asRecord(raw) as BitwardenItem | null
    const name = displayName(item?.name)
    if (!item || item.type !== 1) {
      stats.skippedNonLogin += 1
      skipped.push({ name, reason: '不是登录凭据' })
      continue
    }
    const login = asRecord(item.login) as BitwardenLogin | null
    if (!login) {
      stats.skippedMissingLogin += 1
      skipped.push({ name, reason: '缺少登录信息' })
      continue
    }
    const domain = selectOrigin(login.uris) || ''
    const validRevisionDate = validIso(item.revisionDate)
    const revisionDate = validRevisionDate || now
    const createdAt = validIso(item.creationDate) || revisionDate
    const totp = typeof login.totp === 'string' ? login.totp.trim() : ''
    if (totp) {
      totpCandidates.push({
        name: typeof item.name === 'string' ? item.name.trim() : '',
        domain,
        uri: totp,
        createdAt,
        updatedAt: revisionDate,
        hasValidRevisionDate: Boolean(validRevisionDate),
      })
    }

    const username = typeof login.username === 'string' ? login.username.trim() : ''
    if (!username) {
      stats.skippedMissingUsername += 1
      skipped.push({ name, reason: '缺少用户名' })
      continue
    }
    const password = typeof login.password === 'string' ? login.password : ''
    if (!password) {
      stats.skippedMissingPassword += 1
      skipped.push({ name, maskedUsername: maskCredentialUsername(username), reason: '缺少密码' })
      continue
    }
    if (!domain) {
      stats.skippedMissingWebUri += 1
      skipped.push({ name, maskedUsername: maskCredentialUsername(username), reason: '缺少有效网页地址' })
      continue
    }
    candidates.push({
      name: typeof item.name === 'string' ? item.name.trim() : '',
      domain,
      username,
      password,
      createdAt,
      updatedAt: revisionDate,
      hasValidRevisionDate: Boolean(validRevisionDate),
    })
    stats.eligible += 1
  }
  return { candidates, totpCandidates, stats, skipped }
}

function parseBitwardenTotp(value: string, fallbackName: string): Omit<TotpSite, 'id'> | null {
  const parsed = parseOtpauthUri(value)
  if (parsed) return parsed
  const secret = value.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z2-7]+=*$/.test(secret)) return null
  return {
    name: fallbackName || '未命名',
    secret,
    group: 'custom',
    category: 'custom',
  }
}

function totpConflictKey(site: Pick<TotpSite, 'domain' | 'url' | 'name'>): string {
  const name = site.name.trim().toLowerCase()
  const origin = normalizeCredentialOrigin(site.url || site.domain || '')
  if (origin) {
    const host = new URL(origin).hostname.toLowerCase().replace(/^www\./, '')
    return `domain:${host}::${name}`
  }
  return `name:${name}`
}

function mergeTotpSites(
  candidates: TotpCandidate[],
  fills: CredentialSiteFill[],
  existing: TotpSite[],
): {
  sites: TotpSite[]
  stats: BitwardenTotpImportStats
  duplicates: BitwardenImportDetail[]
  skipped: BitwardenImportDetail[]
} {
  const stats: BitwardenTotpImportStats = {
    eligible: 0,
    added: 0,
    updated: 0,
    keptExisting: 0,
    duplicateIncoming: 0,
    skippedInvalid: 0,
  }
  const duplicates: BitwardenImportDetail[] = []
  const skipped: BitwardenImportDetail[] = []
  const incoming = new Map<string, { site: TotpSite; hasValidRevisionDate: boolean }>()

  candidates.forEach((candidate, index) => {
    const parsed = parseBitwardenTotp(candidate.uri, candidate.name)
    if (!parsed) {
      stats.skippedInvalid += 1
      skipped.push({
        name: credentialDetailName(candidate.name),
        ...(candidate.domain ? { domain: candidate.domain } : {}),
        reason: 'TOTP 配置不是有效的 Base32 密钥或 otpauth URI',
      })
      return
    }
    const fill = fills[index]
    const totpCategory: NonNullable<TotpSite['category']> =
      fill?.category === 'pt' ? 'pt' : 'custom'
    const origin = candidate.domain || normalizeCredentialOrigin(parsed.url || parsed.domain || '') || ''
    const site: TotpSite = {
      ...parsed,
      id: crypto.randomUUID(),
      name: fill?.name || candidate.name || parsed.name,
      domain: origin ? new URL(origin).hostname : parsed.domain,
      url: origin || parsed.url,
      category: totpCategory,
      group: totpCategory,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
    }
    const key = totpConflictKey(site)
    const current = incoming.get(key)
    stats.eligible += 1
    if (!current) {
      incoming.set(key, { site, hasValidRevisionDate: candidate.hasValidRevisionDate })
      return
    }
    stats.duplicateIncoming += 1
    duplicates.push({
      name: site.name,
      ...(site.url ? { domain: site.url } : {}),
      reason: '导入文件内存在相同站点的 TOTP，已保留日期较新的条目',
    })
    if (
      candidate.hasValidRevisionDate &&
      (!current.hasValidRevisionDate || Date.parse(site.updatedAt || '') > Date.parse(current.site.updatedAt || ''))
    ) {
      incoming.set(key, { site, hasValidRevisionDate: true })
    }
  })

  const output = [...existing]
  const existingIndex = new Map<string, number>()
  output.forEach((site, index) => existingIndex.set(totpConflictKey(site), index))
  for (const [key, item] of incoming) {
    const index = existingIndex.get(key)
    if (index === undefined) {
      output.push(item.site)
      existingIndex.set(key, output.length - 1)
      stats.added += 1
      continue
    }
    const current = output[index]
    const incomingTime = Date.parse(item.site.updatedAt || '')
    const currentTime = Date.parse(current.updatedAt || '')
    if (
      item.hasValidRevisionDate &&
      Number.isFinite(incomingTime) &&
      (!Number.isFinite(currentTime) || incomingTime > currentTime)
    ) {
      output[index] = {
        ...item.site,
        id: current.id || item.site.id,
        createdAt: current.createdAt || item.site.createdAt,
      }
      stats.updated += 1
    } else {
      stats.keptExisting += 1
      duplicates.push({
        name: item.site.name,
        ...(item.site.url ? { domain: item.site.url } : {}),
        reason: item.hasValidRevisionDate
          ? '扩展中已有相同站点的 TOTP，现有配置日期更新或相同'
          : '扩展中已有相同站点的 TOTP，导入项缺少有效修改日期',
      })
    }
  }

  return { sites: output, stats, duplicates, skipped }
}

export async function importBitwardenCredentials(
  text: string,
  existing: PtCredential[],
  resolveSites: ResolveCredentialSites,
  existingTotpSites: TotpSite[] = [],
): Promise<BitwardenImportResult> {
  const { candidates, totpCandidates, stats, skipped } = parseCandidates(text)
  const duplicates: BitwardenImportDetail[] = []
  const siteInputs = [
    ...candidates.map((item) => ({ domain: item.domain, name: item.name })),
    ...totpCandidates.map((item) => ({ domain: item.domain, name: item.name })),
  ]
  const fills = await resolveSites(siteInputs)
  if (fills.length !== siteInputs.length) throw new Error('站点分类结果数量不一致')
  const credentialFills = fills.slice(0, candidates.length)
  const totp = mergeTotpSites(totpCandidates, fills.slice(candidates.length), existingTotpSites)

  const incoming = new Map<
    string,
    { credential: PtCredential; hasValidRevisionDate: boolean }
  >()
  candidates.forEach((candidate, index) => {
    const fill = credentialFills[index]
    const key = credentialConflictKey(candidate.domain, candidate.username)
    const credential: PtCredential = {
      id: crypto.randomUUID(),
      name: fill?.name || candidate.name || new URL(candidate.domain).hostname,
      domain: candidate.domain,
      username: candidate.username,
      password: candidate.password,
      category: fill?.category || 'custom',
      autoSaveEnabled: true,
      autoFillEnabled: true,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
    }
    const current = incoming.get(key)
    if (!current) {
      incoming.set(key, { credential, hasValidRevisionDate: candidate.hasValidRevisionDate })
      return
    }
    stats.duplicateIncoming += 1
    duplicates.push({
      name: credentialDetailName(credential.name),
      ...(credential.domain ? { domain: credential.domain } : {}),
      maskedUsername: maskCredentialUsername(credential.username),
      reason: '导入文件内存在相同站点和用户名，已保留日期较新的条目',
    })
    if (
      candidate.hasValidRevisionDate &&
      (!current.hasValidRevisionDate ||
        Date.parse(credential.updatedAt || '') > Date.parse(current.credential.updatedAt || ''))
    ) {
      incoming.set(key, { credential, hasValidRevisionDate: true })
    }
  })

  const output = [...existing]
  const existingIndex = new Map<string, number>()
  output.forEach((credential, index) => {
    existingIndex.set(credentialConflictKey(credential.domain, credential.username), index)
  })

  for (const [key, item] of incoming) {
    const { credential, hasValidRevisionDate } = item
    const index = existingIndex.get(key)
    if (index === undefined) {
      output.push(credential)
      existingIndex.set(key, output.length - 1)
      stats.added += 1
      continue
    }
    const current = output[index]
    const incomingTime = Date.parse(credential.updatedAt || '')
    const currentTime = Date.parse(current.updatedAt || '')
    if (
      hasValidRevisionDate &&
      Number.isFinite(incomingTime) &&
      (!Number.isFinite(currentTime) || incomingTime > currentTime)
    ) {
      output[index] = {
        ...credential,
        id: current.id || credential.id,
        createdAt: current.createdAt || credential.createdAt,
      }
      stats.updated += 1
    } else {
      stats.keptExisting += 1
      duplicates.push({
        name: credentialDetailName(credential.name),
        ...(credential.domain ? { domain: credential.domain } : {}),
        maskedUsername: maskCredentialUsername(credential.username),
        reason: hasValidRevisionDate
          ? '扩展中已有相同站点和用户名，现有凭据日期更新或相同'
          : '扩展中已有相同站点和用户名，导入项缺少有效修改日期',
      })
    }
  }

  return {
    credentials: output,
    totpSites: totp.sites,
    stats,
    totpStats: totp.stats,
    details: {
      duplicates,
      skipped,
      totpDuplicates: totp.duplicates,
      totpSkipped: totp.skipped,
    },
  }
}
