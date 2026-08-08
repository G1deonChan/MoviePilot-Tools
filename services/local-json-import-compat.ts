import type { CredentialGroup, PtCredential, SiteBlacklistEntry, TotpSite } from '../core/types'
import { isPrivateHost } from '../utils/url'
import { b64ToBuf, decodeUtf8, deriveAesKey } from '../core/crypto'
import {
  decryptLocalJsonWithSavedKey,
  inspectLocalJsonEnvelope,
  type CredentialsLocalJsonPayload,
  type LocalJsonDataType,
  type TotpLocalJsonPayload,
} from './local-json-envelope'

const LEGACY_PASSWORD_PREFIX = 'mp-ext-pt-backup-v1'
const MIN_ITERATIONS = 100_000
const MAX_ITERATIONS = 1_000_000

interface LegacyEnvelopeV2 {
  type: 'pt-credentials-backup' | 'totp-backup'
  version: 2
  algorithm: 'AES-GCM'
  kdf: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  iv: string
  ciphertext: string
}

interface LegacyCredentialsPayload {
  credentials: PtCredential[]
  credentialGroups?: CredentialGroup[]
  blacklist?: SiteBlacklistEntry[]
  exportedAt?: string
}

interface LegacyTotpSite {
  name?: string
  secret?: string
  url?: string
  icon?: string
  color?: string
  category?: 'pt' | 'custom'
}

interface LegacyTotpPayload {
  version?: string
  sites: LegacyTotpSite[]
  exportedAt?: string
}

export type LocalJsonImportFormat =
  | 'mpt2-v1'
  | 'legacy-credentials-v2'
  | 'legacy-totp-v2'
  | 'unsupported'

export interface LocalJsonImportInspection {
  format: LocalJsonImportFormat
  type?: LocalJsonDataType
  needsLegacyPassword: boolean
}

export type LocalJsonImportResult =
  | {
      type: 'credentials'
      source: 'mpt2-v1' | 'legacy-credentials-v2'
      payload: CredentialsLocalJsonPayload
      warnings: string[]
    }
  | {
      type: 'totp'
      source: 'mpt2-v1' | 'legacy-totp-v2'
      payload: TotpLocalJsonPayload
      warnings: string[]
    }

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error('本地 JSON 文件格式不正确')
  }
}

function isLegacyEnvelope(value: unknown): value is LegacyEnvelopeV2 {
  if (!value || typeof value !== 'object') return false
  const envelope = value as Partial<LegacyEnvelopeV2>
  return (
    (envelope.type === 'pt-credentials-backup' || envelope.type === 'totp-backup') &&
    envelope.version === 2 &&
    envelope.algorithm === 'AES-GCM' &&
    envelope.kdf === 'PBKDF2-SHA256' &&
    typeof envelope.iterations === 'number' &&
    typeof envelope.salt === 'string' &&
    typeof envelope.iv === 'string' &&
    typeof envelope.ciphertext === 'string'
  )
}

export function inspectLocalJsonImport(text: string): LocalJsonImportInspection {
  const current = inspectLocalJsonEnvelope(text)
  if (current.encrypted) {
    return { format: 'mpt2-v1', type: current.type, needsLegacyPassword: false }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return { format: 'unsupported', needsLegacyPassword: false }
  }
  if (!isLegacyEnvelope(parsed)) return { format: 'unsupported', needsLegacyPassword: false }
  return parsed.type === 'pt-credentials-backup'
    ? { format: 'legacy-credentials-v2', type: 'credentials', needsLegacyPassword: true }
    : { format: 'legacy-totp-v2', type: 'totp', needsLegacyPassword: true }
}

async function decryptLegacyEnvelope(text: string, password: string): Promise<unknown> {
  if (!password.trim()) throw new Error('请输入旧版备份密钥')
  const envelope = parseJson(text)
  if (!isLegacyEnvelope(envelope)) throw new Error('旧版加密文件格式不正确')
  if (envelope.iterations < MIN_ITERATIONS || envelope.iterations > MAX_ITERATIONS) {
    throw new Error('旧版加密文件的密钥迭代次数不受支持')
  }
  let salt: Uint8Array
  let iv: Uint8Array
  let ciphertext: Uint8Array
  try {
    salt = b64ToBuf(envelope.salt)
    iv = b64ToBuf(envelope.iv)
    ciphertext = b64ToBuf(envelope.ciphertext)
  } catch {
    throw new Error('旧版加密文件编码不正确')
  }
  if (salt.byteLength < 16 || iv.byteLength !== 12 || ciphertext.byteLength < 16) {
    throw new Error('旧版加密文件参数不正确')
  }
  try {
    const key = await deriveAesKey(
      `${LEGACY_PASSWORD_PREFIX}:${password}`,
      salt,
      envelope.iterations,
    )
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    )
    return JSON.parse(decodeUtf8(new Uint8Array(plaintext))) as unknown
  } catch {
    throw new Error('旧版备份密钥不正确或文件已损坏')
  }
}

function normalizeDate(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString()
}

