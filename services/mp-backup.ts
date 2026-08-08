// MoviePilot 服务端备份：经 MoviePilotTools 插件按内容分文件落盘
import {
  deleteFromMp,
  downloadFromMp,
  downloadLargeBytesFromMp,
  healthMp,
  listFromMp,
  mpUserPath,
  uploadLargeBytesToMp,
  uploadToMp,
} from '../core/mp-backend'

import { ALARM, reconfigureAlarm } from '../core/alarms'
import { STORAGE_KEYS, storageGet, storageSet } from '../core/storage'
import {
  DEFAULT_BACKUP_CONTENTS,
  normalizeBackupContents,
  type BackupContentId,
  type BackupProgressHandler,
} from './backup-schema'
import type { RestoreMode } from './backup-schema'
import { sendMessage, MSG } from '../core/bus'
import { loadBackupKey } from './backup-key'

import {
  buildBackupSnapshot,
  parseBackupManifest,
  restoreSnapshotFile,
  snapshotSummary,
  type BackupSnapshotFile,
  type BackupSnapshotSummary,
} from './backup-snapshot'

export interface MpBackupConfig {
  enabled: boolean
  autoEnabled: boolean
  intervalHours: number
  autoOnChange: boolean
  retainCount: number
  contents: BackupContentId[]
}

export const MP_BACKUP_INTERVAL_HOUR_PRESETS = [
  { label: '每 6 小时', value: 6 },
  { label: '每 12 小时', value: 12 },
  { label: '每天', value: 24 },
  { label: '每 2 天', value: 48 },
] as const

const DEFAULT: MpBackupConfig = {
  enabled: false,
  autoEnabled: false,
  intervalHours: 24,
  autoOnChange: false,
  retainCount: 5,
  contents: [...DEFAULT_BACKUP_CONTENTS],
}

const BACKUP_DIR = 'backups'
const SNAPSHOT_DIR_RE = /^\d{8}T\d{9}Z$/
const DIRECT_UPLOAD_BYTES = 512 * 1024

function normalizeIntervalHours(value?: number): number {
  return MP_BACKUP_INTERVAL_HOUR_PRESETS.find((i) => i.value === value)?.value ?? DEFAULT.intervalHours
}

export async function loadMpBackupConfig(): Promise<MpBackupConfig> {
  const raw = await storageGet<Partial<MpBackupConfig>>(STORAGE_KEYS.MP_BACKUP_CONFIG)
  if (!raw) return { ...DEFAULT }
  return {
    enabled: !!raw.enabled,
    autoEnabled: !!raw.autoEnabled,
    intervalHours: normalizeIntervalHours(raw.intervalHours),
    autoOnChange: !!raw.autoOnChange,
    retainCount: typeof raw.retainCount === 'number' ? Math.max(0, raw.retainCount) : DEFAULT.retainCount,
    contents: normalizeBackupContents(raw.contents),
  }
}

export async function saveMpBackupConfig(cfg: MpBackupConfig): Promise<void> {
  const next: MpBackupConfig = {
    enabled: !!cfg.enabled,
    autoEnabled: !!cfg.autoEnabled,
    intervalHours: normalizeIntervalHours(cfg.intervalHours),
    autoOnChange: !!cfg.autoOnChange,
    retainCount: Math.max(0, Number(cfg.retainCount) || 0),
    contents: normalizeBackupContents(cfg.contents),
  }
  await storageSet(STORAGE_KEYS.MP_BACKUP_CONFIG, next)

  await reconfigureAlarm(
    ALARM.MP_BACKUP,
    next.enabled && next.autoEnabled,
    Math.max(1, next.intervalHours * 60),
  )
}

export async function checkMpBackupReady(): Promise<{ ok: boolean; message: string }> {
  const cfg = await loadMpBackupConfig()
  if (!cfg.enabled) return { ok: false, message: '未启用 MoviePilot 服务端备份' }
  const health = await healthMp()
  if (!health.ok) {
    return { ok: false, message: health.error || '无法连接 MoviePilotTools 插件，请确认已安装并登录' }
  }
  if (health.data && health.data.enabled === false) {
    return { ok: false, message: 'MoviePilotTools 插件未启用，请在 MP 插件设置中开启' }
  }
  return { ok: true, message: `插件就绪${health.data?.plugin_version ? ` v${health.data.plugin_version}` : ''}` }
}

