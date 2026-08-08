import type { CredentialGroup, PtCredential, TotpSite } from '../core/types'
import type { AesGcmBox, BackupContentId, PublicStoreV1 } from '../core/storage-contracts'

export const WEBDAV_BACKUP_CONTENT_OPTIONS = [
  { value: 'authAccounts', label: 'MoviePilot 账号' },
  { value: 'totp', label: '两步验证' },
  { value: 'credentials', label: '凭据' },
  { value: 'ocrCorrections', label: 'OCR 纠错词表' },
  { value: 'publicSettings', label: '公共设置' },
  { value: 'background', label: '自定义背景' },
  { value: 'iconPack', label: '高清图标包' },
  { value: 'ocrOfflinePack', label: '离线 OCR 模型包' },
] as const

export const MP_BACKUP_CONTENT_OPTIONS = [
  ...WEBDAV_BACKUP_CONTENT_OPTIONS,
  { value: 'webdavSettings', label: 'WebDAV 备份设置' },
] as const

export const BACKUP_CONTENT_OPTIONS = MP_BACKUP_CONTENT_OPTIONS

export type { BackupContentId } from '../core/storage-contracts'

export const DEFAULT_BACKUP_CONTENTS: BackupContentId[] = [
  'authAccounts',
  'totp',
  'credentials',
  'ocrCorrections',
  'publicSettings',
]

export function normalizeBackupContents(
  value: unknown,
  options: readonly { value: BackupContentId }[] = BACKUP_CONTENT_OPTIONS,
): BackupContentId[] {
  if (!Array.isArray(value)) return [...DEFAULT_BACKUP_CONTENTS]
  const allowed = new Set(options.map((item) => item.value))
  const normalized = value.filter(
    (item): item is BackupContentId =>
      typeof item === 'string' && allowed.has(item as BackupContentId),
  )
  return [...new Set(normalized)]
}

export interface BackupManifestV1 {
  format: 'mpt2-backup-manifest'
  version: 1
  id: string
  createdAt: string
  appVersion: string
  keyId: string
  size: number
  sha256: string
  contents: BackupContentId[]
}

export interface ExportedAuthAccount {
  id: string
  label: string
  baseURL: string
  username: string
  password: string
  otpPassword?: string
  createdAt: number
  lastLoginAt?: number
}

export type PortablePublicSettings = Omit<PublicStoreV1, 'schema' | 'transient' | 'automation'>

export interface WebDavSettingsBackup {
  enabled: boolean
  url: string
  path: string
  username: string
  password: string
  autoEnabled: boolean
  intervalHours: number
  autoOnChange: boolean
  retainCount: number
  contents: BackupContentId[]
}

export interface BinaryAsset {
  name: string
  mediaType: string
  data: string
  sha256: string
}

export interface BackupPayloadV1 {
  schema: 1
  createdAt: string
  data?: {
    authAccounts?: ExportedAuthAccount[]
    credentials?: PtCredential[]
    credentialGroups?: CredentialGroup[]
    totp?: TotpSite[]
    ocrCorrections?: Record<string, string>
    publicSettings?: PortablePublicSettings
    webdavSettings?: WebDavSettingsBackup
  }
  assets?: {
    background?: BinaryAsset
    iconPack?: BinaryAsset
    ocrOfflinePack?: BinaryAsset
  }
}

export interface BackupEnvelopeV1 {
  format: 'mpt2-backup'
  version: 1
  keyId: string
  snapshotId: string
  compression: 'gzip'
  wrappedDek: AesGcmBox
  payload: AesGcmBox
}

export type RestoreMode = 'replace' | 'merge'

export interface RestoreSelection {
  mode: RestoreMode
  contents: BackupContentId[]
}

export type BackupProgressPhase =
  | 'validating'
  | 'collecting'
  | 'packing'
  | 'uploading'
  | 'committing'
  | 'cleaning'
  | 'downloading'
  | 'verifying'
  | 'decrypting'
  | 'restoring'
  | 'completed'
  | 'failed'

export interface BackupProgress {
  phase: BackupProgressPhase
  label: string
  percent: number
  indeterminate?: boolean
  transferredBytes?: number
  totalBytes?: number
  chunkIndex?: number
  chunkCount?: number
  currentFile?: string
}

export type BackupProgressHandler = (progress: BackupProgress) => void
