import type { CredentialGroup, PtCredential, Site, SiteDomainAlias, TotpSite } from './types'



export const STORE_SCHEMA_VERSION = 1 as const

export interface AesGcmBox {
  iv: string
  ciphertext: string
}

export interface LocalVaultEnvelopeV1 {
  format: 'mpt2-local-vault'
  version: 1
  keyId: string
  wrappedDek: AesGcmBox
  payload: AesGcmBox
}

export interface DeviceStoreV1 {
  schema: 1
  deviceId: string
  rootKey: string
  createdAt: string
  namespaceResetAt?: string
}

export type SiteFilterKey =
  | 'browser'
  | 'server'
  | 'cookieDiff'
  | 'uaDiff'
  | 'notLoggedIn'
  | 'notAdded'
  | 'notOwned'

export interface FloatPosition {
  top: number
  left?: number
  right?: number
}

export interface SiteAutoOpenPolicy {
  enabled?: true
  mode?: 'monthly' | 'manual'
  closeAfterSeconds?: number
}

export interface CookieUaPolicy {
  enabled?: true
  intervalHours?: number
  updateUa?: false
}

export interface OcrModelMetaStore {
  id: string
  name: string
  source?: string
  updatedAt?: string
}

export interface BackupSchedule {
  enabled?: true
  autoOnChange?: true
  intervalHours?: number
  retainCount?: number
  contents?: BackupContentId[]
}

export interface WebDavBackupSchedule extends BackupSchedule {
  path?: string
}

export interface PublicStoreV1 {
  schema: 1
  ui?: {
    theme?: string
    backgroundEnabled?: true
    floatPositions?: Record<string, FloatPosition>
  }
  credentials?: {
    autofill?: true
    autosave?: true
  }
  sites?: {
    filters?: Partial<Record<SiteFilterKey, true>>
    disabledIds?: number[]
    autoUpdateDisabledIds?: number[]
    favicons?: Record<string, string>
    autoOpen?: SiteAutoOpenPolicy
    cookieUa?: CookieUaPolicy
    privacyMode?: true
    blacklist?: SiteBlacklistStoreEntry[]
    domainAliases?: SiteDomainAlias[]
  }
  webEmbed?: Record<string, boolean>
  navigation?: {
    lastView?: string
  }
  ocr?: {
    localEnabled?: false
    serviceMode?: 'server' | 'ai'
    host?: string
    models?: OcrModelMetaStore[]
    selectedModelId?: string
    corrections?: Record<string, string>
  }
  backup?: {
    mp?: BackupSchedule
    webdav?: WebDavBackupSchedule
  }
  automation?: {
    cookieUaLastDaily?: string
    siteAutoOpenLastMonth?: string
  }
  transient?: {
    pendingRoute?: string
    filePickerView?: string
    ptDownloadTitle?: string
  }
  settings?: {
    customBackground?: Record<string, unknown>
    dailyWallpaperEnabled?: true
    lastDailyWallpaperDate?: string
    siteFilters?: SiteFilterKey[] | Partial<Record<SiteFilterKey | 'noSite', boolean>>
    sitePrivacyMode?: true
    allowedDomains?: string[]
    siteFaviconCache?: Record<string, unknown>
    ocrModels?: Record<string, unknown>
    ocrRuntimeMeta?: Record<string, unknown>
    ocrLocalEnabled?: false
    cookieUaConfig?: Record<string, unknown>
    siteAutoOpenConfig?: Record<string, unknown>
    siteAutoOpenTabs?: number[]
  }
}

export interface SiteBlacklistStoreEntry {
  id: string
  domain: string
  name?: string
  blockLoginFill?: true
  blockCaptchaFill?: true
  blockCredentialSavePrompt?: true
  createdAt?: string
  updatedAt?: string
}

export interface AuthUserProfile {
  superUser: boolean
  userID: number
  userName: string
  avatar: string
  level: number
  permissions: Record<string, boolean>
  wizard: boolean
}

export interface AuthAccountSecret {
  id: string
  label: string
  serverName?: string
  baseURL: string
  username: string
  password: string
  otpPassword?: string
  userInfo?: AuthUserProfile
  createdAt: number
  lastLoginAt?: number
}

export interface AuthSessionSecret {
  accountId: string
  token: string
  userInfo: AuthUserProfile
  updatedAt: number
}

export interface PrivateStoreV1 {
  schema: 1
  auth?: {
    activeAccountId?: string
    accounts: AuthAccountSecret[]
    session?: AuthSessionSecret
  }
  vault?: {
    credentials?: PtCredential[]
    credentialGroups?: CredentialGroup[]
    totp?: TotpSite[]
  }
  services?: {
    aiToken?: string
    webdav?: {
      url: string
      username: string
      password: string
    }
  }
  agent?: {
    state?: object
    history?: unknown[]
  }
  sites?: Site[]
  backup?: {
    rootKey: string
    keyId: string
  }
  security?: {
    pinSalt: string
    pinHash: string
    pinFrequency?: 'always'
  }
}

export interface AssetIndexEntry {
  id: string
  kind: 'background' | 'icon-pack' | 'ocr-model' | 'ocr-runtime'
  name: string
  mediaType: string
  size: number
  sha256: string
  updatedAt: string
}

export interface AssetsStoreV1 {
  schema: 1
  selectedBackgroundId?: string
  selectedIconPackId?: string
  selectedOcrModelId?: string
  entries?: AssetIndexEntry[]
}

export interface CacheEntry<T = unknown> {
  value: T
  expiresAt: number
}

export interface CacheStoreV1 {
  schema: 1
  entries?: Record<string, CacheEntry>
}

export type BackupContentId =
  | 'authAccounts'
  | 'credentials'
  | 'totp'
  | 'ocrCorrections'
  | 'publicSettings'
  | 'webdavSettings'
  | 'background'
  | 'iconPack'
  | 'ocrOfflinePack'

export type StoreDocument = PublicStoreV1 | PrivateStoreV1 | DeviceStoreV1 | AssetsStoreV1 | CacheStoreV1