async function uploadSnapshotFile(
  path: string,
  file: BackupSnapshotFile,
  onProgress?: BackupProgressHandler,
): Promise<void> {
  const result =
    file.data.byteLength > DIRECT_UPLOAD_BYTES
      ? await uploadLargeBytesToMp(path, file.data, Date.now(), (progress) => {
          onProgress?.({
            phase: 'uploading',
            label: '正在上传备份文件',
            percent: 40 + Math.round((progress.transferredBytes / progress.totalBytes) * 50),
            transferredBytes: progress.transferredBytes,
            totalBytes: progress.totalBytes,
            chunkIndex: progress.chunkIndex,
            chunkCount: progress.chunkCount,
            currentFile: file.name,
          })
        })
      : await uploadToMp(path, new TextDecoder().decode(file.data), {
          encoding: 'utf-8',
          updatedAt: Date.now(),
        })
  if (result.ok && file.data.byteLength <= DIRECT_UPLOAD_BYTES) {
    onProgress?.({
      phase: 'uploading',
      label: '备份文件上传完成',
      percent: 90,
      transferredBytes: file.data.byteLength,
      totalBytes: file.data.byteLength,
      currentFile: file.name,
    })
  }
  if (!result.ok) {
    if (result.status === 404 || result.status === 405) {
      throw new Error('MoviePilotTools 插件版本过低，请更新到 v1.1.0 后重试大文件备份')
    }
    throw new Error(result.error || `上传 ${file.name} 失败`)
  }
}

/** 按内容分文件备份，返回 manifest 相对路径。 */
export async function backupToMp(onProgress?: BackupProgressHandler): Promise<string> {
  onProgress?.({ phase: 'validating', label: '正在检查 MoviePilot 备份配置', percent: 1, indeterminate: true })
  const cfg = await loadMpBackupConfig()
  if (!cfg.enabled) throw new Error('请先启用 MoviePilot 服务端备份')
  if (!(await loadBackupKey())) throw new Error('请先生成并导出恢复密钥')
  const ready = await checkMpBackupReady()
  if (!ready.ok) throw new Error(ready.message)

  const snapshot = await buildBackupSnapshot(cfg.contents, onProgress)
  const uploaded: string[] = []
  try {
    for (const file of snapshot.files) {
      const path = await mpUserPath(BACKUP_DIR, snapshot.manifest.id, file.name)
      onProgress?.({
        phase: 'uploading',
        label: `正在上传 ${file.name}`,
        percent: 40,
        indeterminate: file.data.byteLength <= DIRECT_UPLOAD_BYTES,
        totalBytes: file.data.byteLength,
        currentFile: file.name,
      })
      await uploadSnapshotFile(path, file, onProgress)
      uploaded.push(path)
    }
    onProgress?.({ phase: 'committing', label: '正在提交备份清单', percent: 92, indeterminate: true })
    const manifestPath = await mpUserPath(BACKUP_DIR, snapshot.manifest.id, 'manifest.json')
    const manifestResult = await uploadToMp(manifestPath, JSON.stringify(snapshot.manifest), {
      encoding: 'utf-8',
      updatedAt: Date.now(),
    })
    if (!manifestResult.ok) throw new Error(manifestResult.error || '上传 manifest.json 失败')
    uploaded.push(manifestPath)
  } catch (error) {
    await Promise.all(uploaded.map((path) => deleteFromMp(path).catch(() => false)))
    throw error
  }
  onProgress?.({ phase: 'cleaning', label: '正在清理旧备份', percent: 96, indeterminate: true })
  await cleanupOldMp(cfg)
  const manifestPath = await mpUserPath(BACKUP_DIR, snapshot.manifest.id, 'manifest.json')
  onProgress?.({ phase: 'completed', label: 'MoviePilot 备份完成', percent: 100 })
  return manifestPath
}

async function downloadMpBytes(
  path: string,
  size = 0,
  onProgress?: BackupProgressHandler,
): Promise<Uint8Array | null> {
  if (size > DIRECT_UPLOAD_BYTES) {
    return downloadLargeBytesFromMp(path, (progress) => {
      onProgress?.({
        phase: 'downloading',
        label: '正在下载备份文件',
        percent: 5 + Math.round((progress.transferredBytes / progress.totalBytes) * 50),
        transferredBytes: progress.transferredBytes,
        totalBytes: progress.totalBytes,
        chunkIndex: progress.chunkIndex,
        chunkCount: progress.chunkCount,
        currentFile: 'backup.mpt2',
      })
    })
  }
  const text = await downloadFromMp(path)
  if (text == null) return null
  const textBytes = new TextEncoder().encode(text)
  onProgress?.({
    phase: 'downloading',
    label: '备份文件下载完成',
    percent: 55,
    transferredBytes: textBytes.byteLength,
    totalBytes: size || textBytes.byteLength,
    currentFile: 'backup.mpt2',
  })
  if (path.toLowerCase().endsWith('.zip')) {
    try {
      const binary = atob(text)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      return bytes
    } catch {
      return null
    }
  }
  return new TextEncoder().encode(text)
}