function normalizeCredentialPayload(value: unknown): CredentialsLocalJsonPayload {
  if (!value || typeof value !== 'object') throw new Error('旧版凭据数据结构不正确')
  const payload = value as Partial<LegacyCredentialsPayload>
  if (!Array.isArray(payload.credentials)) throw new Error('旧版凭据数据结构不正确')
  const now = new Date().toISOString()
  const credentials = payload.credentials
    .filter((item) => item && typeof item.domain === 'string' && typeof item.username === 'string')
    .map((item) => ({
      ...item,
      id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
      domain: item.domain.trim(),
      username: item.username.trim(),
      password: typeof item.password === 'string' ? item.password : '',
      category:
        item.category === 'pt' || item.category === 'intranet' || item.category === 'custom'
          ? item.category
          : isPrivateHost(item.domain)
            ? 'intranet' as const
            : 'pt' as const,
      createdAt: normalizeDate(item.createdAt, now),
      updatedAt: normalizeDate(item.updatedAt, now),
    }))
    .filter((item) => Boolean(item.domain))
  const credentialGroups = (Array.isArray(payload.credentialGroups) ? payload.credentialGroups : [])
    .flatMap((item): CredentialGroup[] => {
      const id = typeof item?.id === 'string' ? item.id.trim() : ''
      const name = typeof item?.name === 'string' ? item.name.trim() : ''
      if (!id || !name) return []
      return [{
        id,
        name,
        createdAt: normalizeDate(item.createdAt, now),
        updatedAt: normalizeDate(item.updatedAt, now),
      }]
    })
  const blacklist = (Array.isArray(payload.blacklist) ? payload.blacklist : [])
    .filter((item) => item && typeof item.domain === 'string' && item.domain.trim())
    .map((item) => ({
      id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
      domain: item.domain.trim(),
      name: typeof item.name === 'string' ? item.name : undefined,
      blockLoginFill: item.blockLoginFill === true,
      blockCaptchaFill: item.blockCaptchaFill === true,
      blockCredentialSavePrompt: item.blockCredentialSavePrompt === true,
      createdAt: normalizeDate(item.createdAt, now),
      updatedAt: normalizeDate(item.updatedAt, now),
    }))
  return {
    version: 1,
    exportedAt: normalizeDate(payload.exportedAt, now),
    credentials,
    credentialGroups,
    blacklist,
  }
}

function normalizeTotpPayload(value: unknown): {
  payload: TotpLocalJsonPayload
  warnings: string[]
} {
  if (!value || typeof value !== 'object') throw new Error('旧版两步验证数据结构不正确')
  const legacy = value as Partial<LegacyTotpPayload>
  if (!Array.isArray(legacy.sites)) throw new Error('旧版两步验证数据结构不正确')
  const now = new Date().toISOString()
  let ignoredColors = 0
  const sites = legacy.sites.flatMap((item): TotpSite[] => {
    const secret = typeof item.secret === 'string' ? item.secret.replace(/\s/g, '').toUpperCase() : ''
    if (!secret || !/^[A-Z2-7]+=*$/.test(secret)) return []
    const url = typeof item.url === 'string' ? item.url.trim() : ''
    let domain = ''
    if (url) {
      try {
        const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') domain = parsed.hostname.replace(/^www\./i, '')
      } catch {
        domain = ''
      }
    }
    if (item.color) ignoredColors += 1
    const name = typeof item.name === 'string' && item.name.trim()
      ? item.name.trim()
      : domain || '未命名'
    const icon = typeof item.icon === 'string' && /^(https?:|data:)/i.test(item.icon)
      ? item.icon
      : undefined
    return [{
      id: crypto.randomUUID(),
      name,
      secret,
      url: url || undefined,
      domain: domain || undefined,
      icon,
      category: item.category === 'custom' || !domain ? 'custom' : 'pt',
      createdAt: now,
      updatedAt: now,
    }]
  })
  return {
    payload: {
      version: 1,
      exportedAt: normalizeDate(legacy.exportedAt, now),
      sites,
    },
    warnings: ignoredColors ? [`已忽略 ${ignoredColors} 条旧版颜色字段`] : [],
  }
}

export async function importCompatibleLocalJson(
  text: string,
  expectedType: LocalJsonDataType,
  legacyPassword?: string,
): Promise<LocalJsonImportResult> {
  const inspection = inspectLocalJsonImport(text)
  if (inspection.format === 'unsupported') throw new Error('不支持的本地 JSON 文件格式')
  if (inspection.type !== expectedType) {
    throw new Error(expectedType === 'credentials' ? '请选择凭据备份文件' : '请选择两步验证备份文件')
  }
  if (inspection.format === 'mpt2-v1') {
    const payload = await decryptLocalJsonWithSavedKey(text, expectedType)
    return expectedType === 'credentials'
      ? { type: 'credentials', source: 'mpt2-v1', payload: payload as CredentialsLocalJsonPayload, warnings: [] }
      : { type: 'totp', source: 'mpt2-v1', payload: payload as TotpLocalJsonPayload, warnings: [] }
  }
  const plaintext = await decryptLegacyEnvelope(text, legacyPassword || '')
  if (expectedType === 'credentials') {
    return {
      type: 'credentials',
      source: 'legacy-credentials-v2',
      payload: normalizeCredentialPayload(plaintext),
      warnings: [],
    }
  }
  const normalized = normalizeTotpPayload(plaintext)
  return {
    type: 'totp',
    source: 'legacy-totp-v2',
    payload: normalized.payload,
    warnings: normalized.warnings,
  }
}
