// WebDAV 按内容分文件加密备份
import { STORAGE_KEYS, storageGet, storageSet } from '../core/storage'
import { getPrivateStore, updatePrivateStore } from '../core/private-vault'
import { ALARM, reconfigureAlarm } from '../core/alarms'
import {
  DEFAULT_BACKUP_CONTENTS,
  normalizeBackupContents,
  WEBDAV_BACKUP_CONTENT_OPTIONS,
  type BackupContentId,
  type BackupProgressHandler,
} from './backup-schema'
import {
  buildBackupSnapshot,
  parseBackupManifest,
  restoreSnapshotFile,
  snapshotSummary,
  type BackupSnapshotSummary,
} from './backup-snapshot'
import type { RestoreMode } from './backup-schema'
import { sendMessage, MSG } from '../core/bus'
import { loadBackupKey } from './backup-key'

export interface WebDavConfig {
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

export const WEBDAV_INTERVAL_HOUR_PRESETS = [
  { label: '每 6 小时', value: 6 },
  { label: '每 12 小时', value: 12 },
  { label: '每天', value: 24 },
  { label: '每 2 天', value: 48 },
] as const

const DEFAULT: WebDavConfig = {
  enabled: false,
  url: '',
  path: '',
  username: '',
  password: '',
  autoEnabled: false,
  intervalHours: 24,
  autoOnChange: false,
  retainCount: 5,
  contents: [...DEFAULT_BACKUP_CONTENTS],
}

function normalizeIntervalHours(value?: number): number {
  return WEBDAV_INTERVAL_HOUR_PRESETS.find((i) => i.value === value)?.value ?? DEFAULT.intervalHours
}

export async function loadWebDavConfig(): Promise<WebDavConfig> {
  const raw = await storageGet<Partial<WebDavConfig>>(STORAGE_KEYS.WEBDAV_CONFIG)
  const secret = (await getPrivateStore()).services?.webdav
  if (!raw) return {
    ...DEFAULT,
    url: secret?.url || '',
    username: secret?.username || '',
    password: secret?.password || '',
  }
  return {
    enabled: !!raw.enabled,
    url: secret?.url || '',
    path: (raw.path || '').trim(),
    username: secret?.username || '',
    password: secret?.password || '',
    autoEnabled: !!raw.autoEnabled,
    intervalHours: normalizeIntervalHours(raw.intervalHours),
    autoOnChange: !!raw.autoOnChange,
    retainCount: typeof raw.retainCount === 'number' ? Math.max(0, raw.retainCount) : DEFAULT.retainCount,
    contents: normalizeBackupContents(raw.contents, WEBDAV_BACKUP_CONTENT_OPTIONS),
  }
}

export async function saveWebDavConfig(cfg: WebDavConfig): Promise<void> {
  const next: WebDavConfig = {
    enabled: !!cfg.enabled,
    url: cfg.url.trim(),
    path: (cfg.path || '').trim(),
    username: cfg.username.trim(),
    password: cfg.password,
    autoEnabled: !!cfg.autoEnabled,
    intervalHours: normalizeIntervalHours(cfg.intervalHours),
    autoOnChange: !!cfg.autoOnChange,
    retainCount: Math.max(0, Number(cfg.retainCount) || 0),
    contents: normalizeBackupContents(cfg.contents, WEBDAV_BACKUP_CONTENT_OPTIONS),
  }
  const publicConfig = {
    enabled: next.enabled,
    path: next.path,
    autoEnabled: next.autoEnabled,
    intervalHours: next.intervalHours,
    autoOnChange: next.autoOnChange,
    retainCount: next.retainCount,
    contents: next.contents,
  }
  await storageSet(STORAGE_KEYS.WEBDAV_CONFIG, publicConfig)
  await updatePrivateStore((draft) => {
    if (next.url || next.username || next.password) {
      draft.services = {
        ...(draft.services || {}),
        webdav: { url: next.url, username: next.username, password: next.password },
      }
    } else if (draft.services) {
      delete draft.services.webdav
    }
  })
  await reconfigureAlarm(
    ALARM.WEBDAV_BACKUP,
    next.enabled && next.autoEnabled,
    Math.max(1, next.intervalHours * 60),
  )
}

function authHeader(cfg: WebDavConfig): string {
  return `Basic ${btoa(`${cfg.username}:${cfg.password}`)}`
}

export function dirUrl(cfg: WebDavConfig): string {
  const base = (cfg.url || '').replace(/\/+$/, '')
  let path = (cfg.path || '').trim()
  if (!path) return `${base}/`
  if (!path.startsWith('/')) path = `/${path}`
  return `${base}${path.replace(/\/+$/, '')}/`
}

function fileUrl(cfg: WebDavConfig, name: string): string {
  const path = name
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')
  return `${dirUrl(cfg)}${path}`
}

function snapshotDirUrl(cfg: WebDavConfig, id: string): string {
  return `${dirUrl(cfg)}${encodeURIComponent(id)}/`
}

function snapshotFileUrl(cfg: WebDavConfig, id: string, name: string): string {
  return `${snapshotDirUrl(cfg, id)}${encodeURIComponent(name)}`
}

async function makeDir(url: string, cfg: WebDavConfig): Promise<void> {
  const res = await fetch(url, { method: 'MKCOL', headers: { Authorization: authHeader(cfg) } })
  if (!res.ok && res.status !== 405) throw new Error(`创建目录失败：HTTP ${res.status}`)
}

async function ensureDir(cfg: WebDavConfig): Promise<void> {
  await makeDir(dirUrl(cfg), cfg)
}

function assertConfigured(cfg: WebDavConfig): void {
  if (!cfg.url.trim()) throw new Error('请填写服务器地址')
  if (!cfg.username.trim()) throw new Error('请填写用户名')
  if (!cfg.password.trim()) throw new Error('请填写密码')
}

/** 测试当前 WebDAV 配置、身份凭据和备份目录访问权限。 */
export async function testWebDavConnection(cfg: WebDavConfig): Promise<void> {
  assertConfigured(cfg)
  const res = await fetch(dirUrl(cfg), {
    method: 'PROPFIND',
    headers: { Authorization: authHeader(cfg), Depth: '0' },
  })
  if (res.ok) return
  if (res.status === 404) {
    await ensureDir(cfg)
    return
  }
  if (res.status === 401 || res.status === 403) throw new Error('认证失败，请检查用户名和密码')
  throw new Error(`连接失败：HTTP ${res.status}`)
}

/** 按内容分文件上传；manifest 最后上传，避免展示不完整快照。 */
export async function backupNow(onProgress?: BackupProgressHandler): Promise<string> {
  onProgress?.({ phase: 'validating', label: '正在检查 WebDAV 备份配置', percent: 1, indeterminate: true })
  const cfg = await loadWebDavConfig()
  if (!cfg.enabled) throw new Error('请先启用 WebDAV 备份')
  if (!(await loadBackupKey())) throw new Error('请先生成并导出恢复密钥')
  assertConfigured(cfg)
  await ensureDir(cfg)
  const snapshot = await buildBackupSnapshot(cfg.contents, onProgress)
  await makeDir(snapshotDirUrl(cfg, snapshot.manifest.id), cfg)
  try {
    for (const file of snapshot.files) {
      onProgress?.({
        phase: 'uploading',
        label: `正在上传 ${file.name}`,
        percent: 40,
        indeterminate: true,
        totalBytes: file.data.byteLength,
        currentFile: file.name,
      })
      const res = await fetch(snapshotFileUrl(cfg, snapshot.manifest.id, file.name), {
        method: 'PUT',
        headers: { Authorization: authHeader(cfg), 'Content-Type': file.contentType },
        body: new Blob([file.data], { type: file.contentType }),
      })
      if (!res.ok) throw new Error(`上传 ${file.name} 失败：HTTP ${res.status}`)
      onProgress?.({
        phase: 'uploading',
        label: `${file.name} 上传完成`,
        percent: 90,
        transferredBytes: file.data.byteLength,
        totalBytes: file.data.byteLength,
        currentFile: file.name,
      })
    }
    onProgress?.({ phase: 'committing', label: '正在提交备份清单', percent: 92, indeterminate: true })
    const manifestText = JSON.stringify(snapshot.manifest)
    const manifestRes = await fetch(snapshotFileUrl(cfg, snapshot.manifest.id, 'manifest.json'), {
      method: 'PUT',
      headers: { Authorization: authHeader(cfg), 'Content-Type': 'application/json' },
      body: manifestText,
    })
    if (!manifestRes.ok) throw new Error(`上传 manifest.json 失败：HTTP ${manifestRes.status}`)
  } catch (error) {
    await deleteWebDavSnapshotDir(cfg, snapshot.manifest.id)
    throw error
  }
  onProgress?.({ phase: 'cleaning', label: '正在清理旧备份', percent: 96, indeterminate: true })
  await cleanupOld(cfg)
  onProgress?.({ phase: 'completed', label: 'WebDAV 备份完成', percent: 100 })
  return `${snapshot.manifest.id}/manifest.json`
}

let autoBackupTimer: ReturnType<typeof setTimeout> | null = null
export function scheduleAutoBackupOnChange(delayMs = 2500): void {
  if (autoBackupTimer) clearTimeout(autoBackupTimer)
  autoBackupTimer = setTimeout(() => void tryAutoBackupOnChange(), delayMs)
}

export async function tryAutoBackupOnChange(): Promise<void> {
  try {
    const cfg = await loadWebDavConfig()
    if (!cfg.enabled || !cfg.autoOnChange || !cfg.url || !cfg.username || !cfg.password) return
    await sendMessage(MSG.BACKUP_START, { target: 'webdav' })
  } catch (error) {
    console.warn('[WebDav] autoOnChange backup failed:', error)
  }
}

async function propfindEntries(cfg: WebDavConfig, relativeDir = ''): Promise<string[]> {
  const url = relativeDir ? snapshotDirUrl(cfg, relativeDir) : dirUrl(cfg)
  const res = await fetch(url, {
    method: 'PROPFIND',
    headers: { Authorization: authHeader(cfg), Depth: '1' },
  })
  if (!res.ok) throw new Error(`列取失败：HTTP ${res.status}`)
  const xml = await res.text()
  const entries = new Set<string>()
  const current = relativeDir ? `${relativeDir}/` : ''
  for (const match of xml.matchAll(/<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/gi)) {
    const href = decodeURIComponent(match[1])
    const parts = href.split('/').filter(Boolean)
    const name = parts.pop()
    if (!name || name === relativeDir) continue
    entries.add(`${current}${name}`)
  }
  return [...entries]
}

async function downloadWebDavText(cfg: WebDavConfig, name: string): Promise<string | null> {
  const res = await fetch(fileUrl(cfg, name), { headers: { Authorization: authHeader(cfg) } })
  return res.ok ? res.text() : null
}

async function downloadWebDavBytes(cfg: WebDavConfig, name: string): Promise<Uint8Array | null> {
  const res = await fetch(fileUrl(cfg, name), { headers: { Authorization: authHeader(cfg) } })
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
}

export async function listBackups(): Promise<BackupSnapshotSummary[]> {
  const cfg = await loadWebDavConfig()
  if (!cfg.url) return []
  assertConfigured(cfg)
  const names = await propfindEntries(cfg)
  const summaries: BackupSnapshotSummary[] = []
  const snapshotDirPattern = /^\d{8}T\d{9}Z$/

  for (const id of names.filter((item) => snapshotDirPattern.test(item))) {
    const manifestName = `${id}/manifest.json`
    const text = await downloadWebDavText(cfg, manifestName)
    if (!text) continue
    try {
      const manifest = parseBackupManifest(text)
      const children = await propfindEntries(cfg, id)
      if (!children.includes(`${id}/backup.mpt2`)) continue
      summaries.push(snapshotSummary(manifest, manifestName))
    } catch {
      // 清单损坏时跳过当前快照，继续枚举其他备份。
    }
  }

  return summaries
    .filter((item) => item.contents.length > 0)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

async function deleteWebDavSnapshotDir(cfg: WebDavConfig, id: string): Promise<void> {
  await fetch(snapshotDirUrl(cfg, id), {
    method: 'DELETE',
    headers: { Authorization: authHeader(cfg) },
  }).catch(() => undefined)
}

async function deleteWebDavSnapshot(cfg: WebDavConfig, summary: BackupSnapshotSummary): Promise<void> {
  await deleteWebDavSnapshotDir(cfg, summary.id)
}

async function cleanupOld(cfg: WebDavConfig): Promise<void> {
  if (cfg.retainCount <= 0) return
  const all = await listBackups()
  for (const item of all.slice(cfg.retainCount)) await deleteWebDavSnapshot(cfg, item)
}

export async function restoreBackup(
  summary: BackupSnapshotSummary,
  contents: BackupContentId[],
  mode: RestoreMode = 'replace',
  onProgress?: BackupProgressHandler,
): Promise<void> {
  onProgress?.({ phase: 'validating', label: '正在检查 WebDAV 还原配置', percent: 1, indeterminate: true })
  const cfg = await loadWebDavConfig()
  assertConfigured(cfg)
  const selected = contents.filter((id) => summary.contents.includes(id))
  if (!selected.length) throw new Error('请至少选择一项可恢复内容')
  const base = summary.manifestName.slice(0, summary.manifestName.lastIndexOf('/') + 1)
  onProgress?.({ phase: 'downloading', label: '正在下载 backup.mpt2', percent: 5, indeterminate: true, currentFile: 'backup.mpt2' })
  const bytes = await downloadWebDavBytes(cfg, `${base}backup.mpt2`)
  if (!bytes) throw new Error('下载 backup.mpt2 失败')
  onProgress?.({
    phase: 'downloading',
    label: '备份文件下载完成',
    percent: 55,
    transferredBytes: bytes.byteLength,
    totalBytes: bytes.byteLength,
    currentFile: 'backup.mpt2',
  })
  await restoreSnapshotFile({
    name: 'backup.mpt2',
    type: 'encrypted',
    size: bytes.byteLength,
    contentType: 'application/octet-stream',
    data: Uint8Array.from(bytes) as Uint8Array<ArrayBuffer>,
    content: new TextDecoder().decode(bytes),
  }, selected, mode, summary.manifest, onProgress)
}
