import { bytesToBase64Url, sha256HexBytes } from '../core/crypto'
import { getPrivateStore, updatePrivateStore } from '../core/private-vault'

import { getPublicStore, updatePublicStore } from '../core/store-repository'
import { clearBackgroundAsset, exportBackgroundAsset, saveBackgroundAsset } from '../core/asset-repository'


import type { BackupContentId } from '../core/storage-contracts'

import { loadBackupKey } from './backup-key'
import { decryptBackupPayload, encryptBackupPayload } from './backup-envelope'
import type {
  BackupManifestV1,
  BackupPayloadV1,
  BackupProgressHandler,
  BinaryAsset,
  PortablePublicSettings,
  RestoreMode,
  WebDavSettingsBackup,
} from './backup-schema'
import { clearIconPack, exportIconPackZip, importIconPackFromZip } from './site-icon-pack'
import { clearOcrRuntime, exportOcrOfflinePackZip, importOcrOfflinePack } from './ocr-runtime'
import { ALARM, reconfigureAlarm } from '../core/alarms'

export type { BackupContentId } from '../core/storage-contracts'

export interface BackupSnapshotFile {
  name: 'backup.mpt2'
  type: 'encrypted'
  size: number
  content: string
  contentType: 'application/octet-stream'
  data: Uint8Array<ArrayBuffer>
}

export interface BackupSnapshotManifest extends BackupManifestV1 {
  files: Array<Pick<BackupSnapshotFile, 'name' | 'type' | 'size'>>
}

export interface BackupSnapshot {
  manifest: BackupSnapshotManifest
  files: BackupSnapshotFile[]
}

export const BACKUP_CONTENT_LABELS: Record<string, string> = {
  authAccounts: 'MoviePilot 账号',
  totp: '两步验证',
  credentials: '凭据',
  ocrCorrections: 'OCR 纠错词表',
  publicSettings: '公共设置',
  webdavSettings: 'WebDAV 备份设置',
  background: '自定义背景',
  iconPack: '高清图标包',
  ocrOfflinePack: '离线 OCR 模型包',
}

export interface BackupSnapshotSummary {
  id: string
  createdAt: string
  path: string
  manifestName: string
  contents: BackupContentId[]
  manifest: BackupSnapshotManifest
}

export function createBackupId(now = new Date()): string {
  return now.toISOString().replace(/[-:.]/g, '')
}

function contentIds(ids: BackupContentId[]): BackupManifestV1['contents'] {
  return [...new Set(ids)]
}

function bytesToData(bytes: ArrayBuffer): string {
  return bytesToBase64Url(new Uint8Array(bytes))
}

async function binaryAsset(name: string, mediaType: string, buffer: ArrayBuffer): Promise<BinaryAsset> {
  const bytes = new Uint8Array(buffer)
  return { name, mediaType, data: bytesToData(buffer), sha256: await sha256HexBytes(bytes) }
}

function portableSettings(publicStore: Awaited<ReturnType<typeof getPublicStore>>): PortablePublicSettings {
  const { schema, transient, automation, ...portable } = publicStore
  void schema
  void transient
  void automation
  return portable
}

function accountKey(account: { baseURL: string; username: string }): string {
  return `${account.baseURL.replace(/\/+$/, '').toLowerCase()}::${account.username.trim().toLowerCase()}`
}

function credentialKey(item: { domain?: string; username: string }): string {
  return `${(item.domain || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase()}::${item.username.trim().toLowerCase()}`
}

function mergeByKey<T>(current: T[], incoming: T[], keyOf: (item: T) => string): T[] {
  const merged = new Map(current.map((item) => [keyOf(item), item]))
  for (const item of incoming) merged.set(keyOf(item), item)
  return [...merged.values()]
}

