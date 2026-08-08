import type {
  BackupContentId,
  CacheStoreV1,
  PrivateStoreV1,
  PublicStoreV1,
  SiteFilterKey,
} from './storage-contracts'

export const STORED_SITE_FILTER_DEFAULTS: Readonly<Record<SiteFilterKey, boolean>> = Object.freeze({
  browser: true,
  server: true,
  cookieDiff: false,
  uaDiff: false,
  notLoggedIn: false,
  notAdded: false,
  notOwned: false,
})

export const DEFAULT_BACKUP_CONTENTS: readonly BackupContentId[] = Object.freeze([
  'authAccounts',
  'credentials',
  'totp',
  'ocrCorrections',
  'publicSettings',
])

export const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000
export const MAX_CACHE_ENTRIES = 100

export const MERGE_KEYS = Object.freeze({
  authAccounts: 'normalizedBaseURL+normalizedUsername',
  credentials: 'normalizedDomain+normalizedUsername',
  totp: 'id|normalizedName',
  ocrCorrections: 'sourceText',
} as const)

export const RESTORE_CONFLICT_POLICY = Object.freeze({
  authAccounts: 'newer-lastLoginAt',
  credentials: 'newer-updatedAt',
  totp: 'newer-updatedAt',
  ocrCorrections: 'incoming-wins',
  publicSettings: 'replace-only',
  webdavSettings: 'replace-only',
  assets: 'replace-selected-kind',
} as const)

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function stableValue(value: unknown, preserveWhitespace: boolean): unknown {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') {
    const next = preserveWhitespace ? value : value.trim()
    return next ? next : undefined
  }
  if (Array.isArray(value)) {
    const next = value
      .map((item) => stableValue(item, preserveWhitespace))
      .filter((item) => item !== undefined)
    return next.length ? next : undefined
  }
  if (isPlainObject(value)) {
    const next: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const keepWhitespace = preserveWhitespace || /password|token|secret|rootKey/i.test(key)
      const item = stableValue(value[key], keepWhitespace)
      if (item !== undefined) next[key] = item
    }
    return Object.keys(next).length ? next : undefined
  }
  return value
}

function omitDefaults(value: unknown, defaults: unknown): unknown {
  if (Array.isArray(value)) return value
  if (!isPlainObject(value)) return Object.is(value, defaults) ? undefined : value
  const defaultObject = isPlainObject(defaults) ? defaults : {}
  const next: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    const item = omitDefaults(value[key], defaultObject[key])
    if (item !== undefined) next[key] = item
  }
  return Object.keys(next).length ? next : undefined
}

export function compactValue<T>(value: T, defaults?: unknown): T | undefined {
  const compacted = stableValue(value, false)
  return omitDefaults(compacted, defaults) as T | undefined
}

export function compactPublicStore(store: PublicStoreV1): PublicStoreV1 | null {
  const compacted = compactValue(store, { schema: 1 }) as PublicStoreV1 | undefined
  if (!compacted || Object.keys(compacted).every((key) => key === 'schema')) return null
  return { ...compacted, schema: 1 }
}

export function compactPrivateStore(store: PrivateStoreV1): PrivateStoreV1 | null {
  const compacted = compactValue(store, { schema: 1 }) as PrivateStoreV1 | undefined
  if (!compacted || Object.keys(compacted).every((key) => key === 'schema')) return null
  return { ...compacted, schema: 1 }
}

export function pruneCache(store: CacheStoreV1, now = Date.now()): CacheStoreV1 | null {
  const entries = Object.fromEntries(
    Object.entries(store.entries || {})
      .filter(([, entry]) => entry.expiresAt > now)
      .sort((a, b) => b[1].expiresAt - a[1].expiresAt)
      .slice(0, MAX_CACHE_ENTRIES),
  )
  return Object.keys(entries).length ? { schema: 1, entries } : null
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value, true))
}