export async function listMpBackups(): Promise<BackupSnapshotSummary[]> {
  const prefix = await mpUserPath(BACKUP_DIR)
  try {
    const files = await listFromMp(prefix)
    const fileMap = new Map(files.filter((f) => !f.is_dir).map((f) => [f.path, f]))
    const summaries: BackupSnapshotSummary[] = []

    for (const file of files) {
      const parts = file.path.split('/')
      const name = parts.pop() || ''
      const parent = parts.pop() || ''
      const isDirectoryManifest = name === 'manifest.json' && SNAPSHOT_DIR_RE.test(parent)
      if (file.is_dir || !isDirectoryManifest) continue
      const text = await downloadFromMp(file.path)
      if (!text) continue
      try {
        const manifest = parseBackupManifest(text)
        const base = file.path.slice(0, file.path.lastIndexOf('/') + 1)
        if (!fileMap.has(`${base}backup.mpt2`)) continue
        summaries.push(snapshotSummary(manifest, file.path))
      } catch {
        // 清单损坏时跳过当前快照，继续枚举其他备份。
      }
    }



    return summaries
      .filter((item) => item.contents.length > 0)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

async function deleteMpSnapshot(summary: BackupSnapshotSummary): Promise<void> {
  const manifestText = await downloadFromMp(summary.manifestName)
  if (manifestText) {
    try {
      const manifest = parseBackupManifest(manifestText)
      const base = summary.manifestName.slice(0, summary.manifestName.lastIndexOf('/') + 1)
      await Promise.all(
        manifest.files.map((file) => deleteFromMp(`${base}${file.name}`).catch(() => false)),
      )
    } catch {
      // 清单损坏时至少删除清单本身
    }
  }
  await deleteFromMp(summary.manifestName).catch(() => false)
}

async function cleanupOldMp(cfg: MpBackupConfig): Promise<void> {
  if (cfg.retainCount <= 0) return
  const all = await listMpBackups()
  for (const item of all.slice(cfg.retainCount)) await deleteMpSnapshot(item)
}

export async function restoreFromMp(
  summary: BackupSnapshotSummary,
  contents: BackupContentId[],
  mode: RestoreMode = 'replace',
  onProgress?: BackupProgressHandler,
): Promise<void> {
  onProgress?.({ phase: 'validating', label: '正在检查 MoviePilot 还原配置', percent: 1, indeterminate: true })
  const cfg = await loadMpBackupConfig()
  if (!cfg.enabled) throw new Error('请先启用 MoviePilot 服务端备份')
  const selected = contents.filter((id) => summary.contents.includes(id))
  if (!selected.length) throw new Error('请至少选择一项可恢复内容')



  onProgress?.({ phase: 'downloading', label: '正在读取备份文件信息', percent: 3, indeterminate: true, currentFile: 'backup.mpt2' })
  const base = summary.manifestName.slice(0, summary.manifestName.lastIndexOf('/') + 1)
  const path = `${base}backup.mpt2`
  const files = await listFromMp(base)
  const size = files.find((item) => item.path === path)?.size || 0
  onProgress?.({ phase: 'downloading', label: '正在下载 backup.mpt2', percent: 5, indeterminate: size <= DIRECT_UPLOAD_BYTES, totalBytes: size || undefined, currentFile: 'backup.mpt2' })
  const data = await downloadMpBytes(path, size, onProgress)
  if (!data) throw new Error('下载 backup.mpt2 失败')
  await restoreSnapshotFile({
    name: 'backup.mpt2',
    type: 'encrypted',
    size: data.byteLength,
    contentType: 'application/octet-stream',
    data: Uint8Array.from(data) as Uint8Array<ArrayBuffer>,

    content: new TextDecoder().decode(data),
  }, selected, mode, summary.manifest, onProgress)

}

let autoTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleMpAutoBackupOnChange(delayMs = 2500): void {
  if (autoTimer) clearTimeout(autoTimer)
  autoTimer = setTimeout(() => void tryMpAutoBackupOnChange(), delayMs)
}

export async function tryMpAutoBackupOnChange(): Promise<void> {
  try {
    const cfg = await loadMpBackupConfig()
    if (!cfg.enabled || !cfg.autoOnChange) return
    await sendMessage(MSG.BACKUP_START, { target: 'mp' })
  } catch (error) {
    console.warn('[MpBackup] autoOnChange failed:', error)
  }
}