export async function buildBackupSnapshot(
  ids: BackupContentId[],
  onProgress?: BackupProgressHandler,
): Promise<BackupSnapshot> {
  onProgress?.({ phase: 'validating', label: '正在检查备份配置', percent: 2, indeterminate: true })
  const selected = [...new Set(ids)]
  if (!selected.length) throw new Error('未选择备份内容')
  const recoveryKey = await loadBackupKey()
  if (!recoveryKey) throw new Error('请先生成或导入恢复密钥')

  const createdAt = new Date().toISOString()
  const id = createBackupId()

  onProgress?.({ phase: 'collecting', label: '正在收集备份数据', percent: 8, indeterminate: true })
  const privateStore = await getPrivateStore()
  const publicStore = await getPublicStore()
  const payload: BackupPayloadV1 = { schema: 1, createdAt }
  const data: NonNullable<BackupPayloadV1['data']> = {}
  const assets: NonNullable<BackupPayloadV1['assets']> = {}

  if (selected.includes('authAccounts') && privateStore.auth?.accounts.length) {
    data.authAccounts = privateStore.auth.accounts
  }
  if (selected.includes('credentials')) {
    if (privateStore.vault?.credentials?.length) data.credentials = privateStore.vault.credentials
    if (privateStore.vault?.credentialGroups?.length) {
      data.credentialGroups = privateStore.vault.credentialGroups
    }
  }
  if (selected.includes('totp') && privateStore.vault?.totp?.length) data.totp = privateStore.vault.totp
  if (selected.includes('ocrCorrections') && publicStore.ocr?.corrections) {
    data.ocrCorrections = publicStore.ocr.corrections
  }
  if (selected.includes('publicSettings')) data.publicSettings = portableSettings(publicStore)
  if (selected.includes('webdavSettings')) {
    const schedule = (publicStore.backup?.webdav || {}) as Partial<WebDavSettingsBackup>
    const secret = privateStore.services?.webdav
    data.webdavSettings = {
      enabled: !!schedule.enabled,
      url: secret?.url || '',
      path: schedule.path || '',
      username: secret?.username || '',
      password: secret?.password || '',
      autoEnabled: !!schedule.autoEnabled,
      intervalHours: schedule.intervalHours || 24,
      autoOnChange: !!schedule.autoOnChange,
      retainCount: Math.max(0, schedule.retainCount || 0),
      contents: schedule.contents || [],
    }
  }
  if (selected.includes('background')) {
    const background = await exportBackgroundAsset()
    if (background) assets.background = await binaryAsset(
      background.entry.name,
      background.entry.mediaType,
      background.data,
    )
  }
  if (selected.includes('iconPack')) {
    const buffer = await exportIconPackZip()
    if (buffer) assets.iconPack = await binaryAsset('icon-pack.zip', 'application/zip', buffer)
  }
  if (selected.includes('ocrOfflinePack')) {

    const buffer = await exportOcrOfflinePackZip()
    if (buffer) assets.ocrOfflinePack = await binaryAsset('ocr-offline-pack.zip', 'application/zip', buffer)
  }
  if (Object.keys(data).length) payload.data = data
  if (Object.keys(assets).length) payload.assets = assets

  onProgress?.({ phase: 'packing', label: '正在压缩并加密备份', percent: 28, indeterminate: true })
  const content = await encryptBackupPayload(payload, recoveryKey, id)
  const bytes = new TextEncoder().encode(content)
  const file: BackupSnapshotFile = {
    name: 'backup.mpt2',
    type: 'encrypted',
    size: bytes.byteLength,
    content,
    contentType: 'application/octet-stream',
    data: bytes as Uint8Array<ArrayBuffer>,
  }

  onProgress?.({ phase: 'packing', label: '正在校验备份文件', percent: 36, indeterminate: true })
  const manifest: BackupSnapshotManifest = {
    format: 'mpt2-backup-manifest',
    version: 1,
    id,
    createdAt,
    appVersion: __APP_VERSION__,
    keyId: recoveryKey.split('.')[1],
    size: file.size,
    sha256: await sha256HexBytes(bytes),
    contents: contentIds(selected),
    files: [{ name: file.name, type: file.type, size: file.size }],
  }
  onProgress?.({
    phase: 'packing',
    label: '备份文件已生成',
    percent: 40,
    totalBytes: file.size,
    currentFile: file.name,
  })
  return { manifest, files: [file] }
}

export function parseBackupManifest(text: string): BackupSnapshotManifest {
  const manifest = JSON.parse(text) as BackupSnapshotManifest
  if (
    manifest.format !== 'mpt2-backup-manifest' || manifest.version !== 1 || !manifest.id ||
    !manifest.createdAt || !manifest.appVersion || !/^[0-9a-f]{16}$/.test(manifest.keyId) ||
    !/^[0-9a-f]{64}$/.test(manifest.sha256) || !Array.isArray(manifest.contents) ||
    manifest.files?.length !== 1 || manifest.files[0].name !== 'backup.mpt2' ||
    manifest.files[0].type !== 'encrypted' || manifest.files[0].size !== manifest.size
  ) throw new Error('备份清单格式不正确')
  return manifest
}

export function snapshotSummary(
  manifest: BackupSnapshotManifest,
  manifestName: string,
): BackupSnapshotSummary {
  const contents = [...manifest.contents]
  return { id: manifest.id, createdAt: manifest.createdAt, path: manifestName, manifestName, contents, manifest }
}

function dataToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)) as Uint8Array<ArrayBuffer>
}

interface PreparedAsset {
  kind: 'background' | 'iconPack' | 'ocrOfflinePack'
  bytes: Uint8Array<ArrayBuffer>
  mediaType: string
}

async function prepareAsset(
  kind: PreparedAsset['kind'],
  asset: BinaryAsset | undefined,
): Promise<PreparedAsset | null> {
  if (!asset) return null
  const bytes = dataToBytes(asset.data)
  if ((await sha256HexBytes(bytes)) !== asset.sha256) throw new Error(`${asset.name} 校验失败`)
  return { kind, bytes, mediaType: asset.mediaType }
}

export async function prepareRestore(
  file: BackupSnapshotFile,
  selected: BackupContentId[],
  manifest?: BackupSnapshotManifest,
  onProgress?: BackupProgressHandler,
): Promise<{ payload: BackupPayloadV1; selected: BackupContentId[]; assets: PreparedAsset[] }> {
  onProgress?.({ phase: 'verifying', label: '正在校验备份文件', percent: 58, indeterminate: true, totalBytes: file.size, currentFile: file.name })
  if (file.name !== 'backup.mpt2' || file.type !== 'encrypted') throw new Error('仅支持新版 backup.mpt2')
  if (manifest) {
    if (file.size !== manifest.size || file.data.byteLength !== manifest.size) throw new Error('备份文件大小不匹配')
    if ((await sha256HexBytes(file.data)) !== manifest.sha256) throw new Error('备份文件 SHA-256 校验失败')
  }
  const recoveryKey = await loadBackupKey()
  if (!recoveryKey) throw new Error('请先导入恢复密钥')
  onProgress?.({ phase: 'decrypting', label: '正在解密备份数据', percent: 68, indeterminate: true, totalBytes: file.size, currentFile: file.name })
  const payload = await decryptBackupPayload(file.content, recoveryKey)
  const wanted = [...new Set(selected)]
  onProgress?.({ phase: 'verifying', label: '正在校验备份资源', percent: 74, indeterminate: true, currentFile: file.name })
  const assets = (await Promise.all([
    wanted.includes('background') ? prepareAsset('background', payload.assets?.background) : null,
    wanted.includes('iconPack') ? prepareAsset('iconPack', payload.assets?.iconPack) : null,
    wanted.includes('ocrOfflinePack') ? prepareAsset('ocrOfflinePack', payload.assets?.ocrOfflinePack) : null,
  ])).filter((item): item is PreparedAsset => !!item)
  return { payload, selected: wanted, assets }
}

export async function applyPreparedRestore(
  prepared: Awaited<ReturnType<typeof prepareRestore>>,
  mode: RestoreMode = 'replace',
  onProgress?: BackupProgressHandler,
): Promise<void> {
  onProgress?.({ phase: 'restoring', label: '正在准备本地还原', percent: 78, indeterminate: true })
  const { payload, selected, assets } = prepared
  const currentPrivate = await getPrivateStore()
  const currentPublic = await getPublicStore()
  const previousBackground = await exportBackgroundAsset()
  const previousIconPack = await exportIconPackZip()
  const previousOcrPack = await exportOcrOfflinePackZip()

  const incomingAccounts = payload.data?.authAccounts || []
  const incomingCredentials = payload.data?.credentials || []
  const incomingCredentialGroups = payload.data?.credentialGroups || []
  const incomingTotp = payload.data?.totp || []
  const incomingCorrections = payload.data?.ocrCorrections || {}
  const nextAccounts = mode === 'merge'
    ? mergeByKey(currentPrivate.auth?.accounts || [], incomingAccounts, accountKey)
    : incomingAccounts
  const nextCredentials = mode === 'merge'
    ? mergeByKey(currentPrivate.vault?.credentials || [], incomingCredentials, credentialKey)
    : incomingCredentials
  const nextCredentialGroups = mode === 'merge'
    ? mergeByKey(
        currentPrivate.vault?.credentialGroups || [],
        incomingCredentialGroups,
        (item) => item.id,
      )
    : incomingCredentialGroups
  const nextTotp = mode === 'merge'
    ? mergeByKey(currentPrivate.vault?.totp || [], incomingTotp, (item) => item.id || item.name.trim().toLowerCase())
    : incomingTotp

  try {
    if (assets.length) {
      onProgress?.({ phase: 'restoring', label: '正在恢复本地资源', percent: 84, indeterminate: true })
    }
    for (const asset of assets) {
      if (asset.kind === 'background') await saveBackgroundAsset(bytesToDataUrl(asset.bytes, asset.mediaType))
      else if (asset.kind === 'iconPack') await importIconPackFromZip(asset.bytes.buffer)
      else await importOcrOfflinePack(new File([asset.bytes], 'ocr-offline-backup.zip', { type: 'application/zip' }))
    }
    onProgress?.({ phase: 'restoring', label: '正在恢复账号与凭据数据', percent: 90, indeterminate: true })
    await updatePrivateStore((draft) => {
      if (selected.includes('authAccounts')) {
        draft.auth = nextAccounts.length ? { accounts: nextAccounts } : undefined
      }
      if (selected.includes('credentials') || selected.includes('totp')) {
        draft.vault = { ...(draft.vault || {}) }
        if (selected.includes('credentials')) {
          draft.vault.credentials = nextCredentials
          draft.vault.credentialGroups = nextCredentialGroups
        }
        if (selected.includes('totp')) draft.vault.totp = nextTotp
      }
      if (selected.includes('webdavSettings') && payload.data?.webdavSettings) {
        const settings = payload.data.webdavSettings
        draft.services = {
          ...(draft.services || {}),
          webdav: { url: settings.url, username: settings.username, password: settings.password },
        }
      }
    })
    onProgress?.({ phase: 'restoring', label: '正在恢复公共设置', percent: 95, indeterminate: true })
    await updatePublicStore((draft) => {
      if (selected.includes('publicSettings') && payload.data?.publicSettings) {
        const portable = structuredClone(payload.data.publicSettings)
        Object.assign(draft, portable, { schema: 1 })
      }
      if (selected.includes('ocrCorrections')) {
        draft.ocr = { ...(draft.ocr || {}) }
        draft.ocr.corrections = mode === 'merge'
          ? { ...(draft.ocr.corrections || {}), ...incomingCorrections }
          : incomingCorrections
      }
      if (selected.includes('webdavSettings') && payload.data?.webdavSettings) {
        const settings = payload.data.webdavSettings
        draft.backup = {
          ...(draft.backup || {}),
          webdav: {
            enabled: settings.enabled || undefined,
            path: settings.path || undefined,
            autoEnabled: settings.autoEnabled || undefined,
            intervalHours: settings.intervalHours,
            autoOnChange: settings.autoOnChange || undefined,
            retainCount: settings.retainCount,
            contents: settings.contents,
          } as never,
        }
      }
    })
    if (selected.includes('webdavSettings') && payload.data?.webdavSettings) {
      const settings = payload.data.webdavSettings
      onProgress?.({ phase: 'restoring', label: '正在恢复 WebDAV 备份设置', percent: 97, indeterminate: true })
      await reconfigureAlarm(
        ALARM.WEBDAV_BACKUP,
        settings.enabled && settings.autoEnabled,
        Math.max(1, settings.intervalHours * 60),
      )
    }
  } catch (error) {
    await updatePrivateStore(() => currentPrivate).catch(() => undefined)
    await updatePublicStore(() => currentPublic).catch(() => undefined)
    await clearBackgroundAsset().catch(() => undefined)
    if (previousBackground) {
      await saveBackgroundAsset(bytesToDataUrl(new Uint8Array(previousBackground.data), previousBackground.entry.mediaType)).catch(() => undefined)
    }
    await clearIconPack().catch(() => undefined)
    if (previousIconPack) await importIconPackFromZip(previousIconPack).catch(() => undefined)
    await clearOcrRuntime().catch(() => undefined)
    if (previousOcrPack) {
      await importOcrOfflinePack(new File([previousOcrPack], 'ocr-offline-rollback.zip', { type: 'application/zip' })).catch(() => undefined)
    }
    throw error
  }
}

function bytesToDataUrl(bytes: Uint8Array, mediaType: string): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return `data:${mediaType};base64,${btoa(binary)}`
}

export async function restoreSnapshotFile(
  file: BackupSnapshotFile,
  selected: BackupContentId[],
  mode: RestoreMode = 'replace',
  manifest?: BackupSnapshotManifest,
  onProgress?: BackupProgressHandler,
): Promise<void> {
  const prepared = await prepareRestore(file, selected, manifest, onProgress)
  await applyPreparedRestore(prepared, mode, onProgress)
  onProgress?.({ phase: 'completed', label: '还原完成', percent: 100 })
}
